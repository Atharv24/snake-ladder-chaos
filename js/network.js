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
  connections: [],     // Host: array of DataConnections to guests
  hostConn: null,      // Guest: single DataConnection to host
  chatHistory: [],
  onLobbyUpdate: null,
  onAction: null,
  disconnectTimer: null,
  reconnecting: false,
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

// Initialize as Host
function initHost(customCode) {
  return new Promise((resolve, reject) => {
    initRows(); // ensure rows exist
    NET.roomCode = (customCode || genRoomCode()).toUpperCase();
    const pid = fullPeerId(NET.roomCode);
    NET.isHost = true;
    NET.active = true;
    NET.myPlayerIndex = 0;
    NET.connections = [];

    if (NET.peer) { try { NET.peer.destroy(); } catch (e) {} }
    NET.peer = new Peer(pid, { debug: 1 });

    NET.peer.on("open", id => {
      NET.myId = id;
      resolve(NET.roomCode);
    });

    NET.peer.on("connection", conn => {
      handleIncomingConnection(conn);
    });

    NET.peer.on("error", err => {
      console.error("PeerJS Host Error:", err);
      if (err.type === "unavailable-id") {
        // Room code collision, retry with a fresh random code
        NET.peer.destroy();
        initHost().then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
  });
}

// Initialize as Guest
function initGuest(code, playerName) {
  return new Promise((resolve, reject) => {
    NET.roomCode = code.toUpperCase().trim();
    const targetId = fullPeerId(NET.roomCode);
    NET.isHost = false;
    NET.active = true;

    if (NET.peer) { try { NET.peer.destroy(); } catch (e) {} }
    NET.peer = new Peer(null, { debug: 1 });

    NET.peer.on("open", id => {
      NET.myId = id;
      const conn = NET.peer.connect(targetId, { reliable: true });
      NET.hostConn = conn;

      conn.on("open", () => {
        // Handshake
        conn.send({ type: "JOIN_REQ", name: playerName || "Guest" });
        resolve(conn);
      });

      conn.on("data", data => {
        handleNetData(data, conn);
      });

      conn.on("close", () => {
        handlePeerDisconnect("Host");
      });

      conn.on("error", err => {
        console.error("Host connection error:", err);
        reject(err);
      });
    });

    NET.peer.on("error", err => {
      console.error("PeerJS Guest Error:", err);
      reject(err);
    });
  });
}

// Host handles incoming guest connections
function handleIncomingConnection(conn) {
  conn.on("data", data => handleNetData(data, conn));
  conn.on("close", () => {
    const idx = NET.connections.indexOf(conn);
    if (idx !== -1) {
      NET.connections.splice(idx, 1);
      handlePlayerLeave(conn.playerIndex);
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
  switch (msg.type) {
    case "JOIN_REQ": {
      if (!NET.isHost) return;
      initRows();
      if (S.n >= CONFIG.MAX_PLAYERS || (G && G.turnNo > 0)) {
        fromConn.send({ type: "JOIN_DENIED", reason: "Room is full or game already started." });
        return;
      }
      // Allocate next open player index
      const pIdx = S.n++;
      fromConn.playerIndex = pIdx;
      NET.connections.push(fromConn);
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
      NET.myPlayerIndex = msg.yourIndex;
      NET.roomCode = msg.roomCode;
      if (Array.isArray(msg.rows)) S.rows = msg.rows;
      if (typeof msg.n === "number") S.n = msg.n;
      hideNetworkBanner();
      if (NET.onLobbyUpdate) NET.onLobbyUpdate();
      break;
    }
    case "LOBBY_STATE": {
      if (Array.isArray(msg.rows)) S.rows = msg.rows;
      if (typeof msg.n === "number") S.n = msg.n;
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
  NET.connections.forEach(conn => {
    if (conn.open) conn.send(msg);
  });
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
