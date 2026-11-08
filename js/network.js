// =====================================================================================
//  network.js  -  PeerJS WebRTC Multiplayer Layer
//  Provides P2P room creation, discovery, action routing, chat, and state sync.
// =====================================================================================

var NET = {
  active: false,
  isHost: false,
  peer: null,
  myId: null,
  roomCode: null,
  myPlayerIndex: 0,
  joined: false,
  connections: [],     // Host: array of hybrid connections to guests
  peerMap: {},         // Host: peerId -> hybrid connection
  hostConn: null,      // Guest: single hybrid connection to host
  chatHistory: [],
  onLobbyUpdate: null,
  onJoinAck: null,
  onJoinDenied: null,
  onAction: null,
  disconnectTimer: null,
  reconnecting: false,
  httpPollTimer: null,
  httpSeq: 0,
  httpEnabled: true,
  seenMsgs: new Set(),
};

// Fast public STUN servers (no dead openrelay TURN servers that stall ICE gathering)
const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" }
  ]
};

// Generates a random readable 5-character room code (e.g. "CHAOS", "VIPER")
function genRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// Prefixes room code to avoid collisions on public 0.peerjs.com
function fullPeerId(code) {
  return "snc-" + code.toLowerCase();
}

// Send a packet over PeerJS's already-open WebSocket signaling channel (100% CGNAT/firewall-proof fallback)
function wsSend(dstPeerId, data) {
  if (!NET.peer || !dstPeerId) return false;
  const sock = NET.peer.socket || NET.peer._socket;
  if (!sock) return false;
  const packet = {
    type: "CANDIDATE",
    dst: dstPeerId,
    payload: {
      _sncRelay: true,
      connectionId: "snc_ws",
      src: NET.myId,
      data: data
    }
  };
  try {
    const rawWs = sock._socket;
    if (rawWs && rawWs.readyState === 1) {
      rawWs.send(JSON.stringify(packet));
      return true;
    }
    if (typeof sock.send === "function") {
      sock.send(packet);
      return true;
    }
  } catch (e) {
    console.warn("wsSend error:", e);
  }
  return false;
}

// Hook PeerJS's signaling WebSocket for fallback relay packets ("_sncRelay") and EXPIRE events
function setupSocketRelay(peer, onInvalidRoom) {
  const sock = peer && (peer.socket || peer._socket);
  if (!sock) return;

  const onRawMsg = raw => {
    if (!raw || typeof raw !== "object") return;
    if (raw.type === "EXPIRE" && onInvalidRoom) {
      onInvalidRoom(new Error("Room code not found or expired."));
      return;
    }
    if (raw.payload && raw.payload._sncRelay && raw.payload.data) {
      const srcPeerId = raw.payload.src || raw.src;
      const msg = raw.payload.data;
      if (NET.isHost && srcPeerId) {
        let hc = NET.peerMap[srcPeerId];
        if (!hc) {
          hc = createHybridConn(srcPeerId, null);
          NET.peerMap[srcPeerId] = hc;
        }
        hc.open = true;
        handleNetData(msg, hc);
      } else if (!NET.isHost && NET.hostConn) {
        NET.hostConn.open = true;
        handleNetData(msg, NET.hostConn);
      }
    }
  };

  const rawWs = sock._socket;
  if (rawWs && typeof rawWs.addEventListener === "function" && !rawWs._sncHooked) {
    rawWs._sncHooked = true;
    rawWs.addEventListener("message", ev => {
      try { onRawMsg(JSON.parse(ev.data)); } catch (e) {}
    });
  }
  if (typeof sock.on === "function" && !sock._sncHooked) {
    sock._sncHooked = true;
    sock.on("message", onRawMsg);
  }
}

// Send via built-in serve.py HTTP relay (/api/send) - 100% immune to Symmetric NAT / CGNAT
function httpSend(dstPeerId, data) {
  if (!NET.httpEnabled || !NET.roomCode || !NET.myId) return;
  fetch("/api/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      room: NET.roomCode,
      src: NET.myId,
      dst: dstPeerId || "*",
      data: data
    })
  }).catch(() => {});
}

// Poll built-in serve.py HTTP relay (/api/poll) every 220ms
function startHttpRelay() {
  if (NET.httpPollTimer) clearInterval(NET.httpPollTimer);
  NET.httpSeq = 0;
  NET.httpEnabled = true;
  let busy = false;

  NET.httpPollTimer = setInterval(async () => {
    if (!NET.active || !NET.httpEnabled || !NET.roomCode || !NET.myId || busy) return;
    busy = true;
    try {
      const r = await fetch(`/api/poll?room=${encodeURIComponent(NET.roomCode)}&peer=${encodeURIComponent(NET.myId)}&after=${NET.httpSeq}`);
      if (!r.ok) {
        // Static hosting without serve.py /api/poll: disable HTTP polling quietly
        if (r.status === 404 || r.status === 405) NET.httpEnabled = false;
        busy = false;
        return;
      }
      const j = await r.json();
      if (typeof j.seq === "number" && j.seq > NET.httpSeq) NET.httpSeq = j.seq;
      if (Array.isArray(j.msgs)) {
        j.msgs.forEach(m => {
          if (!m || !m.data) return;
          if (NET.isHost) {
            let hc = NET.peerMap[m.src];
            if (!hc) {
              hc = createHybridConn(m.src, null);
              NET.peerMap[m.src] = hc;
            }
            hc.open = true;
            handleNetData(m.data, hc);
          } else if (NET.hostConn) {
            NET.hostConn.open = true;
            handleNetData(m.data, NET.hostConn);
          }
        });
      }
    } catch (e) {}
    busy = false;
  }, 220);
}

// Create a hybrid connection that sends over WebRTC DataChannel (when open), PeerJS WebSocket relay, and HTTP relay
function createHybridConn(peerId, rtcConn) {
  const hc = {
    peer: peerId,
    rtcConn: rtcConn || null,
    open: true,
    playerIndex: null,
    send(msg) {
      if (msg && typeof msg === "object" && !msg._mid) {
        msg._mid = Math.random().toString(36).slice(2) + Date.now().toString(36);
      }
      if (this.rtcConn && this.rtcConn.open) {
        try { this.rtcConn.send(msg); } catch (e) {}
      }
      wsSend(this.peer, msg);
      httpSend(this.peer, msg);
    }
  };
  return hc;
}

// Initialize as Host
function initHost(customCode) {
  return new Promise((resolve, reject) => {
    initRows(); // ensure rows exist
    NET.roomCode = (customCode || genRoomCode()).toUpperCase();
    const pid = fullPeerId(NET.roomCode);
    NET.isHost = true;
    NET.active = true;
    NET.myPlayerIndex = 0;
    NET.joined = true;
    NET.connections = [];
    NET.peerMap = {};
    NET.seenMsgs.clear();
    NET.myId = pid;
    startHttpRelay();

    if (NET.peer) { try { NET.peer.destroy(); } catch (e) {} }
    NET.peer = new Peer(pid, { debug: 1, config: ICE_CONFIG });

    let settled = false;
    const finishHost = () => {
      if (!settled) { settled = true; resolve(NET.roomCode); }
    };

    NET.peer.on("open", id => {
      NET.myId = id;
      setupSocketRelay(NET.peer);
      finishHost();
    });

    NET.peer.on("connection", conn => {
      handleIncomingConnection(conn);
    });

    NET.peer.on("error", err => {
      console.error("PeerJS Host Error:", err);
      if (err.type === "unavailable-id" && !settled) {
        NET.peer.destroy();
        initHost().then(resolve).catch(reject);
      } else if (!settled) {
        finishHost();
      }
    });
  });
}

// Initialize as Guest (only resolves once JOIN_ACK arrives from Host!)
function initGuest(code, playerName) {
  return new Promise((resolve, reject) => {
    NET.roomCode = code.toUpperCase().trim();
    const targetId = fullPeerId(NET.roomCode);
    NET.isHost = false;
    NET.active = true;
    NET.joined = false;
    NET.seenMsgs.clear();
    NET.myId = "guest-" + Math.random().toString(36).slice(2, 10);

    const hc = createHybridConn(targetId, null);
    NET.hostConn = hc;
    startHttpRelay();

    let settled = false;
    let joinRetryTimer = null;

    const cleanupRetry = () => {
      if (joinRetryTimer) { clearInterval(joinRetryTimer); joinRetryTimer = null; }
    };

    NET.onJoinAck = () => {
      cleanupRetry();
      if (!settled) { settled = true; resolve(hc); }
    };
    NET.onJoinDenied = reason => {
      cleanupRetry();
      if (!settled) { settled = true; reject(new Error(reason || "Join denied")); }
    };

    const sendJoinHandshake = () => {
      if (NET.joined) { cleanupRetry(); return; }
      hc.send({ type: "JOIN_REQ", name: playerName || "Guest" });
    };

    let tries = 0;
    joinRetryTimer = setInterval(() => {
      tries++;
      if (NET.joined) { cleanupRetry(); return; }
      if (tries > 10) {
        cleanupRetry();
        if (!settled) { settled = true; reject(new Error("Timed out waiting for Host response. Check room code.")); }
        return;
      }
      sendJoinHandshake();
    }, 1200);

    if (NET.peer) { try { NET.peer.destroy(); } catch (e) {} }
    NET.peer = new Peer(NET.myId, { debug: 1, config: ICE_CONFIG });

    NET.peer.on("open", id => {
      NET.myId = id;
      setupSocketRelay(NET.peer, err => {
        if (!NET.httpEnabled) {
          cleanupRetry();
          if (!settled) { settled = true; reject(err); }
        }
      });
      sendJoinHandshake();

      const rtcConn = NET.peer.connect(targetId, { reliable: true });
      hc.rtcConn = rtcConn;

      rtcConn.on("open", () => {
        sendJoinHandshake();
      });

      rtcConn.on("data", data => {
        handleNetData(data, hc);
      });

      rtcConn.on("close", () => {
        if (!NET.httpEnabled) handlePeerDisconnect("Host");
      });

      rtcConn.on("error", err => {
        console.warn("WebRTC DataChannel warning:", err);
      });
    });

    NET.peer.on("error", err => {
      console.warn("PeerJS Guest warning:", err);
    });
  });
}

// Host handles incoming guest WebRTC connections
function handleIncomingConnection(rtcConn) {
  const peerId = rtcConn.peer;
  let hc = NET.peerMap[peerId];
  if (!hc) {
    hc = createHybridConn(peerId, rtcConn);
    NET.peerMap[peerId] = hc;
  } else {
    hc.rtcConn = rtcConn;
  }
  hc.open = true;

  rtcConn.on("data", data => handleNetData(data, hc));
  rtcConn.on("close", () => {
    const idx = NET.connections.indexOf(hc);
    if (idx !== -1) {
      NET.connections.splice(idx, 1);
      delete NET.peerMap[peerId];
      handlePlayerLeave(hc.playerIndex);
    }
  });
}

// Handle peer disconnection / grace period
function handlePeerDisconnect(who) {
  showNetworkBanner(`${who} disconnected! Reconnecting... (60s)`);
  let sec = 60;
  if (NET.disconnectTimer) clearInterval(NET.disconnectTimer);
  NET.disconnectTimer = setInterval(() => {
    sec--;
    if (sec <= 0) {
      clearInterval(NET.disconnectTimer);
      showNetworkBanner(`${who} left the game. Returning to lobby...`);
      setTimeout(() => location.reload(), 2500);
    } else {
      showNetworkBanner(`${who} disconnected! Waiting (${sec}s)...`);
    }
  }, 1000);
}

function handlePlayerLeave(playerIdx) {
  if (playerIdx == null) return;
  const pName = (S.rows[playerIdx] && S.rows[playerIdx].name) || `Player ${playerIdx + 1}`;
  log(`<b>${pName} lost connection.</b>`);
  broadcast({ type: "PLAYER_LEFT", index: playerIdx, name: pName });
  if (NET.onLobbyUpdate) NET.onLobbyUpdate();
}

function showNetworkBanner(text) {
  let el = $("netBanner");
  if (!el) {
    el = document.createElement("div");
    el.id = "netBanner";
    $("stage").appendChild(el);
  }
  if (!text) {
    el.style.display = "none";
    return;
  }
  el.textContent = text;
  el.style.display = "block";
}

function hideNetworkBanner() {
  if (NET.disconnectTimer) { clearInterval(NET.disconnectTimer); NET.disconnectTimer = null; }
  const el = $("netBanner");
  if (el) el.style.display = "none";
}

// Message routing
function handleNetData(msg, fromConn) {
  if (!msg || typeof msg !== "object") return;
  if (msg._mid) {
    if (NET.seenMsgs.has(msg._mid)) return;
    NET.seenMsgs.add(msg._mid);
  }
  switch (msg.type) {
    case "JOIN_REQ": {
      if (!NET.isHost) return;
      initRows();
      // Idempotency: if this peer already joined, re-send their JOIN_ACK without creating a duplicate slot
      if (fromConn.playerIndex != null) {
        fromConn.send({ type: "JOIN_ACK", yourIndex: fromConn.playerIndex, rows: S.rows, n: S.n, roomCode: NET.roomCode });
        return;
      }
      if (S.n >= CONFIG.MAX_PLAYERS || (G && G.turnNo > 0)) {
        fromConn.send({ type: "JOIN_DENIED", reason: "Room is full or game already started." });
        return;
      }
      // Allocate next open player index
      const pIdx = S.n++;
      fromConn.playerIndex = pIdx;
      if (!NET.connections.includes(fromConn)) {
        NET.connections.push(fromConn);
      }
      if (!S.rows[pIdx]) {
        S.rows[pIdx] = { name: msg.name || `Player ${pIdx + 1}`, cls: "", locked: false };
      } else {
        S.rows[pIdx].name = msg.name || `Player ${pIdx + 1}`;
      }
      fromConn.send({ type: "JOIN_ACK", yourIndex: pIdx, rows: S.rows, n: S.n, roomCode: NET.roomCode });
      broadcastLobby();
      if (NET.onLobbyUpdate) NET.onLobbyUpdate();
      break;
    }
    case "JOIN_ACK": {
      NET.joined = true;
      NET.myPlayerIndex = msg.yourIndex;
      NET.roomCode = msg.roomCode;
      if (Array.isArray(msg.rows)) S.rows = msg.rows;
      if (typeof msg.n === "number") S.n = msg.n;
      hideNetworkBanner();
      if (NET.onJoinAck) {
        const fn = NET.onJoinAck;
        NET.onJoinAck = null;
        fn();
      }
      if (NET.onLobbyUpdate) NET.onLobbyUpdate();
      break;
    }
    case "JOIN_DENIED": {
      if (NET.onJoinDenied) {
        const fn = NET.onJoinDenied;
        NET.onJoinDenied = null;
        fn(msg.reason);
      }
      break;
    }
    case "LOBBY_STATE": {
      NET.joined = true;
      if (Array.isArray(msg.rows)) S.rows = msg.rows;
      if (typeof msg.n === "number") S.n = msg.n;
      if (NET.onJoinAck) {
        const fn = NET.onJoinAck;
        NET.onJoinAck = null;
        fn();
      }
      if (NET.onLobbyUpdate) NET.onLobbyUpdate();
      break;
    }
    case "LOBBY_ROW_UPDATE": {
      if (NET.isHost) {
        initRows();
        if (msg.index != null && S.rows[msg.index]) {
          if (msg.name !== undefined && msg.name !== null) S.rows[msg.index].name = msg.name;
          if (msg.cls !== undefined && msg.cls !== null) S.rows[msg.index].cls = msg.cls;
          broadcastLobby();
          if (NET.onLobbyUpdate) NET.onLobbyUpdate();
        }
      }
      break;
    }
    case "GAME_START": {
      hideNetworkBanner();
      applyRemoteGameStart(msg);
      break;
    }
    case "ACTION_REQ": {
      handleRemoteAction(msg.action, fromConn.playerIndex);
      break;
    }
    case "ACTION_SYNC": {
      if (!NET.isHost) {
        handleRemoteAction(msg.action, msg.playerIndex);
      }
      break;
    }
    case "WAIT_ROLL": {
      if (!NET.isHost && G) {
        G.cur = G.players[msg.playerIndex];
        render();
        if (msg.playerIndex === NET.myPlayerIndex) {
          setPrompt(msg.prompt || `${G.cur ? G.cur.name : 'Player'}: grab the die and throw it, or press ROLL / Space.`);
        }
        rollDice(msg.n);
      }
      break;
    }
    case "WAIT_MOVE": {
      if (!NET.isHost && G) {
        G.cur = G.players[msg.playerIndex];
        render();
        const isMyTurn = (msg.playerIndex === NET.myPlayerIndex);
        if (isMyTurn) {
          let pieces;
          if (msg.moveKind === "heads" && Array.isArray(msg.heads)) {
            pieces = makeHandles(msg.heads.map(o => ({ h: o.h, targets: o.targets, ghost: (x, y) => ghostSvg(o.h, x, y) })));
          } else {
            const el = $("pw" + msg.playerIndex);
            pieces = [{ key: "pawn", el, targets: msg.targets || [] }];
          }
          const button = msg.button ? { label: msg.button, value: 1 } : null;
          awaitMove({ pieces, text: msg.text, button });
        } else {
          setPrompt(`Waiting for ${G.cur ? G.cur.name : 'player'} to make their move...`);
        }
      }
      break;
    }
    case "WAIT_CHOOSE": {
      if (!NET.isHost && G) {
        const actor = G.players[msg.playerIndex] || G.cur;
        render();
        const isMyTurn = (msg.playerIndex === NET.myPlayerIndex);
        if (isMyTurn) {
          choose(msg.msg, msg.opts, actor);
        } else {
          setPrompt(`${actor ? actor.name : 'Player'} is making a choice...`);
        }
      }
      break;
    }
    case "WAIT_ITEM": {
      if (!NET.isHost && G) {
        G.cur = G.players[msg.playerIndex];
        render();
        const isMyTurn = (msg.playerIndex === NET.myPlayerIndex);
        if (isMyTurn) {
          awaitItemChoice(G.players[msg.playerIndex], msg.text, msg.label);
        } else {
          setPrompt(`Waiting for ${G.cur ? G.cur.name : 'player'} to choose items or roll...`);
        }
      }
      break;
    }
    case "WAIT_TARGET": {
      if (!NET.isHost && G) {
        G.cur = G.players[msg.playerIndex];
        render();
        const isMyTurn = (msg.playerIndex === NET.myPlayerIndex);
        if (isMyTurn) {
          awaitTarget({ targets: msg.targets, text: msg.text, label: msg.label });
        } else {
          setPrompt(`Waiting for ${G.cur ? G.cur.name : 'player'} to choose target...`);
        }
      }
      break;
    }
    case "LOG_LINE": {
      if (!NET.isHost) {
        const l = $("log");
        if (l) { l.innerHTML += `<div>${msg.html}</div>`; l.scrollTop = 1e6; }
        const big = $("biglog");
        if (big) { big.innerHTML += `<div>${msg.html}</div>`; big.scrollTop = 1e6; }
      }
      break;
    }
    case "FLY_ITEM": {
      if (!NET.isHost) {
        flyItem(msg.itemType, msg.from, msg.to, msg.mode, true);
      }
      break;
    }
    case "STATE_SYNC": {
      // Sync authoritative state from host
      applyStateSync(msg);
      break;
    }
    case "CHAT": {
      appendChatMessage(msg.sender, msg.text, msg.color);
      if (NET.isHost) {
        // Forward to other peers
        NET.connections.forEach(c => {
          if (c !== fromConn && c.open) c.send(msg);
        });
      }
      break;
    }
    case "PLAYER_LEFT": {
      log(`<b>${msg.name} has disconnected.</b>`);
      break;
    }
  }
}

// Dispatches remote action on the host or guest
function handleRemoteAction(action, playerIdx) {
  if (NET.isHost) {
    // Host forwards action to all other guests so their screens animate together
    NET.connections.forEach(c => {
      if (c.open && c.playerIndex !== playerIdx) {
        c.send({ type: "ACTION_SYNC", action, playerIndex: playerIdx });
      }
    });
  }

  if (action.type === "ROLL_LAUNCH") {
    launch(action.vx, action.vy, action.vals);
  } else if (action.type === "MOVE") {
    setPrompt("");
    if (NET.pendingMoveRes) {
      const res = NET.pendingMoveRes;
      NET.pendingMoveRes = null;
      res(action.result);
    }
  } else if (action.type === "CHOOSE") {
    setPrompt("");
    if (NET.pendingChoiceRes) {
      const res = NET.pendingChoiceRes;
      NET.pendingChoiceRes = null;
      res(action.val);
    }
  } else if (action.type === "ITEM_CHOICE") {
    setPrompt("");
    if (NET.pendingItemRes) {
      const res = NET.pendingItemRes;
      NET.pendingItemRes = null;
      res(action.val);
    }
  } else if (action.type === "TARGET") {
    setPrompt("");
    if (NET.pendingTargetRes) {
      const res = NET.pendingTargetRes;
      NET.pendingTargetRes = null;
      res(action.val);
    }
  }
}

// Broadcast helper for host
function broadcast(msg) {
  if (!NET.isHost) return;
  if (msg && typeof msg === "object" && !msg._mid) {
    msg._mid = Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  NET.connections.forEach(conn => {
    if (conn.rtcConn && conn.rtcConn.open) {
      try { conn.rtcConn.send(msg); } catch (e) {}
    }
    wsSend(conn.peer, msg);
  });
  httpSend("*", msg);
}

function broadcastLobby() {
  if (NET.isHost) {
    broadcast({ type: "LOBBY_STATE", rows: S.rows, n: S.n });
  }
}

// Send player lobby update
function sendLobbyUpdate(name, cls) {
  initRows();
  const idx = NET.myPlayerIndex;
  if (NET.isHost) {
    if (name !== undefined && name !== null) S.rows[0].name = name;
    if (cls !== undefined && cls !== null) S.rows[0].cls = cls;
    broadcastLobby();
    if (NET.onLobbyUpdate) NET.onLobbyUpdate();
  } else if (NET.hostConn && NET.hostConn.open) {
    const payload = { type: "LOBBY_ROW_UPDATE", index: idx };
    if (name !== undefined && name !== null) payload.name = name;
    if (cls !== undefined && cls !== null) payload.cls = cls;
    NET.hostConn.send(payload);
  }
}

// Send action (roll, move, choice, item)
function sendAction(action) {
  if (NET.isHost) {
    broadcast({ type: "ACTION_SYNC", action, playerIndex: 0 });
  } else if (NET.hostConn && NET.hostConn.open) {
    NET.hostConn.send({ type: "ACTION_REQ", action });
  }
}

// Chat functions
function sendChatMessage(text) {
  if (!text || !text.trim()) return;
  const pIdx = NET.myPlayerIndex;
  const sender = (S.rows[pIdx] && S.rows[pIdx].name) || `Player ${pIdx + 1}`;
  const color = COLORS[pIdx % COLORS.length];
  const msg = { type: "CHAT", sender, text: text.trim(), color };
  appendChatMessage(sender, text.trim(), color);
  if (NET.isHost) {
    broadcast(msg);
  } else if (NET.hostConn && NET.hostConn.open) {
    NET.hostConn.send(msg);
  }
}

function appendChatMessage(sender, text, color) {
  NET.chatHistory.push({ sender, text, color, time: new Date() });
  const chatView = $("chatView");
  if (chatView) {
    const d = document.createElement("div");
    d.className = "cmsg";
    d.innerHTML = `<span style="color:${color || '#fff3cf'}">${esc(sender)}:</span> ${esc(text)}`;
    chatView.appendChild(d);
    chatView.scrollTop = chatView.scrollHeight;
  }
}

// When guest receives full game start snapshot from host
function applyRemoteGameStart(msg) {
  G = msg.G;
  G.built = 0; // force buildBoard() and buildPanels() to construct DOM
  delete G.snkKey;
  delete G.numKey;
  delete G.itemKey;
  const rk = p => p.cls === "charmer" ? -1 : p.cls === "cat" ? 1 : 0;
  G.order = [...G.players].sort((a, b) => rk(a) - rk(b));
  const co = G.players.find(p => p.cls === "cat");
  if (co) G.catOwner = co;

  // Hide setup, show game
  $("setup").style.display = "none";
  $("game").style.display = "block";
  setPrompt("");
  const l = $("log"); if (l) { l.innerHTML = msg.logHtml || ""; l.scrollTop = 1e6; }
  const big = $("biglog"); if (big) { big.innerHTML = msg.logHtml || ""; big.scrollTop = 1e6; }
  render();
}

// When guest receives state snapshot during game
function applyStateSync(msg) {
  if (!G) return;
  // Apply changes
  if (msg.players) {
    msg.players.forEach((mp, i) => {
      if (G.players[i]) {
        G.players[i].pos = mp.pos;
        G.players[i].cb = mp.cb;
        G.players[i].pen = mp.pen;
        G.players[i].items = mp.items;
        G.players[i].big = mp.big;
      }
    });
  }
  if (msg.S) G.S = msg.S;
  if (msg.L) G.L = msg.L;
  if (msg.items) G.items = msg.items;
  if (msg.cat) G.cat = msg.cat;
  if (msg.catNow !== undefined) G.catNow = msg.catNow;
  if (msg.curIndex != null) G.cur = G.players[msg.curIndex];
  if (msg.winnerIndex != null) G.winner = G.players[msg.winnerIndex];
  render();
}
