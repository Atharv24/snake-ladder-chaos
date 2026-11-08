// =====================================================================================
//  main.js  -  the setup screen, the Start button, the top-right icon buttons, and window scaling.
//  This file runs LAST. At the very bottom it draws the setup screen and starts loading the art.
// =====================================================================================

// initRows(): make sure there is a setup row (name + class) for every possible player.
function initRows() { while (S.rows.length < CONFIG.MAX_PLAYERS) S.rows.push({ name: `Player ${S.rows.length + 1}`, cls: "", locked: false }); }

// drawSetup(): (re)draw the start screen from S. Called at load, after any change on the screen, and when art finishes loading.
// S.pick = number of the player row whose class chooser is open (null = closed).
function drawSetup() {
  initRows();
  let h = `<h2>Snakes, Ladders and Chaos!</h2>`;

  // Mode Switcher: Local Play vs Online Multiplayer
  h += `<div class="mode-toggle">
    <button class="cbtn mode-btn ${S.mode === 'local' ? '' : 'alt'}" onclick="setGameMode('local')"><span>Local Pass & Play</span></button>
    <button class="cbtn mode-btn ${S.mode === 'online' ? '' : 'alt'}" onclick="setGameMode('online')"><span>Online Multiplayer</span></button>
  </div>`;

  if (S.mode === "local") {
    h += `<div class="top">Players: <select id="cnt" onchange="S.n=+this.value;drawSetup()">`;
    for (let i = CONFIG.MIN_PLAYERS; i <= CONFIG.MAX_PLAYERS; i++) h += `<option ${i === S.n ? "selected" : ""}>${i}</option>`;
    h += "</select></div>";
    for (let i = 0; i < S.n; i++) {
      const r = S.rows[i], c = CLASSES.find(c => c.id === r.cls);
      h += `<div class="row"><span class="dot" style="background:${COLORS[i]}"></span><input value="${esc(r.name)}" ${r.locked ? "disabled" : ""} onchange="S.rows[${i}].name=this.value">
<button class="cls" ${r.locked ? "disabled" : ""} onclick="S.pick=${i};drawSetup()">${c ? `<img src="${A(PORT[c.id] + ".svg")}" alt="">${c.name}` : "Pick a class"}<small>${r.locked ? "locked in" : "click to choose"}</small></button></div>`;
    }
    h += `<div id="smsg">${S.msg}</div><button class="cbtn go" onclick="start()"><span>Start game</span></button>`;
  } else {
    // Online Multiplayer Setup
    if (S.netState === "idle") {
      h += `<div style="margin: 20px 0; display:flex; gap: 20px; align-items:center;">
        <button class="cbtn" style="--s:1.5; width:280px" onclick="startHosting()"><span>Host Game</span></button>
        <span style="font-size:28px; color:#fff3cf;">or</span>
        <input id="joinCodeInput" placeholder="ROOM CODE" maxlength="6" style="text-transform:uppercase; width:220px; height:68px; font-size:32px; text-align:center;">
        <button class="cbtn alt" style="--s:1.5; width:240px" onclick="joinRoomPressed()"><span>Join Game</span></button>
      </div>`;
    } else if (S.netState === "hosting" || S.netState === "joining" || S.netState === "lobby") {
      const link = location.origin + location.pathname + "?room=" + NET.roomCode;
      h += `<div style="display:flex; align-items:center; gap:20px; margin-bottom:14px;">
        <div class="room-badge">Room Code: <b style="color:#c3f73a; letter-spacing:2px;">${NET.roomCode}</b></div>
        <button class="cbtn copy-btn" onclick="copyInviteLink('${link}')"><span>Copy Link</span></button>
        <span style="font-size:24px; color:#fff3cf;">${NET.isHost ? '(You are Host)' : '(Connected as Guest)'}</span>
        <button class="cbtn alt" style="--s:1.0; width:160px; margin-left:auto;" onclick="leaveOnlineLobby()"><span>Leave</span></button>
      </div>`;

      // Show connected player slots
      for (let i = 0; i < S.n; i++) {
        const r = S.rows[i] || { name: `Player ${i + 1}`, cls: "", locked: false };
        const c = CLASSES.find(c => c.id === r.cls);
        const isMe = (i === NET.myPlayerIndex);
        const canEdit = isMe;
        h += `<div class="row"><span class="dot" style="background:${COLORS[i]}"></span>
          <input value="${esc(r.name || `Player ${i + 1}`)}" ${canEdit ? "" : "disabled"} onchange="onPlayerNameChanged(${i}, this.value)">
          <button class="cls" ${canEdit ? "" : "disabled"} onclick="${canEdit ? `S.pick=${i};drawSetup()` : ''}">
            ${c ? `<img src="${A(PORT[c.id] + ".svg")}" alt="">${c.name}` : "Pick a class"}
            <small>${isMe ? "(You - click to choose)" : "Player slot"}</small>
          </button>
        </div>`;
      }

      h += `<div id="smsg">${S.msg}</div>`;
      if (NET.isHost) {
        h += `<button class="cbtn go" onclick="startOnlineGame()"><span>Start game</span></button>`;
      } else {
        h += `<div style="font-size:30px; color:#c3f73a; margin-top:20px;">Waiting for host to start the game...</div>`;
      }
    }
  }

  if (S.pick != null) {   // the class chooser
    h += `<div id="chooser" onclick="if(event.target===this){S.pick=null;drawSetup()}"><div class="grid">` +
      CLASSES.map(c => `<button class="card" onclick="onClassPicked('${c.id}')"><img src="${A(PORT[c.id] + ".svg")}" alt=""><div><b>${c.name}</b><span>${c.text}</span></div></button>`).join("") + `</div></div>`;
  }
  $("setup").innerHTML = h;
}

function setGameMode(m) {
  S.mode = m;
  S.msg = "";
  drawSetup();
}

async function startHosting() {
  initRows();
  S.msg = "Connecting to Peer network...";
  drawSetup();
  try {
    await initHost();
    S.netState = "lobby";
    S.n = 1;
    S.msg = `Room ${NET.roomCode} ready! Share the code or link with friends.`;
    NET.onLobbyUpdate = () => drawSetup();
    drawSetup();
  } catch (err) {
    S.msg = "Failed to create room: " + (err.message || err);
    S.netState = "idle";
    drawSetup();
  }
}

async function joinRoomPressed() {
  const code = ($("joinCodeInput") && $("joinCodeInput").value) || "";
  if (!code.trim()) { S.msg = "Please enter a room code."; return drawSetup(); }
  await joinRoom(code.trim());
}

async function joinRoom(code) {
  initRows();
  S.msg = `Joining room ${code.toUpperCase()}...`;
  drawSetup();
  try {
    const myName = `Guest ${Math.floor(Math.random() * 900 + 100)}`;
    await initGuest(code, myName);
    S.netState = "lobby";
    S.msg = `Connected to room ${NET.roomCode}!`;
    NET.onLobbyUpdate = () => drawSetup();
    drawSetup();
  } catch (err) {
    S.msg = "Failed to connect to room " + code.toUpperCase();
    S.netState = "idle";
    drawSetup();
  }
}

function leaveOnlineLobby() {
  if (NET.peer) {
    try { NET.peer.destroy(); } catch (e) {}
  }
  NET.active = false;
  NET.isHost = false;
  S.netState = "idle";
  S.rows = [];
  S.n = 2;
  S.msg = "";
  drawSetup();
}

function copyInviteLink(link) {
  navigator.clipboard.writeText(link).then(() => {
    S.msg = "Invite link copied to clipboard!";
    drawSetup();
  }).catch(() => {
    prompt("Copy invite link:", link);
  });
}

function onPlayerNameChanged(idx, val) {
  initRows();
  if (S.rows[idx]) S.rows[idx].name = val;
  if (NET.active) sendLobbyUpdate(val, undefined);
}

function onClassPicked(clsId) {
  initRows();
  const idx = S.pick;
  if (S.rows[idx]) S.rows[idx].cls = clsId;
  S.pick = null;
  if (NET.active) sendLobbyUpdate(undefined, clsId);
  drawSetup();
}

function startOnlineGame() {
  if (!NET.isHost) return;
  start();
}

// start(): the Start button. Checks the setup (two players can't share a class: they roll off, the loser picks again), then builds the game and begins play().
function start() {
  S.pick = null;
  if (!ART.ready) { S.msg = ART.error || "The art is still loading, try again in a moment."; return drawSetup(); }
  const rows = S.rows.slice(0, S.n); S.msg = "";
  if (rows.some(r => !r.cls)) { S.msg = "Every player needs a class."; return drawSetup(); }
  let conflict = false;
  for (const c of CLASSES) {
    const all = rows.filter(r => r.cls === c.id);
    if (all.length < 2) continue;
    conflict = true;
    let cand = all;
    while (cand.length > 1) {   // roll-off until one player has the highest roll
      const rl = cand.map(() => d6());
      S.msg += `${c.name} roll-off: ${cand.map((r, i) => `${r.name} ${rl[i]}`).join(", ")}. `;
      const m = Math.max(...rl); cand = cand.filter((_, i) => rl[i] === m);
    }
    S.msg += `${cand[0].name} keeps ${c.name}; the others pick again. `;
    all.forEach(r => { if (r !== cand[0]) { r.cls = ""; r.locked = false; } });
    cand[0].locked = true;
  }
  if (conflict) {
    if (NET.active && NET.isHost) broadcastLobby();
    return drawSetup();
  }
  // G = the new game. players: name/class/position(pos)/colour. L = ladders, S = snakes, cobra = long snake's tail.
  // cat = the cat token (or null), catSkin = which cat picture is showing, catNow = true while the cat's own turn is running.
  G = { players: rows.map((r, i) => ({ name: r.name || `Player ${i + 1}`, cls: r.cls, pos: 1, color: COLORS[i], items: [] })), items: [], turnNo: 0, ...genBoard(), cat: null, catSkin: rnd(0, 5), catNow: false, winner: null, cur: null };
  assignKinds();
  const co = G.players.find(p => p.cls === "cat");
  if (co) { G.cat = { pos: 1 }; G.catOwner = co; }
  $("setup").style.display = "none"; $("game").style.display = "block";
  $("log").innerHTML = "";
  setPrompt(""); log("<b>Welcome to Snakes, Ladders and Chaos! May the best player win.</b>");
  render();
  for (let i = 0; i < ITEM_START; i++) spawnItem(true);                       // the game starts with a few items lying around
  log("Items are scattered across the board: step on one to pick it up!");

  if (NET.active && NET.isHost) {
    // Send a clean snapshot of the game state (without circular / DOM references)
    const snapshot = {
      players: G.players,
      items: G.items,
      turnNo: G.turnNo,
      L: G.L,
      S: G.S,
      cobra: G.cobra,
      kind: G.kind,
      cat: G.cat,
      catSkin: G.catSkin,
      catNow: G.catNow,
      winner: null,
      cur: G.cur
    };
    broadcast({ type: "GAME_START", G: snapshot, logHtml: $("log").innerHTML });
  }

  play();
}

// ---- the five round buttons at the top right. They are TABS: the selected one (light, pressed down) decides what the panel below shows. ----
// openModal(title, html): show a big pop-up window with a Close button (used by the Expand button).
function openModal(title, html) {
  const m = $("modal");
  m.innerHTML = `<div><h2>${title}</h2>${html}<p style="margin-top:18px"><button class="cbtn" style="--s:1.5;width:220px" onclick="$('modal').style.display='none'"><span>Close</span></button></p></div>`;
  m.style.display = "block";
}
// TOP = [ file-name part, tab title ]. The order here is the order on screen.
const TOP = [["settings", "Settings"], ["rulebook", "Rulebook"], ["boardlog", "Board log"], ["chat", "Chat"], ["about", "About"]];
// The rulebook text itself lives in js/rulebook.js (RULES_HTML).
$("rulebook").innerHTML = RULES_HTML();
// The About tab text (edit here).
$("about").innerHTML = "<p><b>Snakes, Ladders and Chaos!</b></p><p>Made by Hafiz Shaikh.</p><p>No AI assets were used in the design, Claude wrote the code with a few changes here and there from me.</p>";
// ---- Settings tab: Sound Effects volume bar (10 steps). Orange = selected volume, blue = the whole bar, lime outline on every step. ----
// drawSettings(): (re)draw the volume bar from VOLUME (audio.js).
function drawSettings() {
  let bar = "";
  for (let i = 1; i <= 10; i++) bar += `<div class="seg${i <= VOLUME ? " on" : ""}" title="${i * 10}%" onclick="setVolume(${i})"></div>`;
  $("settings").innerHTML = `<p>Sound effects</p><div class="volbar">${bar}</div><p class="volnum">${VOLUME ? VOLUME * 10 + "%" : "Muted"}</p>`;
}
// setVolume(n): called when step n of the bar is clicked. Clicking step 1 while it is the only one lit mutes; any other step selects that volume.
function setVolume(n) {
  VOLUME = (n === 1 && VOLUME === 1) ? 0 : n;
  try { localStorage.setItem("snc_volume", VOLUME); } catch (e) { /* not saved: fine */ }
  drawSettings(); sfx("small");   // play a click so you can hear the new level
}
drawSettings();
let TAB = "boardlog";   // the tab being shown
// showTab(k): switch the panel to tab k, and update the buttons (active = light + pressed, others = dark + raised).
function showTab(k) {
  TAB = k;
  TOP.forEach(b => {
    const on = b[0] === k;
    $("tb_" + b[0]).classList.toggle("on", on);
    $("tb_" + b[0]).querySelector(".face").src = A(`button_${b[0]}_${on ? "light" : "dark"}.svg`);
  });
  $("ptitle").textContent = TOP.find(b => b[0] === k)[1];
  $("log").style.display = k === "boardlog" ? "block" : "none";
  $("rulebook").style.display = k === "rulebook" ? "block" : "none";
  $("about").style.display = k === "about" ? "block" : "none";
  $("settings").style.display = k === "settings" ? "block" : "none";
  $("chatView").style.display = k === "chat" ? "block" : "none";
  $("chatInputBar").style.display = k === "chat" ? "flex" : "none";
  $("soon").style.display = "none";
  $("expand").style.display = (k === "boardlog" || k === "rulebook") ? "block" : "none";   // only working panels can expand
}

function chatSendPressed() {
  const inp = $("chatInput");
  if (!inp || !inp.value.trim()) return;
  sendChatMessage(inp.value);
  inp.value = "";
}
// expandPanel(): the Expand button - show the current panel's content in a big pop-up with larger text.
function expandPanel() {
  if (TAB === "rulebook") openModal("Rulebook", `<div class="big">${RULES_HTML()}</div>`);
  else { openModal("Board log", `<div class="big biglog" id="biglog">${$("log").innerHTML}</div>`); $("biglog").scrollTop = 1e6; }
}
$("topbtns").innerHTML = TOP.map((b, i) => `<button class="ib" id="tb_${b[0]}" style="left:${1484 + i * 84.5}px" title="${b[1]}" onclick="showTab('${b[0]}')"><img class="bsh" src="${A("button_shadow.svg")}" alt=""><img class="face" src="${A("button_" + b[0] + "_dark.svg")}" alt="${b[1]}"></button>`).join("");
showTab("boardlog");

// fit(): scale the fixed 1920x1080 stage to fill the window (with bars at the sides/top if the window isn't 16:9). Runs on load and whenever the window is resized.
function fit() { const s = Math.min(innerWidth / 1920, innerHeight / 1080); $("stage").style.transform = `translate(${(innerWidth - 1920 * s) / 2}px,${(innerHeight - 1080 * s) / 2}px) scale(${s})`; }
addEventListener("resize", fit); fit();

// ---- the three containers behind the sections ----
$("boxes").innerHTML = BOXES.map(b => `<div class="box" id="${b.id}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px"></div>`).join("");

// ---- start-up ----
loadSounds();                   // decode the sound effects in the background (see audio.js)
drawSetup();                    // show the setup screen straight away
loadAssets().then(() => {
  drawSetup();
  // Auto-join room from URL query param ?room=CODE
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get("room");
  if (roomParam) {
    setGameMode("online");
    joinRoom(roomParam);
  }
});
