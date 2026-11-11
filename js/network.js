// =====================================================================================
//  network.js  -  Multiplayer Layer (WebRTC P2P + SSE/HTTP/WS Fallback)
//  Provides room creation, join handshakes, ordered action routing, live drag previews,
//  chat, disconnect recovery, and authoritative state synchronization.
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
  unreadChat: 0,
  onLobbyUpdate: null,
  onJoinAck: null,
  onJoinDenied: null,
  disconnectTimer: null,
  reconnecting: false,

  // Pending host resolvers (paired with active actor index so disconnects can unblock)
  pendingActorIdx: null,
  pendingMoveRes: null,
  pendingChoiceRes: null,
  pendingItemRes: null,
  pendingTargetRes: null,

  // Relay & ordering state
  sse: null,
  sseConnected: false,
  httpEnabled: true,
  httpSeq: 0,
  httpPollAbort: null,
  httpOutbox: [],
  httpFlushing: false,
  stateSeq: 0,
  seenMsgs: new Set(),
  earlyQueue: [],      // Guest: buffers in-game packets arriving slightly before GAME_START
  lastDragSentAt: 0,
};

const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" }
  ]
};

const IN_GAME_TYPES = new Set([
  "STATE_SYNC", "WAIT_ROLL", "WAIT_MOVE", "WAIT_CHOOSE",
  "WAIT_ITEM", "WAIT_TARGET", "LOG_LINE", "ACTION_SYNC",
  "FLY_ITEM", "DRAG_MOVE", "GAME_OVER"
]);

function genRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function fullPeerId(code) {
  return "snc-" + code.toLowerCase();
}

function makeMsgId() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}

// ------------------------------------------------------------------ 1. FALLBACK TRANSPORTS
// PeerJS signaling WebSocket fallback (used ONLY on static hosts when WebRTC is blocked)
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
  } catch (e) {}
  return false;
}

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
      deliverRelayPacket(srcPeerId, raw.payload.data);
    }
  };

  const rawWs = sock._socket;
  if (typeof sock.on === "function" && !sock._sncHooked) {
    sock._sncHooked = true;
    sock.on("message", onRawMsg);
  } else if (rawWs && typeof rawWs.addEventListener === "function" && !rawWs._sncHooked) {
    rawWs._sncHooked = true;
    rawWs.addEventListener("message", ev => {
      try { onRawMsg(JSON.parse(ev.data)); } catch (e) {}
    });
  }
}

function deliverRelayPacket(srcPeerId, msg) {
  if (!msg) return;
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

// Ordered, batched FIFO HTTP sender for serve.py (/api/send) - prevents out-of-order POST races
function enqueueHttpSend(dstPeerId, data) {
  if (!NET.httpEnabled || !NET.roomCode || !NET.myId) return;
  // Coalesce ephemeral DRAG_MOVE packets in the outbox so drag previews never build a queue
  if (data && data.type === "DRAG_MOVE") {
    for (let i = NET.httpOutbox.length - 1; i >= 0; i--) {
      if (NET.httpOutbox[i].dst === (dstPeerId || "*") && NET.httpOutbox[i].data && NET.httpOutbox[i].data.type === "DRAG_MOVE") {
        NET.httpOutbox.splice(i, 1);
      }
    }
  }
  NET.httpOutbox.push({ dst: dstPeerId || "*", data });
  flushHttpOutbox();
}

async function flushHttpOutbox() {
  if (NET.httpFlushing || !NET.httpEnabled || !NET.httpOutbox.length) return;
  NET.httpFlushing = true;
  while (NET.httpEnabled && NET.httpOutbox.length) {
    const batch = NET.httpOutbox.splice(0, 32);
    try {
      const r = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room: NET.roomCode,
          src: NET.myId,
          batch
        })
      });
      if (r.status === 404 || r.status === 405) {
        NET.httpEnabled = false;
        const unsent = [...batch, ...NET.httpOutbox.splice(0)];
        unsent.forEach(it => {
          if (it.dst && it.dst !== "*") wsSend(it.dst, it.data);
          else if (NET.isHost) NET.connections.forEach(c => { if (c.open && !c.isRtcOpen()) wsSend(c.peer, it.data); });
        });
        break;
      }
    } catch (e) {
      break;
    }
  }
  NET.httpFlushing = false;
}

function stopServerRelay() {
  if (NET.sse) {
    try { NET.sse.close(); } catch (e) {}
    NET.sse = null;
  }
  NET.sseConnected = false;
  if (NET.httpPollAbort) {
    NET.httpPollAbort.stopped = true;
    NET.httpPollAbort = null;
  }
  NET.httpOutbox.length = 0;
}

// Connects instant SSE stream (/api/events) with automatic long-poll fallback (/api/poll?wait=8)
function startServerRelay() {
  stopServerRelay();
  NET.httpSeq = 0;
  if (/\.github\.io$/i.test(location.hostname)) {
    NET.httpEnabled = false;
    return;
  }
  NET.httpEnabled = true;

  const handleBatch = j => {
    if (!j) return;
    if (typeof j.seq === "number" && j.seq > NET.httpSeq) NET.httpSeq = j.seq;
    if (Array.isArray(j.msgs)) {
      for (const m of j.msgs) {
        if (m && m.data) deliverRelayPacket(m.src, m.data);
      }
    }
  };

  if (typeof EventSource !== "undefined") {
    const url = `/api/events?room=${encodeURIComponent(NET.roomCode)}&peer=${encodeURIComponent(NET.myId)}&after=${NET.httpSeq}`;
    const es = new EventSource(url);
    NET.sse = es;
    es.onopen = () => {
      NET.sseConnected = true;
    };
    es.onmessage = ev => {
      NET.sseConnected = true;
      try { handleBatch(JSON.parse(ev.data)); } catch (e) {}
    };
    es.onerror = () => {
      // If SSE fails to open (static host 404 or buffering proxy), fall back cleanly to long-polling
      if (!NET.sseConnected) {
        try { es.close(); } catch (e) {}
        NET.sse = null;
        startLongPollLoop(handleBatch);
      }
    };
  } else {
    startLongPollLoop(handleBatch);
  }
}

async function startLongPollLoop(handleBatch) {
  const token = { stopped: false };
  NET.httpPollAbort = token;
  while (!token.stopped && NET.active && NET.httpEnabled && NET.roomCode && NET.myId) {
    try {
      const r = await fetch(`/api/poll?room=${encodeURIComponent(NET.roomCode)}&peer=${encodeURIComponent(NET.myId)}&after=${NET.httpSeq}&wait=8`);
      if (token.stopped) break;
      if (!r.ok) {
        if (r.status === 404 || r.status === 405) NET.httpEnabled = false;
        break;
      }
      const j = await r.json();
      handleBatch(j);
    } catch (e) {
      await new Promise(res => setTimeout(res, 600));
    }
  }
}

// ------------------------------------------------------------------ 2. HYBRID CONNECTION
// Uses direct WebRTC DataChannel exclusively once open; falls back to SSE/HTTP or PeerJS WS only when needed
function createHybridConn(peerId, rtcConn) {
  return {
    peer: peerId,
    rtcConn: rtcConn || null,
    open: true,
    playerIndex: null,
    isRtcOpen() {
      return !!(this.rtcConn && this.rtcConn.open);
    },
    send(msg) {
      if (msg && typeof msg === "object" && !msg._mid && msg.type !== "DRAG_MOVE") {
        msg._mid = makeMsgId();
      }
      // Fast path: direct WebRTC DataChannel is open -> send ONLY via WebRTC (zero server/WS load!)
      if (this.isRtcOpen()) {
        try {
          this.rtcConn.send(msg);
          return;
        } catch (e) {}
      }
      // Fallback path for Symmetric NAT / CGNAT or while WebRTC is still shaking hands
      if (NET.httpEnabled) {
        enqueueHttpSend(this.peer, msg);
      } else {
        wsSend(this.peer, msg);
      }
    }
  };
}

// ------------------------------------------------------------------ 3. HOST & GUEST INIT
function initHost(customCode) {
  return new Promise((resolve, reject) => {
    initRows();
    NET.roomCode = (customCode || genRoomCode()).toUpperCase();
    const pid = fullPeerId(NET.roomCode);
    NET.isHost = true;
    NET.active = true;
    NET.myPlayerIndex = 0;
    NET.joined = true;
    NET.connections = [];
    NET.peerMap = {};
    NET.seenMsgs.clear();
    NET.earlyQueue = [];
    NET.stateSeq = 0;
    NET.myId = pid;
    startServerRelay();

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

    setTimeout(() => {
      if (NET.httpEnabled) finishHost();
    }, 1500);

    NET.peer.on("connection", conn => {
      handleIncomingConnection(conn);
    });

    NET.peer.on("error", err => {
      console.warn("PeerJS Host warning:", err);
      if (err.type === "unavailable-id" && !settled) {
        NET.peer.destroy();
        initHost().then(resolve).catch(reject);
      } else if (!settled && NET.httpEnabled) {
        finishHost();
      } else if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

function initGuest(code, playerName) {
  return new Promise((resolve, reject) => {
    NET.roomCode = code.toUpperCase().trim();
    const targetId = fullPeerId(NET.roomCode);
    NET.isHost = false;
    NET.active = true;
    NET.joined = false;
    NET.seenMsgs.clear();
    NET.earlyQueue = [];
    NET.myId = "guest-" + Math.random().toString(36).slice(2, 10);

    const hc = createHybridConn(targetId, null);
    NET.hostConn = hc;
    startServerRelay();

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

    // Immediate attempt over HTTP/SSE if served by serve.py
    setTimeout(sendJoinHandshake, 60);

    let tries = 0;
    joinRetryTimer = setInterval(() => {
      tries++;
      if (NET.joined) { cleanupRetry(); return; }
      if (tries > 10) {
        cleanupRetry();
        if (!settled) { settled = true; reject(new Error("Timed out waiting for Host response. Check room code.")); }
        return;
      }
      // If direct WebRTC hasn't opened yet and HTTP isn't enabled, also try WS relay explicitly
      if (!hc.isRtcOpen() && !NET.httpEnabled) {
        wsSend(targetId, { _mid: makeMsgId(), type: "JOIN_REQ", name: playerName || "Guest" });
      } else {
        sendJoinHandshake();
      }
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

      const rtcConn = NET.peer.connect(targetId, { reliable: true });
      hc.rtcConn = rtcConn;

      rtcConn.on("open", () => {
        if (!NET.joined) sendJoinHandshake();
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
    if (!NET.httpEnabled) {
      removeGuestConnection(hc);
    }
  });
}

function removeGuestConnection(hc) {
  if (!hc) return;
  const idx = NET.connections.indexOf(hc);
  if (idx !== -1) NET.connections.splice(idx, 1);
  if (hc.peer && NET.peerMap[hc.peer] === hc) delete NET.peerMap[hc.peer];
  if (hc.playerIndex != null) handlePlayerLeave(hc.playerIndex);
}

// Notify peers cleanly when tab closes or reloads
window.addEventListener("beforeunload", () => {
  if (!NET.active) return;
  try {
    if (NET.isHost) {
      broadcast({ type: "HOST_LEFT" });
    } else if (NET.hostConn) {
      const bye = { _mid: makeMsgId(), type: "BYE", playerIndex: NET.myPlayerIndex };
      if (NET.hostConn.isRtcOpen()) NET.hostConn.rtcConn.send(bye);
      if (NET.httpEnabled && navigator.sendBeacon && NET.roomCode && NET.myId) {
        navigator.sendBeacon("/api/send", JSON.stringify({
          room: NET.roomCode,
          src: NET.myId,
          dst: NET.hostConn.peer,
          data: bye
        }));
      }
    }
  } catch (e) {}
});

// ------------------------------------------------------------------ 4. DISCONNECT RECOVERY
function handlePeerDisconnect(who) {
  showNetworkBanner(`${who} disconnected! Reconnecting... (60s)`);
  let sec = 60;
  if (NET.disconnectTimer) clearInterval(NET.disconnectTimer);
  NET.disconnectTimer = setInterval(() => {
    sec--;
    if (sec <= 0) {
      clearInterval(NET.disconnectTimer);
      showNetworkBanner(`${who} left the game. Returning to lobby...`);
      setTimeout(() => location.reload(), 2000);
    } else {
      showNetworkBanner(`${who} disconnected! Waiting (${sec}s)...`);
    }
  }, 1000);
}

function handlePlayerLeave(playerIdx) {
  if (playerIdx == null) return;
  // If still in setup lobby, remove that slot cleanly
  if (!G) {
    const pName = (S.rows[playerIdx] && S.rows[playerIdx].name) || `Player ${playerIdx + 1}`;
    S.rows.splice(playerIdx, 1);
    S.n = Math.max(1, S.n - 1);
    // Re-index remaining guest connections above playerIdx
    NET.connections.forEach(c => {
      if (c.playerIndex > playerIdx) {
        c.playerIndex--;
        c.send({ type: "JOIN_ACK", yourIndex: c.playerIndex, rows: S.rows, n: S.n, roomCode: NET.roomCode });
      }
    });
    S.msg = `${pName} left the lobby.`;
    broadcastLobby();
    if (NET.onLobbyUpdate) NET.onLobbyUpdate();
    return;
  }

  // In-game disconnect: mark disconnected & unblock if Host was waiting on them!
  const p = G.players[playerIdx];
  if (!p || p.disconnected) return;
  p.disconnected = true;
  log(`<b>${esc(p.name)} disconnected and forfeits remaining turns.</b>`);
  broadcast({ type: "PLAYER_LEFT", index: playerIdx, name: p.name });

  if (NET.isHost && NET.pendingActorIdx === playerIdx) {
    if (DICE.waiting && !DICE.flying && DICE.done) {
      const vals = DICE.list.map(() => d6());
      launch(1, 0.4, vals);
    }
    if (NET.pendingMoveRes) {
      const fn = NET.pendingMoveRes; NET.pendingMoveRes = null; fn(null);
    }
    if (NET.pendingChoiceRes) {
      const fn = NET.pendingChoiceRes; NET.pendingChoiceRes = null; fn(0);
    }
    if (NET.pendingItemRes) {
      const fn = NET.pendingItemRes; NET.pendingItemRes = null; fn(null);
    }
    if (NET.pendingTargetRes) {
      const fn = NET.pendingTargetRes; NET.pendingTargetRes = null; fn(null);
    }
  }
}

function showNetworkBanner(text) {
  let el = $("netBanner");
  if (!el) {
    el = document.createElement("div");
    el.id = "netBanner";
    $("stage").appendChild(el);
  }
  if (!text) { el.style.display = "none"; return; }
  el.textContent = text;
  el.style.display = "block";
}

function hideNetworkBanner() {
  if (NET.disconnectTimer) { clearInterval(NET.disconnectTimer); NET.disconnectTimer = null; }
  const el = $("netBanner");
  if (el) el.style.display = "none";
}

// ------------------------------------------------------------------ 5. MESSAGE ROUTING
function handleNetData(msg, fromConn) {
  if (!msg || typeof msg !== "object") return;

  // If Guest receives in-game events milliseconds before GAME_START arrives, buffer instead of dropping!
  if (!NET.isHost && !G && IN_GAME_TYPES.has(msg.type)) {
    NET.earlyQueue.push({ msg, fromConn });
    return;
  }

  if (msg._mid) {
    if (NET.seenMsgs.has(msg._mid)) return;
    NET.seenMsgs.add(msg._mid);
    if (NET.seenMsgs.size > 1200) {
      const first = NET.seenMsgs.values().next().value;
      NET.seenMsgs.delete(first);
    }
  }

  switch (msg.type) {
    case "JOIN_REQ": {
      if (!NET.isHost) return;
      initRows();
      if (fromConn.playerIndex != null) {
        fromConn.send({ type: "JOIN_ACK", yourIndex: fromConn.playerIndex, rows: S.rows, n: S.n, roomCode: NET.roomCode });
        return;
      }
      if (S.n >= CONFIG.MAX_PLAYERS || (G && G.turnNo > 0)) {
        fromConn.send({ type: "JOIN_DENIED", reason: "Room is full or game already started." });
        return;
      }
      const pIdx = S.n++;
      fromConn.playerIndex = pIdx;
      if (!NET.connections.includes(fromConn)) {
        NET.connections.push(fromConn);
      }
      if (!S.rows[pIdx]) {
        S.rows[pIdx] = { name: msg.name || `Player ${pIdx + 1}`, cls: "", locked: false };
      } else {
        S.rows[pIdx].name = msg.name || `Player ${pIdx + 1}`;
        S.rows[pIdx].cls = "";
        S.rows[pIdx].locked = false;
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
      if (typeof msg.smsg === "string") S.msg = msg.smsg;
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
        const idx = msg.index != null ? msg.index : fromConn.playerIndex;
        if (idx != null && S.rows[idx]) {
          if (msg.name !== undefined && msg.name !== null) S.rows[idx].name = msg.name;
          if (msg.cls !== undefined && msg.cls !== null) S.rows[idx].cls = msg.cls;
          broadcastLobby();
          if (NET.onLobbyUpdate) NET.onLobbyUpdate();
        }
      }
      break;
    }
    case "BYE": {
      if (NET.isHost) {
        if (fromConn && fromConn.playerIndex == null && msg.playerIndex != null) {
          fromConn.playerIndex = msg.playerIndex;
        }
        removeGuestConnection(fromConn);
      }
      break;
    }
    case "HOST_LEFT": {
      if (!NET.isHost) {
        showNetworkBanner("Host closed the room. Returning to lobby...");
        setTimeout(() => location.reload(), 2000);
      }
      break;
    }
    case "GAME_START": {
      hideNetworkBanner();
      applyRemoteGameStart(msg);
      break;
    }
    case "ACTION_REQ": {
      const pIdx = msg.playerIndex != null ? msg.playerIndex : (fromConn ? fromConn.playerIndex : null);
      if (fromConn && fromConn.playerIndex == null && pIdx != null) fromConn.playerIndex = pIdx;
      handleRemoteAction(msg.action, pIdx);
      break;
    }
    case "ACTION_SYNC": {
      // Never re-apply our own echoed action!
      if (!NET.isHost && msg.playerIndex !== NET.myPlayerIndex) {
        handleRemoteAction(msg.action, msg.playerIndex);
      }
      break;
    }
    case "DRAG_MOVE": {
      if (msg.playerIndex !== NET.myPlayerIndex) {
        if (NET.isHost) {
          // Forward live drag to other guests
          forwardToOtherGuests(msg, msg.playerIndex);
        }
        applyRemoteDrag(msg);
      }
      break;
    }
    case "WAIT_ROLL": {
      if (!NET.isHost && G) {
        clearRemoteDragVisuals();
        G.cur = G.players[msg.playerIndex];
        if (msg.catNow !== undefined) G.catNow = msg.catNow;
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
        clearRemoteDragVisuals();
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
        clearRemoteDragVisuals();
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
        clearRemoteDragVisuals();
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
        clearRemoteDragVisuals();
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
        if (l) { l.insertAdjacentHTML("beforeend", `<div>${msg.html}</div>`); l.scrollTop = l.scrollHeight; }
        const big = $("biglog");
        if (big) { big.insertAdjacentHTML("beforeend", `<div>${msg.html}</div>`); big.scrollTop = big.scrollHeight; }
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
      applyStateSync(msg);
      break;
    }
    case "GAME_OVER": {
      if (!NET.isHost && G) {
        if (msg.winnerIndex != null && G.players[msg.winnerIndex]) {
          G.winner = G.players[msg.winnerIndex];
          sfx("big");
        }
        render();
        showLocalGameOverPrompt();
      }
      break;
    }
    case "CHAT": {
      appendChatMessage(msg.sender, msg.text, msg.color);
      if (NET.isHost) {
        forwardToOtherGuests(msg, fromConn ? fromConn.playerIndex : -1);
      }
      break;
    }
    case "PLAYER_LEFT": {
      if (!NET.isHost && G && G.players[msg.index]) {
        G.players[msg.index].disconnected = true;
      }
      break;
    }
  }
}

function forwardToOtherGuests(msg, excludePlayerIdx) {
  if (!NET.isHost) return;
  let needHttp = false;
  NET.connections.forEach(c => {
    if (!c.open || c.playerIndex === excludePlayerIdx) return;
    if (c.isRtcOpen()) {
      try { c.rtcConn.send(msg); } catch (e) {}
    } else if (NET.httpEnabled) {
      needHttp = true;
    } else {
      wsSend(c.peer, msg);
    }
  });
  if (needHttp) enqueueHttpSend("*", msg);
}

// ------------------------------------------------------------------ 6. LIVE DRAG PREVIEWS & REMOTE ACTIONS
function sendDragPreview(payload) {
  if (!NET.active) return;
  const now = performance.now();
  if (payload.kind !== "end" && now - NET.lastDragSentAt < 45) return;
  NET.lastDragSentAt = now;
  const msg = { type: "DRAG_MOVE", playerIndex: NET.myPlayerIndex, ...payload };
  if (NET.isHost) {
    forwardToOtherGuests(msg, 0);
  } else if (NET.hostConn && NET.hostConn.open) {
    NET.hostConn.send(msg);
  }
}

function clearRemoteDragVisuals() {
  document.querySelectorAll(".pw.rdrag").forEach(el => el.classList.remove("rdrag"));
  if (!DRAG && !TGT) {
    if ($("gGhost")) $("gGhost").innerHTML = "";
    if (G && G.built) setHL([]);
  }
}

function applyRemoteDrag(msg) {
  if (!G || !G.built) return;
  if (msg.kind === "end") {
    clearRemoteDragVisuals();
    render();
    return;
  }
  if (msg.kind === "die") {
    const d = DICE.list[msg.i];
    if (d && DICE.waiting && !DICE.flying) {
      d.mode = "held";
      d.x = msg.x;
      d.y = msg.y;
      dieClamp(d);
    }
  } else if (msg.kind === "pawn") {
    const pw = $("pw" + msg.playerIndex);
    if (pw) {
      pw.classList.add("rdrag");
      pw.style.transform = `translate(${f1(msg.x)}px,${f1(msg.y)}px) scale(.95)`;
      if (Array.isArray(msg.targets)) setHL(msg.targets);
    }
  } else if (msg.kind === "head") {
    if ($("gGhost") && msg.h) {
      $("gGhost").innerHTML = ghostSvg(msg.h, msg.x, msg.y);
      if (Array.isArray(msg.targets)) setHL(msg.targets);
    }
  }
}

function handleRemoteAction(action, playerIdx) {
  if (NET.isHost) {
    forwardToOtherGuests({ _mid: makeMsgId(), type: "ACTION_SYNC", action, playerIndex: playerIdx }, playerIdx);
  }

  clearRemoteDragVisuals();

  if (action.type === "ROLL_LAUNCH") {
    launch(action.vx, action.vy, action.vals, action.startDice);
  } else if (action.type === "MOVE") {
    setPrompt("");
    if (NET.pendingMoveRes) {
      const res = NET.pendingMoveRes;
      NET.pendingMoveRes = null;
      NET.pendingActorIdx = null;
      res(action.result);
    }
  } else if (action.type === "CHOOSE") {
    setPrompt("");
    if (NET.pendingChoiceRes) {
      const res = NET.pendingChoiceRes;
      NET.pendingChoiceRes = null;
      NET.pendingActorIdx = null;
      res(action.val);
    }
  } else if (action.type === "ITEM_CHOICE") {
    setPrompt("");
    if (NET.pendingItemRes) {
      const res = NET.pendingItemRes;
      NET.pendingItemRes = null;
      NET.pendingActorIdx = null;
      res(action.val);
    }
  } else if (action.type === "TARGET") {
    setPrompt("");
    if (NET.pendingTargetRes) {
      const res = NET.pendingTargetRes;
      NET.pendingTargetRes = null;
      NET.pendingActorIdx = null;
      res(action.val);
    }
  }
}

// ------------------------------------------------------------------ 7. BROADCAST, LOBBY, CHAT, STATE SYNC
function broadcast(msg) {
  if (!NET.isHost || !NET.connections.length) return;
  if (msg && typeof msg === "object" && !msg._mid) {
    msg._mid = makeMsgId();
  }
  let needHttp = false;
  NET.connections.forEach(conn => {
    if (!conn.open) return;
    if (conn.isRtcOpen()) {
      try { conn.rtcConn.send(msg); } catch (e) {}
    } else if (NET.httpEnabled) {
      needHttp = true;
    } else {
      wsSend(conn.peer, msg);
    }
  });
  if (needHttp) enqueueHttpSend("*", msg);
}

function broadcastLobby() {
  if (NET.isHost) {
    broadcast({ type: "LOBBY_STATE", rows: S.rows, n: S.n, smsg: S.msg || "" });
  }
}

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

function sendAction(action) {
  if (NET.isHost) {
    broadcast({ type: "ACTION_SYNC", action, playerIndex: 0 });
  } else if (NET.hostConn && NET.hostConn.open) {
    NET.hostConn.send({ type: "ACTION_REQ", action, playerIndex: NET.myPlayerIndex });
  }
}

function sendChatMessage(text) {
  if (!text || !text.trim()) return;
  const pIdx = NET.myPlayerIndex;
  const sender = (G && G.players[pIdx] && G.players[pIdx].name) || (S.rows[pIdx] && S.rows[pIdx].name) || `Player ${pIdx + 1}`;
  const color = COLORS[pIdx % COLORS.length];
  const msg = { type: "CHAT", sender, text: text.trim(), color };
  appendChatMessage(sender, text.trim(), color, true);
  if (NET.isHost) {
    broadcast(msg);
  } else if (NET.hostConn && NET.hostConn.open) {
    NET.hostConn.send(msg);
  }
}

function appendChatMessage(sender, text, color, isLocal) {
  NET.chatHistory.push({ sender, text, color, time: new Date() });
  const chatView = $("chatView");
  if (chatView) {
    const d = document.createElement("div");
    d.className = "cmsg";
    d.innerHTML = `<span style="color:${color || '#fff3cf'}">${esc(sender)}:</span> ${esc(text)}`;
    chatView.appendChild(d);
    chatView.scrollTop = chatView.scrollHeight;
  }
  if (!isLocal && typeof TAB !== "undefined" && TAB !== "chat") {
    NET.unreadChat++;
    const btn = $("tb_chat");
    if (btn) btn.classList.add("unread");
    sfx("small");
  }
}

function showLocalGameOverPrompt() {
  if (!G || !G.winner) return;
  if (typeof TAB !== "undefined" && TAB === "chat" && typeof showTab === "function") {
    showTab("boardlog");
  }
  setPrompt(`${G.winner.name} wins!`);
  const b = makeBtn("Play again", false);
  b.onclick = () => location.reload();
  $("btns").appendChild(b);
  $("prompt").classList.add("choice");
}

function applyRemoteGameStart(msg) {
  G = msg.G;
  G.built = 0;
  G._stateSeq = 0;
  delete G.snkKey;
  delete G.numKey;
  delete G.itemKey;
  const rk = p => p.cls === "charmer" ? -1 : p.cls === "cat" ? 1 : 0;
  G.order = [...G.players].sort((a, b) => rk(a) - rk(b));
  const co = G.players.find(p => p.cls === "cat");
  if (co) G.catOwner = co;

  $("setup").style.display = "none";
  $("game").style.display = "block";
  setPrompt("");
  const l = $("log"); if (l) { l.innerHTML = msg.logHtml || ""; l.scrollTop = 1e6; }
  const big = $("biglog"); if (big) { big.innerHTML = msg.logHtml || ""; big.scrollTop = 1e6; }
  render();

  // Flush any in-game packets that arrived slightly ahead of GAME_START
  if (NET.earlyQueue.length) {
    const q = NET.earlyQueue.splice(0);
    q.forEach(item => handleNetData(item.msg, item.fromConn));
  }
}

function applyStateSync(msg) {
  if (!G) return;
  if (typeof msg.stateSeq === "number") {
    if (G._stateSeq && msg.stateSeq < G._stateSeq) return;
    G._stateSeq = msg.stateSeq;
  }

  clearRemoteDragVisuals();
  let movedRemotely = false;

  if (msg.players) {
    msg.players.forEach((mp, i) => {
      const gp = G.players[i];
      if (gp) {
        if (gp.pos !== mp.pos) {
          const quiet = G._quietMove && G._quietMove.idx === i && G._quietMove.pos === mp.pos;
          if (!quiet) movedRemotely = true;
          gp.pos = mp.pos;
        }
        gp.cb = mp.cb;
        gp.pen = mp.pen;
        gp.items = mp.items;
        gp.big = mp.big;
      }
    });
  }
  G._quietMove = null;

  if (msg.cat && G.cat) {
    if (G.cat.pos !== msg.cat.pos) movedRemotely = true;
    G.cat = msg.cat;
  }
  if (msg.catSkin !== undefined && G.catSkin !== msg.catSkin) {
    G.catSkin = msg.catSkin;
    if ($("catimg") && ART.cats.length) $("catimg").setAttribute("href", catHref());
  }
  if (msg.S) G.S = msg.S;
  if (msg.L) G.L = msg.L;
  if (msg.items) G.items = msg.items;
  if (msg.catNow !== undefined) G.catNow = msg.catNow;
  if (msg.curIndex != null) G.cur = G.players[msg.curIndex];
  if (msg.winnerIndex != null) G.winner = G.players[msg.winnerIndex];

  if (movedRemotely) sfx("tock", 270);
  render();
}
