// =====================================================================================
//  title.js  -  the TITLE SCREEN: animated logo, Play / Options / About buttons, light/dark switch.
//  Loaded AFTER main.js (it uses A(), T(), sfx(), setVolume() and the setup screen from there).
//  Colours live in the "TITLE SCREEN" part of css/style.css; the numbers you may want to tweak are in TITLE below.
// =====================================================================================

const TITLE = {
  btnX: [300, 798, 1297], btnY: 802,   // left edge of each button, and their shared top edge (stage pixels on the 1920x1080 stage)
  header: { x: 190, y: 50 },           // where the pressed button parks to act as the page title (top left)
  off: 330,                            // how far DOWN a button must travel to be fully off the screen
  logoOff: -820,                       // how far UP the logo must travel to be fully off the screen
  words: [0.2, 0.7, 1.2, 1.7],         // seconds at which the logo words pop in, top to bottom: Snakes, Ladders, &, Chaos
  btnStart: 2.35, btnGap: 0.22         // seconds until the first button slides up, and the gap between the buttons
};
const TITLE_PAGES = [{ id: "play", label: "Play" }, { id: "options", label: "Options" }, { id: "about", label: "About" }];
const EASE_IN = "cubic-bezier(.55,0,.9,.4)", EASE_BOUNCE = "cubic-bezier(.25,1.3,.4,1)";   // sliding off the screen / settling into place with a little overshoot

// TT = the live state of the title screen. state: "intro" (animating in) | "home" (waiting for a click) | "busy" (a transition is playing) | "page" (Play/Options/About is open)
const TT = { state: "intro", btns: [], logo: null, back: null, card: null, open: -1 };

// ---- theme (light / dark). Stored on <html data-theme="..."> so the CSS can switch every colour at once; remembered between visits ----
function setTheme(t, save) {
  document.documentElement.dataset.theme = t;
  const sw = $("tSwitch"); if (sw) sw.setAttribute("aria-checked", t === "dark");
  if (save) { try { localStorage.setItem("snc_theme", t); } catch (e) { /* not saved: fine */ } }
}
try { setTheme(localStorage.getItem("snc_theme") === "dark" ? "dark" : "light"); } catch (e) { setTheme("light"); }

// themeSvg(text): prepare an SVG file's text to sit inside the page. Its <style> colours (.cls-1 {fill:#...}) are replaced by classes (.pc-2f2504 ...)
// whose colours come from the palette variables in style.css, so the same art can switch between light and dark mode.
function themeSvg(text) {
  const map = {};
  text.replace(/\.(cls-\d+)\s*\{[^}]*?fill:\s*#([0-9a-fA-F]{3,6})/g, (m, c, h) => { map[c] = h.toLowerCase(); });
  return text.replace(/<\?xml[^>]*\?>/, "").replace(/<style>[\s\S]*?<\/style>/, "").replace(/ id="Layer_1"| data-name="[^"]*"/g, "")
    .replace(/class="(cls-\d+)"/g, (m, c) => !map[c] ? "" : ["2f2504", "c3f73a", "eeffae", "7d9926", "4b5b18"].includes(map[c]) ? `class="pc pc-${map[c]}"` : `style="fill:#${map[c]}"`);   // palette colours switch with the theme, others (the orange) stay
}

// glide(el, to, ms, ease, delay): slide an element from where it is now to offset to={x,y} (pixels away from its home spot); remembers the new spot.
function glide(el, to, ms, ease, delay) {
  const tf = p => `translate(${p.x || 0}px,${p.y || 0}px)`, from = { x: el._x || 0, y: el._y || 0 };   // (missing numbers count as 0, so a slide can never be invalid)
  const a = el.animate([{ transform: tf(from) }, { transform: tf(to) }], { duration: ms, easing: ease, delay: delay || 0, fill: "both" });
  return Promise.race([a.finished.catch(() => {}), sleep(ms + (delay || 0) + 100)]).then(() => { el._x = to.x || 0; el._y = to.y || 0; el.style.transform = tf(to); a.cancel(); });
}
// pop(el, show): fade/slide a little element in or out (back button, page card). Resolves when finished.
function pop(el, show, dx, dy) {
  if (show) el.style.display = "block";
  const hide = { opacity: 0, transform: `translate(${dx}px,${dy}px)` }, shown = { opacity: 1, transform: "none" };
  const a = el.animate(show ? [hide, shown] : [shown, hide], { duration: show ? 450 : 280, easing: show ? EASE_BOUNCE : "ease-in", fill: "both" });
  return Promise.race([a.finished.catch(() => {}), sleep(600)]).then(() => { if (!show) el.style.display = "none"; a.cancel(); });
}

// showSetup(): leave the title screen and show the current (old) setup screen.
function showSetup() { $("title").classList.remove("on"); document.body.classList.remove("on-title"); document.documentElement.classList.remove("on-title"); $("setup").style.display = ""; }

// pageHtml(id): what appears on the page under the title once Play / Options / About is chosen.
function pageHtml(id) {
  if (id === "options") {
    let bar = ""; for (let i = 1; i <= 10; i++) bar += `<div class="tt-seg${i <= VOLUME ? " on" : ""}" data-v="${i}"></div>`;
    return `<h2>Sound effects</h2><div class="tt-vol">${bar}</div><p id="ttVolNum">${VOLUME ? VOLUME * 10 + "%" : "Muted"}</p>`;
  }
  if (id === "about") return $("about").innerHTML;   // same text as the About tab in the game
  return `<h2>Play screen coming next</h2><p>The new play screen will go here. Until then, the current setup screen still starts a game.</p><p><button class="cbtn tt-open" style="--s:1.5;width:480px"><span>Open current setup</span></button></p>`;
}

// openPage(id): the pressed button becomes the page title; the others and the logo leave the screen; the back button and page appear.
async function openPage(id) {
  if (TT.state !== "home") return;
  TT.state = "busy"; $("title").classList.add("busy");
  const i = TITLE_PAGES.findIndex(p => p.id === id), me = TT.btns[i];
  me.classList.add("is-title"); me.style.zIndex = 3; TT.open = i;
  const exits = []; let j = 0;
  TT.btns.forEach((b, k) => { if (k !== i) exits.push(glide(b, { x: b._x, y: TITLE.off }, 320, EASE_IN, 50 * j++)); });   // the other buttons slide off the bottom, quickly, one after another
  exits.push(glide(TT.logo, { x: 0, y: TITLE.logoOff }, 380, EASE_IN, 0));                                                // the logo slides up off the top
  await Promise.all(exits);                                                                                                // wait until everything has fully left...
  await glide(me, { x: TITLE.header.x - TITLE.btnX[i], y: TITLE.header.y - TITLE.btnY }, 700, EASE_BOUNCE, 0);             // ...and only then the pressed button travels to the title spot
  if (id === "play") { await Promise.all([pop(TT.back, true, -40, 0), playRowsIn()]); TT.state = "page"; $("title").classList.remove("busy"); return; }
  TT.card.firstChild.innerHTML = pageHtml(id);
  TT.card.querySelectorAll(".tt-seg").forEach(s => s.onclick = () => {
    setVolume(+s.dataset.v);
    TT.card.querySelectorAll(".tt-seg").forEach(q => q.classList.toggle("on", +q.dataset.v <= VOLUME));
    $("ttVolNum").textContent = VOLUME ? VOLUME * 10 + "%" : "Muted";
  });
  const op = TT.card.querySelector(".tt-open"); if (op) op.onclick = showSetup;
  await Promise.all([pop(TT.back, true, -40, 0), pop(TT.card, true, 0, 70)]);
  TT.state = "page"; $("title").classList.remove("busy");
}
// closePage(): the back button - everything returns the way it left.
async function closePage() {
  if (TT.state !== "page") return;
  TT.state = "busy"; $("title").classList.add("busy");
  const i = TT.open, me = TT.btns[i];
  if (i === 0) await playRowsOut();                                                                              // Play page: the rows leave first, last row first
  await Promise.all([pop(TT.back, false, -40, 0), pop(TT.card, false, 0, 70)]);
  glide(me, { x: 0, y: 0 }, 650, EASE_BOUNCE, 0);
  let j = 0;
  TT.btns.forEach((b, k) => { if (k !== i) glide(b, { x: 0, y: 0 }, 650, EASE_BOUNCE, 250 + 110 * j++); });    // the others slide back up from the bottom, one by one
  glide(TT.logo, { x: 0, y: 0 }, 800, EASE_BOUNCE, 200);                                                        // the logo drops back in from the top
  await sleep(1050);
  me.classList.remove("is-title"); me.style.zIndex = ""; TT.open = -1;
  TT.state = "home"; $("title").classList.remove("busy");
}

// ---- the Play page: three rows. Each row = a green button (Local / Host / Join) + an orange description button; either one does the same thing ----
const ROWS = [
  { label: "Local", text: "Play locally with your friends", mode: "local" },
  { label: "Host", text: "Host a Multiplayer lobby", mode: "host" },
  { label: "Join", text: "Join a Multiplayer lobby", mode: "join" }];
const ROWPOS = { gx: 240, ox: 653, gy: [293, 518, 743], oy: [289, 513, 738], gOff: -620, oOff: 1300 };   // stage positions of the buttons, and how far off-screen they wait (left / right)
// slideRow(i, out, delay): row i's green button slides off to the left and its orange button to the right (out = true), or back in (out = false)
function slideRow(i, out, delay) {
  const r = TT.rows[i], ms = out ? 320 : 650, ez = out ? EASE_IN : EASE_BOUNCE;
  return Promise.all([glide(r.g, { x: out ? ROWPOS.gOff : 0, y: 0 }, ms, ez, delay), glide(r.o, { x: out ? ROWPOS.oOff : 0, y: 0 }, ms, ez, delay)]);
}
async function playRowsIn() { $("tRows").style.display = "block"; await Promise.all(TT.rows.map((r, i) => slideRow(i, false, i * 120))); }   // first row first
async function playRowsOut() { await Promise.all([2, 1, 0].map((k, j) => slideRow(k, true, j * 60))); $("tRows").style.display = "none"; }   // the reverse order
// openSub(i): a row was chosen. Everything else leaves the way it came (reverse order); the green button takes the title spot.
async function openSub(i) {
  if (TT.state !== "page" || TT.open !== 0) return;
  TT.state = "busy"; $("title").classList.add("busy");
  const g = TT.rows[i].g; g.classList.add("is-title"); g.style.zIndex = 3; TT.sub = i;
  const exits = [];
  [2, 1, 0].forEach((k, j) => { if (k !== i) exits.push(slideRow(k, true, j * 60)); else exits.push(glide(TT.rows[i].o, { x: ROWPOS.oOff, y: 0 }, 320, EASE_IN, j * 60)); });
  exits.push(glide(TT.btns[0], { x: -700, y: TITLE.header.y - TITLE.btnY }, 320, EASE_IN, 180));                 // the PLAY title leaves last (it came first)
  await Promise.all(exits);                                                                                       // everything has fully left...
  await glide(g, { x: TITLE.header.x - ROWPOS.gx, y: TITLE.header.y - ROWPOS.gy[i] }, 700, EASE_BOUNCE, 0);   // ...and only then the chosen green button takes the title spot
  await showLocal(ROWS[i].mode);   // the lobby screen (js/local.js): local / host / join
  TT.state = "sub"; $("title").classList.remove("busy");
}
// closeSub(): back from a row's screen to the Play page; everything returns the way it came in.
async function closeSub() {
  if (TT.state !== "sub") return;
  TT.state = "busy"; $("title").classList.add("busy");
  const i = TT.sub, g = TT.rows[i].g;
  await hideLocal();
  glide(g, { x: 0, y: 0 }, 650, EASE_BOUNCE, 0);
  glide(TT.btns[0], { x: TITLE.header.x - TITLE.btnX[0], y: TITLE.header.y - TITLE.btnY }, 650, EASE_BOUNCE, 150);
  [0, 1, 2].forEach((k, j) => { if (k !== i) slideRow(k, false, 200 + j * 120); else glide(TT.rows[i].o, { x: 0, y: 0 }, 650, EASE_BOUNCE, 200 + j * 120); });
  await sleep(1150);
  g.classList.remove("is-title"); g.style.zIndex = ""; TT.sub = -1;
  TT.state = "page"; $("title").classList.remove("busy");
}
// goBack(): the back button / Esc - one step back from wherever we are.
function goBack() {
  if (TT.pickOpen) { if ($("tFull").style.display === "block") closeFull(); else closePick(); return; }   // a pick panel is open: close it first
  if (TT.state === "sub") closeSub(); else closePage();
}
addEventListener("keydown", e => { if (e.key === "Escape") goBack(); });

// enterHome(): the intro animation is over - from now on the buttons can be pressed.
function enterHome() { if (TT.state === "intro") { TT.state = "home"; $("title").classList.add("done"); } }

// buildTitle(root, logoSvg, buttonSvg, backSvg): create every piece of the title screen.
function buildTitle(root, logoSvg, btnSvg, backSvg, descSvg) {
  const backD = (backSvg.match(/<path class="cls-1" d="([^"]+)"/) || [])[1] || "";
  root.innerHTML =
    `<div id="tLogo">${themeSvg(logoSvg)}</div><div id="tMenu">` +
    TITLE_PAGES.map((p, i) => `<button class="tbtn" data-id="${p.id}" style="left:${TITLE.btnX[i]}px;top:${TITLE.btnY}px;--d:${(TITLE.btnStart + i * TITLE.btnGap).toFixed(2)}s"><span class="tb-rim"></span><span class="tb-face">${themeSvg(btnSvg)}<span class="tb-shine"></span><span class="tb-label">${p.label}</span></span></button>`).join("") +
    `</div><button id="tBack" title="Back" aria-label="Back"><svg class="tk-shadow" viewBox="0 0 184.18 321.83"><path d="${backD}"/></svg><span class="tk-face">${themeSvg(backSvg)}</span></button>` +
    `<div id="tRows">` + ROWS.map((r, i) => `<button class="tbtn pg" data-row="${i}" style="left:${ROWPOS.gx}px;top:${ROWPOS.gy[i]}px"><span class="tb-rim"></span><span class="tb-face">${themeSvg(btnSvg)}<span class="tb-shine"></span><span class="tb-label">${r.label}</span></span></button><button class="obtn" data-row="${i}" style="left:${ROWPOS.ox}px;top:${ROWPOS.oy[i]}px"><span class="ob-face">${themeSvg(descSvg)}<span class="tb-shine"></span><span class="ob-label">${r.text}</span></span></button>`).join("") + `</div>` +
    `<div id="tPage"><div class="tp-card"></div></div>` +
    // the light/dark switch (top right): sun, the switch, moon
    `<svg id="tSun" viewBox="0 0 54 54"><circle cx="27" cy="27" r="12" fill="none" stroke-width="3"/><path d="M27 2L34 13H20Z M27 52L20 41H34Z M52 27L41 20V34Z M2 27L13 20V34Z" fill="none" stroke-width="2.5" stroke-linejoin="round"/><path d="M27 8L30.5 14H23.5Z" transform="rotate(45 27 27)"/><path d="M27 8L30.5 14H23.5Z" transform="rotate(135 27 27)"/><path d="M27 8L30.5 14H23.5Z" transform="rotate(225 27 27)"/><path d="M27 8L30.5 14H23.5Z" transform="rotate(315 27 27)"/></svg>` +
    `<button id="tSwitch" role="switch" aria-label="Light or dark mode" aria-checked="false"><svg viewBox="0 0 121 72"><rect class="tt-trkrim" width="121" height="72" rx="36"/><rect class="tt-trk" x="6" y="6" width="109" height="60" rx="30"/><g class="tt-knob"><circle cx="31" cy="39" r="23.5" fill="#e2330a"/><circle class="tt-knobring" cx="31" cy="32" r="23.5" fill="#ff7529" stroke-width="3"/><circle cx="24" cy="22" r="11" fill="#fff" opacity=".5"/></g></svg></button>` +
    `<svg id="tMoon" viewBox="0 0 38 46"><path d="M24 3C11 6 4 19 8 31C12 41 24 45 35 40C20 40 13 28 17 16C19 10 22 6 24 3Z"/></svg>`;
  // logo words: sort the logo's pieces top to bottom and give each its own delay, so they pop in one after another
  const svg = root.querySelector("#tLogo svg");
  [...svg.children].filter(n => n.tagName.toLowerCase() !== "defs").map(n => ({ n, y: n.getBBox().y })).sort((a, b) => a.y - b.y)
    .forEach((p, i) => { p.n.classList.add("lw"); p.n.style.setProperty("--d", (TITLE.words[i] ?? i * .5) + "s"); });
  TT.btnSvg = btnSvg; TT.logo = $("tLogo"); TT.back = $("tBack"); TT.card = $("tPage");
  TT.btns = [...root.querySelectorAll("#tMenu .tbtn")];
  TT.rows = ROWS.map((r, i) => ({ g: root.querySelector(`.tbtn.pg[data-row="${i}"]`), o: root.querySelector(`.obtn[data-row="${i}"]`) }));
  TT.rows.forEach((r, i) => {   // rows wait off-screen (green left, orange right) until the Play page opens; clicking either button picks the row
    r.g._x = ROWPOS.gOff; r.o._x = ROWPOS.oOff; r.g._y = r.o._y = 0;
    r.g.style.transform = `translate(${ROWPOS.gOff}px,0)`; r.o.style.transform = `translate(${ROWPOS.oOff}px,0)`;
    r.g.onclick = r.o.onclick = () => openSub(i);
  });
  TT.btns.forEach(b => { b._x = b._y = 0; b.onclick = () => openPage(b.dataset.id); });   // every sliding piece starts with a known position (0,0)
  TT.logo._x = TT.logo._y = 0;
  TT.back.onclick = goBack;
  $("tSwitch").onclick = () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", true);
  setTheme(document.documentElement.dataset.theme);
  TT.btns[2].addEventListener("animationend", e => { if (e.target === TT.btns[2]) enterHome(); });
  setTimeout(enterHome, (TITLE.btnStart + 2 * TITLE.btnGap + 0.9) * 1000 + 300);                                  // safety net if the animation event never fires
  root.addEventListener("pointerdown", () => { if (TT.state === "intro") root.getAnimations({ subtree: true }).forEach(a => a.finish()); });   // click during the intro = skip it
}

// initTitle(): start-up. An invite link (?room=CODE) skips the title and goes straight to the lobby.
async function initTitle() {
  const room = new URLSearchParams(location.search).get("room");   // an invite link (?room=CODE) opens the Join screen and joins
  window.TITLE_ACTIVE = true;
  const root = $("title");
  $("setup").style.display = "none"; root.classList.add("on"); document.body.classList.add("on-title"); document.documentElement.classList.add("on-title");
  try {
    const [logo, btn, back, desc] = await Promise.all([T("logo.svg"), T("button_home.svg"), T("button_back.svg"), T("button_playscreen_description.svg")]);
    try { await document.fonts.load("72px LM"); } catch (e) { /* font not ready: the fallback shows briefly */ }
    buildTitle(root, logo, btn, back, desc);
    if (room) { enterHome(); await openPage("play"); await openSub(2); autoJoin(room); }
  } catch (e) { console.warn("Title screen could not start:", e); showSetup(); if (room) { window.TITLE_ACTIVE = false; setGameMode("online"); joinRoom(room); } }
}
initTitle();
