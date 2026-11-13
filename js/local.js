// =====================================================================================
//  local.js  -  the LOCAL screen (one line per player) and the CLASS PICK panels. Loaded after title.js.
//  Player names / classes / count are stored in the same S object the old setup screen uses (S.rows, S.n), so start() works unchanged.
//  Colours: css/style.css, section "LOCAL SCREEN". Class info shown on the panels: CLASS_BRIEF in config.js. Full text: CLASS_RULES in rulebook.js.
// =====================================================================================

// Player lines. Geometry is taken from docs/Local_Screen.jpg (6 players). With fewer players the lines are scaled up: 2 players = height of the Local button (165px), 6 = 99px.
const LROW = { x: 237, y: 248, pitch: 123.4, h: 99, hMax: 165 };
const lrowScale = n => (LROW.hMax - (n - 2) * (LROW.hMax - LROW.h) / 4) / LROW.h;
const LBASE = 49.9;   // font size (px) of "Pick a Class"; long class names shrink to fit

// Class pick panels: 6 panels (art 264 x 806) side by side. The head is centred on the panel's circle (128,128); width/height ratio of each head's art is in HEAD_RATIO.
const PK = { w: 264, h: 806, gap: 28, off: 1100 };
const pkLeft = k => k * (PK.w + PK.gap);   // left edge of panel k inside the panel row, which is centred on the window and sits on the window's bottom edge (css #pkPanels)
const HEAD_RATIO = { bully: .926, gambler: 1.269, cat: .965, struggler: .832, oracle: 1.078, charmer: .836 };
const HEAD_BOX = { w: 212, h: 200, wideW: 242 };   // a head fits inside this box; the Gambler (very wide art) is allowed a wider box so he does not shrink much

let _cv; function fitFont(text) { _cv = _cv || document.createElement("canvas").getContext("2d"); _cv.font = LBASE + "px MC"; return Math.min(LBASE, Math.floor(LBASE * 205 / _cv.measureText(text).width)); }
const slideIn = (el, dx, delay) => el.animate([{ opacity: 0, transform: `translateX(${dx}px)` }, { opacity: 1, transform: "none" }], { duration: 380, delay, easing: EASE_BOUNCE, fill: "backwards" });
const slideOut = (el, dx, delay) => el.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateX(${dx}px)` }], { duration: 260, delay, easing: EASE_IN, fill: "both" });

// buildLocal(): create the Local screen and the pick overlay once.
function buildLocal() {
  const root = $("title"), L = document.createElement("div"); L.id = "tLocal";
  let h = "";
  for (let i = 0; i < CONFIG.MAX_PLAYERS; i++) h += `<div class="lrow" data-i="${i}"><div class="lin"><div class="lbadge c${i % 2}"><span class="tb-shine"></span><span class="lb-t">P${i + 1}</span></div><span class="lchev"></span><input class="lname" data-i="${i}" maxlength="14" placeholder="Player ${i + 1}" autocomplete="off"><button class="lcls c${i % 2}" data-i="${i}"></button></div></div>`;
  h += `<div id="tCnt"><span class="cl">PLAYERS:</span><button id="tCntBtn" aria-label="Number of players"><b id="tCntNum">6</b><i></i><svg viewBox="0 0 24 14"><path d="M3 3L12 11.5 21 3" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="square"/></svg></button><div id="tCntMenu">${[2, 3, 4, 5, 6].map(v => `<button data-v="${v}">${v}</button>`).join("")}</div></div>`;
  h += `<div id="tHost" class="tgrp"><button class="cbtn hbtn" id="hGen"><span><i class="tb-shine"></i><b class="ht">Generate Code</b></span></button><div class="hcode empty" id="hCode">- - - - -</div><button class="cbtn hbtn" id="hCopy"><span><i class="tb-shine"></i><b class="ht">Copy Direct Link</b></span></button></div>` +
       `<div id="tJoin" class="tgrp"><input class="hcode" id="jCode" maxlength="6" placeholder="ENTER CODE" autocomplete="off" spellcheck="false"><button class="cbtn hbtn" id="jBtn"><span><i class="tb-shine"></i><b class="ht">Join Lobby</b></span></button></div><div id="tToast"></div><div id="tWait">Waiting for the host...</div>`;
  h += `<button class="tbtn" id="tStart" style="left:1500px;top:860px"><span class="tb-rim"></span><span class="tb-face">${themeSvg(TT.btnSvg)}<span class="tb-shine"></span><span class="tb-label">START</span></span></button>`;
  L.innerHTML = h; root.appendChild(L);
  L.querySelectorAll(".lname").forEach(el => {
    const i = +el.dataset.i, nm = () => el.value.trim() || `Player ${i + 1}`;
    el.oninput = () => { if (S.mode === "online") onPlayerNameInput(i, nm()); else S.rows[i].name = nm(); };   // online: also sent to the other players
    el.onchange = () => { if (S.mode === "online") onPlayerNameChanged(i, nm()); };
  });
  L.querySelectorAll(".lcls").forEach(el => el.onclick = () => openPick(+el.dataset.i));
  $("tCntBtn").onclick = e => { e.stopPropagation(); $("tCntMenu").classList.toggle("open"); };
  $("tCntMenu").querySelectorAll("button").forEach(b => b.onclick = () => { S.n = +b.dataset.v; layoutRows(); });
  root.addEventListener("click", () => $("tCntMenu") && $("tCntMenu").classList.remove("open"));
  $("tStart").onclick = () => {
    const online = S.mode === "online";
    if (online && !NET.isHost) return;
    if (online && S.n < CONFIG.MIN_PLAYERS) return toast($("tStart"), "Need 2 players!", false, "above");
    const missing = [...L.querySelectorAll(".lrow")].slice(0, S.n).filter((el, i) => !S.rows[i].cls);
    if (missing.length) { missing.forEach(el => el.classList.add("need")); setTimeout(() => missing.forEach(el => el.classList.remove("need")), 1500); return; }   // shine + chevron on whoever has not picked yet
    leaveTitle(); online ? startOnlineGame() : start();   // the game's own Start (handles two players picking the same class)
  };
  $("hGen").onclick = hostGenerate; $("hCopy").onclick = copyLink; $("jBtn").onclick = joinPressed;
  $("jCode").onkeydown = e => { if (e.key === "Enter") joinPressed(); };
  // the pick overlay: dark layer, X button, the six panels, and the full-rules popup
  const P = document.createElement("div"); P.id = "tPick";
  P.innerHTML = `<div class="pk-dim"></div><button class="pk-x" aria-label="Close"></button><div id="pkPanels">` + CLASSES.map((c, k) => {
    const hh = Math.min(HEAD_BOX.h, (c.id === "gambler" ? HEAD_BOX.wideW : HEAD_BOX.w) / HEAD_RATIO[c.id]);
    return `<div class="pk-slot"><div class="pk-panel" data-k="${k}"><img class="pk-art" src="${A("panel_pick_" + (k % 2 ? "dark" : "light") + ".svg")}" alt=""><img class="pk-head" src="${A(PORT[c.id] + ".svg")}" alt="" style="height:${hh}px">` +
      `<div class="pk-name${c.name.length > 14 ? " long" : ""}">${c.name}</div>` +
      `<div class="pk-desc"><div class="pk-scroll"><ul>${CLASS_BRIEF[c.id].pts.map(t => `<li>${t}</li>`).join("")}</ul></div><button class="pk-more" aria-label="Full description"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 4h6M4 4v6M4 4l6 6M20 20h-6M20 20v-6M20 20l-6-6M20 4h-6M20 4v6M20 4l-6 6M4 20h6M4 20v-6M4 20l6-6" fill="none" stroke="#2f2504" stroke-width="2.4" stroke-linecap="round"/></svg></button></div>` +
      `<button class="pk-pick" aria-label="Pick ${c.name}"><span class="tb-shine"></span></button><span class="pk-shine"></span></div></div>`;
  }).join("") + `</div><div id="tFull"><div class="tf-card"></div></div>`;
  document.body.appendChild(P);   // lives outside the scaled stage so the dark layer covers the whole window and the panels can sit on the window's bottom edge
  TT.pkPanels = [...P.querySelectorAll(".pk-panel")];
  addEventListener("resize", () => { if (TT.pickOpen) layoutPanels(); });
  TT.pkPanels.forEach((p, k) => { p.querySelector(".pk-pick").onclick = () => pickClass(k); p.querySelector(".pk-more").onclick = () => openFull(k); });
  P.querySelector(".pk-x").onclick = closePick;
  P.addEventListener("click", e => { if (!e.target.closest(".pk-panel, .pk-x, .tf-card")) { if ($("tFull").style.display === "block") closeFull(); else closePick(); } });   // click anywhere else = back
}

// layoutRows(): place the visible player lines (bigger when fewer players); extra lines fade out.
function layoutRows() {
  const online = S.mode === "online", max = CONFIG.MAX_PLAYERS;
  const n = online ? Math.max(0, Math.min(max, S.n || 0)) : (S.n = Math.min(max, Math.max(CONFIG.MIN_PLAYERS, S.n || max))), s = lrowScale(Math.max(2, n));
  $("tLocal").querySelectorAll(".lrow").forEach((el, i) => {
    const on = i < n;
    el.style.left = LROW.x + "px"; el.style.top = (LROW.y + i * LROW.pitch * s) + "px";
    el.style.transform = `scale(${on ? s : s * .7})`; el.style.opacity = on ? 1 : 0; el.style.pointerEvents = on ? "auto" : "none";
  });
  $("tCntNum").textContent = S.n; $("tCntMenu").classList.remove("open");
}
// refreshRow(i): show the row's current class (head + name) or "Pick a Class". Online, only your own line can be changed.
function refreshRow(i) {
  const r = S.rows[i], b = $("tLocal").querySelector(`.lcls[data-i="${i}"]`), c = r && CLASSES.find(c => c.id === r.cls);
  if (!r) return;
  b.disabled = S.mode === "online" && i !== NET.myPlayerIndex;
  b.innerHTML = `<span class="tb-shine"></span>` + (c ? `<img src="${A(PORT[c.id] + ".svg")}" alt=""><span class="lt" style="font-size:${fitFont(c.name)}px">${c.name}</span>` : `<span class="lt">Pick a Class</span>`);
}
// syncRows(): copy names / classes from S into the lines (used when the lobby changes online)
function syncRows() {
  const online = S.mode === "online";
  $("tLocal").querySelectorAll(".lname").forEach((el, i) => {
    const r = S.rows[i]; if (!r) return;
    if (document.activeElement !== el) el.value = r.name === `Player ${i + 1}` ? "" : (r.name || "");
    el.disabled = online && i !== NET.myPlayerIndex; refreshRow(i);
  });
  $("tStart").style.display = (S.mode === "join" || (online && !NET.isHost)) ? "none" : "";
  $("tWait").style.display = online && NET.active && !NET.isHost ? "block" : "none";
}
function onlineLobbyUpdate() { layoutRows(); syncRows(); }

// showLocal(mode): the lobby screen for "local", "host" or "join" - the lines slide in from the right one by one.
async function showLocal(mode) {
  TT.lmode = mode;
  await (document.fonts && document.fonts.load("40px MC").catch(() => {}));
  if (!$("tLocal")) buildLocal();
  const L = $("tLocal"), online = mode !== "local"; L.dataset.mode = mode;
  if (online) { if (NET.active) leaveOnlineLobby(); S.mode = "online"; S.netState = "idle"; S.rows = []; initRows(); S.n = mode === "host" ? 1 : 0; NET.onLobbyUpdate = onlineLobbyUpdate; }
  else { setGameMode("local"); initRows(); }
  $("hCode").textContent = "- - - - -"; $("hCode").classList.add("empty"); $("jCode").value = ""; $("jCode").disabled = false; $("jBtn").disabled = false; $("jBtn").querySelector(".ht").textContent = "Join Lobby"; $("tToast").style.display = "none";
  L.style.display = "block"; layoutRows(); syncRows();
  const grp = { local: $("tCnt"), host: $("tHost"), join: $("tJoin") }[mode];
  const items = [...L.querySelectorAll(".lrow")].slice(0, S.n).map(r => r.firstChild).concat([grp, $("tStart")]);
  await Promise.race([Promise.all(items.map((el, k) => slideIn(el, 160, k * 60).finished)), sleep(1200)]);
}
// hideLocal(): back - the lines slide out the way they came, last first. Leaving an online lobby disconnects.
async function hideLocal() {
  const L = $("tLocal"), grp = { local: $("tCnt"), host: $("tHost"), join: $("tJoin") }[TT.lmode];
  const items = [$("tStart"), grp].concat([...L.querySelectorAll(".lrow")].slice(0, S.n).reverse().map(r => r.firstChild));
  const an = items.map((el, k) => slideOut(el, 160, k * 50));
  await Promise.race([Promise.all(an.map(a => a.finished)), sleep(900)]);
  L.style.display = "none"; an.forEach(a => a.cancel());
  if (TT.lmode !== "local" && NET.active) leaveOnlineLobby();
  TT.net = false;
}

// toast(anchor, text, ok, pos): a small rounded pop-up beside a button that vanishes by itself (pos: "right" | "below" | "above")
function toast(anchor, text, ok, pos) {
  const el = $("tToast"), g = anchor.parentElement, gx = g.id === "tLocal" ? 0 : g.offsetLeft, gy = g.id === "tLocal" ? 0 : g.offsetTop;
  el.textContent = text; el.className = ok ? "ok" : "bad"; el.style.display = "flex";
  const x = gx + anchor.offsetLeft, y = gy + anchor.offsetTop, w = anchor.offsetWidth, h = anchor.offsetHeight;
  el.style.left = (pos === "below" || pos === "above" ? x : x + w + 18) + "px";
  el.style.top = (pos === "below" ? y + h + 12 : pos === "above" ? y - 64 : y + (h - 52) / 2) + "px";
  el.getAnimations().forEach(a => a.cancel());
  const a = el.animate([{ opacity: 0, transform: "scale(.6)" }, { opacity: 1, transform: "scale(1)", offset: .12 }, { opacity: 1, transform: "scale(1)", offset: .86 }, { opacity: 0, transform: "scale(.92)" }], { duration: 2300, easing: "cubic-bezier(.2,1.4,.4,1)" });
  a.onfinish = () => { el.style.display = "none"; };
}
// hostGenerate(): the Generate Code button - open a room and show its code
async function hostGenerate() {
  if (TT.net) return;
  if (NET.active && NET.isHost && S.n > 1) return toast($("hGen"), "Players are connected!", false, "below");
  TT.net = true; const t = $("hGen").querySelector(".ht"); $("hGen").disabled = true; t.textContent = "Generating...";
  try {
    if (NET.active) leaveOnlineLobby();
    S.mode = "online"; S.rows = []; initRows(); S.n = 1; NET.onLobbyUpdate = onlineLobbyUpdate;
    await initHost(); S.netState = "lobby";
    $("hCode").textContent = NET.roomCode; $("hCode").classList.remove("empty"); onlineLobbyUpdate();
  } catch (err) { toast($("hGen"), "Could not create lobby!", false, "below"); }
  t.textContent = "Generate Code"; $("hGen").disabled = false; TT.net = false;
}
// copyLink(): the Copy Direct Link button - an invite link that opens straight into the Join screen
function copyLink() {
  if (!NET.active || !NET.roomCode) return toast($("hCopy"), "Generate a code first!", false, "below");
  const link = location.origin + location.pathname + "?room=" + NET.roomCode, ok = () => toast($("hCopy"), "Link copied!", true, "below");
  (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(ok).catch(() => {
    try { const ta = document.createElement("textarea"); ta.value = link; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); ok(); } catch (e) { prompt("Copy this link:", link); }
  });
}
// joinPressed(): the Join Lobby button - try the typed code; a small pop-up says what happened
async function joinPressed() {
  if (TT.net) return;
  const code = ($("jCode").value || "").trim().toUpperCase();
  if (!code) return toast($("jBtn"), "Enter a code!", false, "right");
  TT.net = true; const t = $("jBtn").querySelector(".ht"); $("jBtn").disabled = true; t.textContent = "Joining...";
  try {
    if (NET.active) leaveOnlineLobby();
    S.mode = "online"; S.rows = []; initRows(); S.n = 0; NET.onLobbyUpdate = onlineLobbyUpdate;
    await initGuest(code, "Player"); S.netState = "lobby";
    $("jCode").disabled = true; t.textContent = "Joined"; onlineLobbyUpdate();
    toast($("jBtn"), "Room Found!", true, "right");
  } catch (err) {
    if (NET.active) leaveOnlineLobby();
    S.mode = "online"; initRows(); S.n = 0; NET.onLobbyUpdate = onlineLobbyUpdate; onlineLobbyUpdate();
    t.textContent = "Join Lobby"; $("jBtn").disabled = false;
    toast($("jBtn"), /full|started/i.test(err && err.message) ? "Lobby is full!" : "Can't find Lobby!", false, "right");
  }
  TT.net = false;
}
// autoJoin(code): used by invite links - fill the code and join straight away
function autoJoin(code) { $("jCode").value = code.toUpperCase().slice(0, 6); joinPressed(); }

// leaveTitle(): the game itself is starting - remove the title screen completely.
function leaveTitle() { $("title").classList.remove("on"); document.body.classList.remove("on-title"); document.documentElement.classList.remove("on-title"); }

// ---- class pick panels ----
// layoutPanels(): make the panels as big as the window allows - as wide as fits, never taller than the window (a little room is kept on top for the X button) -
// with the same space between panels and at the far left and right, whatever the window shape. Panels sit on the window's bottom edge.
function layoutPanels() {
  const p = Math.min(innerWidth / (6 * PK.w + 7 * 28), innerHeight * .88 / PK.h), gap = (innerWidth - 6 * PK.w * p) / 7;
  TT.pkScale = p; TT.pkGap = gap;
  TT.pkPanels.forEach((pn, k) => { const s = pn.parentElement; s.style.left = (gap + k * (PK.w * p + gap)) + "px"; s.style.transform = `scale(${p})`; });
}
// openPick(i): player i pressed "Pick a Class": the screen goes dark and the panels fly up from the bottom, one by one, very quickly.
async function openPick(i) {
  if (TT.pickOpen) return;
  TT.pickOpen = true; TT.pkRow = i; TT.pkBusy = true;
  layoutPanels();
  const P = $("tPick"); P.style.display = "block"; $("tFull").style.display = "none";
  P.querySelector(".pk-dim").animate([{ opacity: 0 }, { opacity: .5 }], { duration: 150, fill: "backwards" });
  TT.pkPanels.forEach(p => { p._x = 0; p._y = PK.off; p.style.transform = `translate(0,${PK.off}px)`; });
  await Promise.all(TT.pkPanels.map((p, k) => glide(p, { x: 0, y: 0 }, 280, "cubic-bezier(.2,.9,.3,1.08)", k * 55)));
  TT.pkBusy = false;
}
// exitPanels(except): panels leave downwards, last first (the opposite of how they came in)
function exitPanels(except) { return Promise.all([5, 4, 3, 2, 1, 0].filter(k => k !== except).map((k, j) => glide(TT.pkPanels[k], { x: 0, y: PK.off }, 110, EASE_IN, j * 14))); }
function closePickNow() { $("tPick").style.display = "none"; $("tFull").style.display = "none"; TT.pickOpen = false; TT.pkBusy = false; }
async function closePick() { if (!TT.pickOpen || TT.pkBusy) return; TT.pkBusy = true; await exitPanels(-1); closePickNow(); }   // X button / click outside
// pickClass(k): PICK pressed on panel k - the others leave first, the chosen one shines, slides to the centre and off the screen; the dark layer vanishes instantly.
async function pickClass(k) {
  if (TT.pkBusy) return; TT.pkBusy = true;
  const p = TT.pkPanels[k];
  await exitPanels(k);
  p.classList.add("shining"); await sleep(220); p.classList.remove("shining");
  const cx = (innerWidth / 2 - (TT.pkGap + k * (PK.w * TT.pkScale + TT.pkGap)) - PK.w * TT.pkScale / 2) / TT.pkScale;   // slide to the middle of the window (in panel units)
  await glide(p, { x: cx, y: 0 }, 130, "ease-out", 0);
  await glide(p, { x: cx, y: PK.off }, 130, EASE_IN, 0);
  closePickNow();
  S.rows[TT.pkRow].cls = CLASSES[k].id; refreshRow(TT.pkRow);
  if (S.mode === "online" && NET.active) sendLobbyUpdate(undefined, CLASSES[k].id);   // tell the other players
}
// openFull(k): the small expand button - the full description of the class from the rulebook
function openFull(k) {
  const c = CLASSES[k];
  $("tFull").querySelector(".tf-card").innerHTML = `<h2>${c.name}</h2>${ul(CLASS_RULES[c.id] || [c.text])}`;
  $("tFull").style.display = "block";
}
function closeFull() { $("tFull").style.display = "none"; }
