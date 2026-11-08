// =====================================================================================
//  art.js  -  loading the SVG art from the assets/ folder
//  assets/manifest.json says which file is which (tiles, snake heads, digits). Everything else is loaded by file name.
// =====================================================================================

// A("x.svg") = web address of an asset (used in <img src=...>). When the game is packed into one single page,
// the files are stored in window.EMBED instead and A() returns an inline "data:" address.
const A = f => {
  if (!window.EMBED) return "assets/" + f;
  if (EMBED[f]) return EMBED[f];
  if (EMBED[f + "#text"]) return EMBED[f] = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(EMBED[f + "#text"]);   // single-file build: SVGs are stored once, as text
  return "assets/" + f;
};
// T("x.svg") = the TEXT of an asset file (needed for art that is drawn inside the board SVG).
async function T(f) {
  if (window.EMBED && EMBED[f + "#text"]) return EMBED[f + "#text"];
  const r = await fetch("assets/" + f, { cache: "no-store" });
  if (!r.ok) throw `assets/${f} was not found (${r.status})`;
  return r.text();
}

// ART holds everything loaded: tiles, shadow, snake heads, cobra, number digits, and bookkeeping.
const ART = {
  heads: [],            // the six ordinary snake heads (from manifest "heads")
  cobra: null,          // the special long-snake head
  kinds: [],            // heads + cobra, each with its colour and drawing scale (built by buildKinds)
  tiles: { dark: [], light: [] },   // tile art lists (blue = dark, orange = light)
  shadow: null,         // the shadow drawn beneath tiles
  digits: [],           // number glyphs 0-9: { f: file, w: width, h: height }
  cats: [],             // cat pictures: { f: file, w, h }
  items: {},            // item pictures by type: { stick: { f, w, h }, ... }
  ladder: {},           // ladder pictures as bitmaps: { straight, slanted } (see loadBody)
  n: 0,                 // counter that gives every loaded SVG its own id prefix so ids never clash
  v: 0,                 // version number; goes up whenever art changes so snakes get redrawn
  ready: false, error: ""
};

// prep(text, wrap, K): reads an SVG file's text and makes it safe to put inside the board SVG.
//   - gives every id/class inside a unique prefix (so two files can't clash)
//   - works out the picture's size (box) and its main colour (K.main if given, otherwise the biggest coloured area)
// Returns { p: prefix, vb: viewBox numbers, box: {x,y,w,h}, main: colour, defs: the cleaned SVG content }.
function prep(text, K) {
  K = K || {};
  const doc = new DOMParser().parseFromString(text, "image/svg+xml"), root = doc.documentElement;
  if (root.nodeName !== "svg" || doc.querySelector("parsererror")) throw "not a valid SVG";
  const vb = (root.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
  if (vb.length < 4 || vb.some(isNaN)) throw "needs a viewBox";
  // inner = everything inside the <svg>, wrapped in a group called "all" so it can be reused with <use href="#...all">
  const inner = `<g id="all">${[...root.childNodes].map(n => new XMLSerializer().serializeToString(n)).join("")}</g>`;
  const box = { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
  const main = K.main || "#888";
  const p = "a" + (++ART.n) + "_";   // unique prefix for this file
  const defs = inner.replace(/id="([^"]+)"/g, `id="${p}$1"`).replace(/url\(#([^)]+)\)/g, `url(#${p}$1)`)
    .replace(/href="#([^"]+)"/g, `href="#${p}$1"`).replace(/\b(cls-\d+|st\d+)\b/g, p + "$1");
  return { p, vb, box, main, defs };
}

// loadBody(file): load a picture as a BITMAP the canvas can slice up and stamp quickly. Used for snake BODIES (a long horizontal strip, thick at the
// head end, thin at the tail) and for LADDERS.
// BODY_RES = how many image pixels per SVG unit (2 = sharp when drawn at 2x). The SVG only has a viewBox, so width/height are added to a copy of its text.
const BODY_RES = 3;
async function loadBody(file) {
  let t = await T(file);
  const v = t.match(/viewBox="([^"]+)"/)[1].trim().split(/[\s,]+/).map(Number), w = v[2], h = v[3];
  t = t.replace("<svg ", `<svg width="${w * BODY_RES}" height="${h * BODY_RES}" `);
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(t);
  await img.decode();
  // Turn the SVG into a plain bitmap ONCE. Drawing slices straight from an SVG image makes the browser re-render the whole SVG for every slice
  // (hundreds per snake = a visible freeze whenever the Snake Charmer moves a head). Slicing a bitmap is instant.
  const bmp = document.createElement("canvas");
  bmp.width = Math.ceil(w * BODY_RES); bmp.height = Math.ceil(h * BODY_RES);
  bmp.getContext("2d").drawImage(img, 0, 0, bmp.width, bmp.height);
  return { img: bmp, w, h, R: BODY_RES };   // w,h = size in SVG units; img = the bitmap
}

// buildKinds(): combine heads + cobra into one list "kinds". Each kind = { head art, face direction, colour, drawing scale }.
// The snake BODY colour comes from the head's colour in manifest.json. The cobra is drawn bigger.
function buildKinds() {
  const all = [...ART.heads, ART.cobra];
  ART.kinds = all.map((h, i) => ({
    head: h.art, face: h.face, color: h.art.main, body: h.body,
    sc: (i === all.length - 1 ? 100 : 82) * BS / Math.max(h.art.box.w, h.art.box.h)   // drawn size of a head in pixels (cobra is bigger)
  }));
}
// artDefs(): all loaded SVG content as one block, placed once inside the board SVG's <defs>.
function artDefs() {
  let d = "";
  for (const k of ART.kinds) d += k.head.defs;
  for (const a of [...ART.tiles.dark, ...ART.tiles.light, ART.shadow]) d += a.defs;
  return d;
}

// initButtonArt(): prepare the counter art for the buttons. Border-image needs the picture to carry its own size, so width/height are added
// to a copy of the SVG text, which then becomes a CSS variable (--btn-orange / --btn-blue) used by .cbtn in css/style.css.
async function initButtonArt() {
  for (const [name, file] of [["--btn-orange", "counter_buff.svg"], ["--btn-blue", "counter_debuff.svg"]]) {
    const t = (await T(file)).replace("<svg ", '<svg width="84.37" height="49.04" ');
    $("stage").style.setProperty(name, `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(t)}")`);
  }
  // the red container art (stretched behind each section; see .box in css/style.css)
  const c = (await T("container_red.svg")).replace("<svg ", '<svg width="1063.86" height="1057.37" ');
  $("stage").style.setProperty("--box-img", `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(c)}")`);
}

// initPatternArt(): the repeating background tile (assets/pattern.svg). Like the button art above, width/height are added to a copy of the SVG text
// (taken from its viewBox, 1 unit = 1 pixel) so CSS can tile it at its natural size; it becomes the CSS variable --pattern-img used by #stage in css/style.css.
// The file is optional: if it is missing or broken the background stays plain blue.
async function initPatternArt() {
  try {
    let t = await T("pattern.svg");
    const v = t.match(/viewBox="([^"]+)"/)[1].trim().split(/[\s,]+/).map(Number);
    t = t.replace(/<svg[^>]*>/, tag => tag.replace(/\s(width|height)="[^"]*"/g, "").replace("<svg ", `<svg width="${v[2]}" height="${v[3]}" `));
    $("stage").style.setProperty("--pattern-img", `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(t)}")`);
  } catch (e) { console.warn("No background pattern:", e); }
}

// loadAssets(): reads manifest.json and every SVG it names. Called once when the page opens (see main.js).
async function loadAssets() {
  try {
    await initButtonArt();
    await initPatternArt();
    let M;
    try { M = JSON.parse(await T("manifest.json")); }
    catch (e) { throw e instanceof SyntaxError ? `assets/manifest.json is not valid JSON (${e.message})` : e; }
    const K = { main: "#000" }, all = a => Promise.all(a);
    ART.tiles.dark = await all(M.tiles.dark.map(async f => prep(await T(f), K)));
    ART.tiles.light = await all(M.tiles.light.map(async f => prep(await T(f), K)));
    ART.shadow = prep(await T(M.tiles.shadow), K);
    ART.heads = await all(M.heads.map(async h => ({ art: prep(await T(h.file), { main: h.color }), face: h.face || "L", short: !!h.short, body: h.body ? await loadBody(h.body) : null })));
    ART.cobra = { art: prep(await T(M.cobra.file), { main: M.cobra.color }), face: M.cobra.face || "R", body: M.cobra.body ? await loadBody(M.cobra.body) : null };
    ART.ladder = { straight: await loadBody(M.ladders.straight), slanted: await loadBody(M.ladders.slanted) };
    // size of a file from its viewBox text (used for digits and cats, which are drawn as plain images)
    const size = async f => { const v = ((await T(f)).match(/viewBox="([^"]+)"/) || [])[1].trim().split(/[\s,]+/).map(Number); return { f, w: v[2], h: v[3] }; };
    ART.digits = await all((M.digits || []).map(size));
    ART.cats = await all((M.cats || []).map(size));
    for (const [k, f] of Object.entries(M.items)) ART.items[k] = await size(f);
    buildKinds(); ART.ready = true; ART.v++;
  } catch (e) {
    ART.error = e instanceof TypeError
      ? "Couldn\u2019t read the assets folder. Browsers block that when index.html is opened by double-click: run serve.py (python serve.py) and open http://localhost:8000 instead."
      : `Art problem: ${e}`;
    S.msg = ART.error;
  }
}

// assignKinds(): decide which snake head each snake wears. Keyed by the TAIL square (tails never move),
// so a snake keeps its look when the Snake Charmer moves its head. The long snake always gets the cobra; every other snake gets its own design (no repeats).
// A head marked "short": true in manifest.json (snake 8) always goes on a small snake near the start: of the 3 shortest snakes, the one whose head is lowest on the board.
function assignKinds() {
  const tails = Object.values(G.S).filter(t => t !== G.cobra), headOf = {};
  Object.entries(G.S).forEach(([h, t]) => { headOf[t] = +h; });                                     // headOf[tail] = head square
  let pool = [...Array(ART.heads.length).keys()].sort(() => Math.random() - .5), left = tails;      // pool = all ordinary heads, shuffled once
  G.kind = {};
  const low = ART.heads.findIndex(h => h.short);
  if (low >= 0 && tails.length) {
    const small = [...tails].sort((a, b) => (headOf[a] - a) - (headOf[b] - b)).slice(0, 3);          // the 3 shortest snakes
    const t0 = small.sort((a, b) => headOf[a] - headOf[b])[0];                                       // ...and the one closest to square 1
    G.kind[t0] = low; pool = pool.filter(i => i !== low); left = tails.filter(t => t !== t0);
  }
  left.forEach((t, i) => { G.kind[t] = pool[i]; });
  G.kind[G.cobra] = ART.kinds.length - 1;
}
