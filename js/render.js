// =====================================================================================
//  render.js  -  everything that DRAWS the game: snakes, ladders, tiles, pawns, panels, highlights.
//  render() is called after every change to the game (see rules.js: set(), ask(), etc.)
// =====================================================================================

// ------------------------------------------------------------------ SNAKES
// Snake bodies are straight horizontal / vertical / 45-degree runs with rounded bends, filled with the head's colour,
// with a black border and a tapered tail. The route is chosen from random waypoints but always the same for the same head+tail.
const SW = 26 * BS;  // snake body thickness in pixels (flat bodies)
const BEND = 40 * BS; // how round the bends are (bigger = rounder)
let SNK = { key: "", svg: "", pts: [], headTf: {}, headSq: new Set() };   // cache of the last drawn snakes (so they are only rebuilt when something changed): svg text, centre-line points of every body, and the squares that hold a head

// mulberry(seed): a seeded random-number generator, so a snake keeps the same shape every time it is drawn.
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const unit = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };   // turn an arrow (x,y) into length 1
const rnd2 = (r, a, b) => a + Math.floor(r() * (b - a + 1));                         // random whole number a..b using a seeded generator r

// octi(A,B,flip): path from grid point A to B using only straight and 45-degree moves. Returns the corner (if any) plus B.
function octi(A, B, flip) {
  const dx = B[0] - A[0], dy = B[1] - A[1], ax = Math.abs(dx), ay = Math.abs(dy);
  if (!dx || !dy || ax === ay) return [B];                       // already straight or exactly diagonal
  const d = Math.min(ax, ay), sx = Math.sign(dx), sy = Math.sign(dy);
  return [flip ? [A[0] + dx - sx * d, A[1] + dy - sy * d] : [A[0] + sx * d, A[1] + sy * d], B];   // "flip" chooses diagonal-first or straight-first
}
// crosses(a,b,c,d): do segment a-b and segment c-d touch or cross? (used to stop a snake crossing itself)
function crosses(a, b, c, d) {
  const r = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
  if (!r) {   // parallel lines: only a problem if they overlap on the same line
    const cr = (c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0]);
    if (cr) return false;
    const ux = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? 0 : 1, lo = Math.min(a[ux], b[ux]), hi = Math.max(a[ux], b[ux]), p = Math.min(c[ux], d[ux]), q = Math.max(c[ux], d[ux]);
    return Math.min(hi, q) - Math.max(lo, p) > 1e-9;
  }
  const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / r, u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / r, e = 1e-9;
  return t >= -e && t <= 1 + e && u >= -e && u <= 1 + e;
}
// route(h,t): the grid path (list of [column, visualRow] corners) from head square h to tail square t.
// The NECK always leaves the head sideways (left or right) and runs at least 1 square before the first bend, because heads only face left/right.
// Tries up to 500 random waypoint sets (no hairpin turns, no self-crossing, not shorter than minL) and keeps the cheapest: length + OVERLAP_COST per square that overlaps
// something in "avoid". So a snake takes the shortest route that stays clear of other things; if it cannot avoid them, it overlaps as little as it can.
// overlapLen(R, avoid): how many squares of path R run closer than 0.6 of a square to anything in "avoid" (a list of [x1,y1,x2,y2] segments in grid coordinates;
// a single point is a segment with both ends equal). Used to make snakes steer around ladders, heads, tails and other snakes.
function overlapLen(R, avoid) {
  let n = 0;
  for (let i = 1; i < R.length; i++) {
    const [x0, y0] = R[i - 1], [x1, y1] = R[i], k = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 4));   // 4 sample points per square
    for (let j = 0; j <= k; j++) { const x = x0 + (x1 - x0) * j / k, y = y0 + (y1 - y0) * j / k; if (avoid.some(s => segDist(x, y, s[0], s[1], s[2], s[3]) < .6)) n++; }
  }
  return n / 4;
}
const OVERLAP_COST = 6;   // every square of overlap counts as this many extra squares of snake length when choosing a route (bigger = avoid overlaps harder)
function route(h, t, neckDown, avoid) {   // neckDown = true for the cobra: its neck goes DOWN exactly 1 square instead of sideways
  const [hr, hc] = rc(h), [tr, tc] = rc(t), H = [hc, 9 - hr], T = [tc, 9 - tr], rng = mulberry(h * 977 + t * 31 + 7);
  const dist = Math.max(Math.abs(H[0] - T[0]), Math.abs(H[1] - T[1])), minL = Math.max(5, dist * 1.1 + 1.5);   // minL = shortest path length we accept (in squares)
  const c0 = Math.max(0, Math.min(H[0], T[0]) - 2), c1 = Math.min(9, Math.max(H[0], T[0]) + 2), r0 = Math.max(0, Math.min(H[1], T[1]) - 2), r1 = Math.min(9, Math.max(H[1], T[1]) + 2);   // area waypoints may land in
  let best = null, bd = 1e9;
  for (let k = 0; k < 500; k++) {
    const nw = dist < 3 ? rnd2(rng, 2, 3) : rnd2(rng, 1, 2);   // number of extra waypoints (short snakes get more so they curl)
    let neck;   // neck = the first corner after the head
    if (neckDown) neck = [H[0], H[1] + 1];                                           // cobra: straight down, 1 square
    else { const dir = rng() < .5 ? -1 : 1, nk = rnd2(rng, 1, 2); neck = [H[0] + dir * nk, H[1]]; }   // others: sideways (dir = left/right, nk = squares)
    if (neck[0] < 0 || neck[0] > 9 || neck[1] > 9) continue;                         // neck would leave the board: try again
    const P = [H, neck]; let cur = neck; const wp = [];
    for (let i = 0; i < nw; i++) wp.push([rnd2(rng, c0, c1), rnd2(rng, r0, r1)]);
    wp.push(T);
    for (const w of wp) { P.push(...octi(cur, w, rng() < .5)); cur = w; }
    const Q = [P[0]];   // Q = P without repeated points
    for (let i = 1; i < P.length; i++) if (P[i][0] !== Q[Q.length - 1][0] || P[i][1] !== Q[Q.length - 1][1]) Q.push(P[i]);
    const R = [Q[0]];   // R = Q without pointless middle points on straight lines
    for (let i = 1; i < Q.length; i++) {
      if (R.length > 1) {
        const a = unit(R[R.length - 1][0] - R[R.length - 2][0], R[R.length - 1][1] - R[R.length - 2][1]), b = unit(Q[i][0] - R[R.length - 1][0], Q[i][1] - R[R.length - 1][1]);
        if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) R.pop();
      }
      R.push(Q[i]);
    }
    let ok = R.length >= 3, len = 0;   // check the path: no tiny segments, no turn sharper than 90 degrees
    for (let i = 1; i < R.length && ok; i++) {
      const l = Math.hypot(R[i][0] - R[i - 1][0], R[i][1] - R[i - 1][1]); if (l < 1) ok = false; len += l;
      if (i > 1) { const a = unit(R[i - 1][0] - R[i - 2][0], R[i - 1][1] - R[i - 2][1]), b = unit(R[i][0] - R[i - 1][0], R[i][1] - R[i - 1][1]); if (a[0] * b[0] + a[1] * b[1] < -.01) ok = false; }
    }
    for (let i = 1; i < R.length && ok; i++) for (let j = i + 2; j < R.length && ok; j++) if (crosses(R[i - 1], R[i], R[j - 1], R[j])) ok = false;   // no self-crossing
    if (!ok || len < minL) continue;
    if (len >= bd) continue;                                              // cannot beat the best so far even with no overlap
    const cost = len + OVERLAP_COST * overlapLen(R, avoid || []);
    if (cost < bd) { bd = cost; best = R; }
  }
  if (!best) { const nk = neckDown ? [H[0], Math.min(9, H[1] + 1)] : [cl(H[0] + (T[0] >= H[0] ? 1 : -1), 0, 9), H[1]]; best = [H, nk, ...octi(nk, T, false)]; }   // fallback: simplest path (still with a straight neck)
  return best;
}
// roundPts(P,R): turn corner points into a smooth path (curved bends of radius R).
function roundPts(P, R) {
  const out = [P[0]];
  for (let i = 1; i < P.length - 1; i++) {
    const A = P[i - 1], B = P[i], C = P[i + 1], a = unit(B[0] - A[0], B[1] - A[1]), b = unit(C[0] - B[0], C[1] - B[1]);
    const la = Math.hypot(B[0] - A[0], B[1] - A[1]), lb = Math.hypot(C[0] - B[0], C[1] - B[1]), r = Math.min(R, la * .5, lb * .5);
    const S0 = [B[0] - a[0] * r, B[1] - a[1] * r], E = [B[0] + b[0] * r, B[1] + b[1] * r];
    out.push(S0);
    for (let k = 1; k <= 8; k++) { const u = k / 8, w = 1 - u; out.push([w * w * S0[0] + 2 * w * u * B[0] + u * u * E[0], w * w * S0[1] + 2 * w * u * B[1] + u * u * E[1]]); }
  }
  out.push(P[P.length - 1]);
  return out;
}
// dens(p,step): add extra points so no gap between points is longer than "step" pixels.
function dens(p, step) {
  const o = [p[0]];
  for (let i = 1; i < p.length; i++) {
    const [x0, y0] = p[i - 1], [x1, y1] = p[i], n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let k = 1; k <= n; k++) o.push([x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n]);
  }
  return o;
}
// snakeGeom(h,t,avoid): the finished body shape. Returns { p: centre-line points, d: SVG outline path text, R: the grid corners of the route }.
// The tail thins out smoothly over its last 60% (max 300px) and ends in a rounded tip (TIP = tip thickness; raise it for a blunter tail).
function snakeGeom(h, t, avoid) {
  const R = route(h, t, t === G.cobra, avoid), P = R.map(q => cellPx(q[0], q[1])), p = dens(roundPts(P, BEND), 14), s = [0];
  for (let i = 1; i < p.length; i++) s.push(s[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));   // s = distance along the snake at each point
  const TIP = 9, L = s[s.length - 1], TL = Math.min(L * .6, 300), A = [], B = [];   // L = total length, TL = taper length, A/B = left/right edge points
  for (let i = 0; i < p.length; i++) {
    const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)], [tx, ty] = unit(b[0] - a[0], b[1] - a[1]);
    const u = Math.min(1, (L - s[i]) / TL), w = (TIP + (SW - TIP) * u * u * (3 - 2 * u)) / 2;   // half-thickness here (smooth ease from full width down to the tip)
    A.push([p[i][0] - ty * w, p[i][1] + tx * w]); B.push([p[i][0] + ty * w, p[i][1] - tx * w]);
  }
  // rounded tip: a half circle around the last point, from the left edge to the right edge
  const e = p[p.length - 1], pe = p[p.length - 2], [ex, ey] = unit(e[0] - pe[0], e[1] - pe[1]), cap = [];
  for (let k = 1; k < 8; k++) { const a = k / 8 * Math.PI, r = TIP / 2; cap.push([e[0] - ey * r * Math.cos(a) + ex * r * Math.sin(a), e[1] + ex * r * Math.cos(a) + ey * r * Math.sin(a)]); }
  return { p, d: "M" + [...A, ...cap, ...B.reverse()].map(q => f1(q[0]) + " " + f1(q[1])).join("L") + "Z", R };
}
// headTransform(h,t,kd,geom): where/how big/which way to draw a snake head. The head looks AWAY from its body.
function headTransform(h, t, kd, g) {
  const [hx, hy] = xy(h), q = g.p[Math.min(4, g.p.length - 1)], dx = q[0] - g.p[0][0], bx = kd.head.box, sc = kd.sc;
  const face = Math.abs(dx) < 8 ? kd.face : dx > 0 ? "L" : "R";
  return `translate(${f1(hx)} ${f1(hy - 6)}) scale(${face === kd.face ? sc : -sc} ${sc}) translate(${-(bx.x + bx.w / 2)} ${-(bx.y + bx.h / 2)})`;
}
// ---- body drawing. All bodies are painted onto ONE canvas (in order, so overlaps look right), which is then shown as a picture on the board. ----
const BODY_W = 38 * BS;   // thickness (pixels) of the head end of a body made from picture art (it tapers along the picture); flat bodies use SW instead
// drawFlatBody(ctx, g, kd): the placeholder body: head-colour fill with a black border (used for snakes that have no body picture).
function drawFlatBody(ctx, g, kd) {
  const p = new Path2D(g.d);
  ctx.fillStyle = kd.color; ctx.strokeStyle = "#000"; ctx.lineWidth = 3.5; ctx.lineJoin = "round";
  ctx.fill(p); ctx.stroke(p);
}
// drawArtBody(ctx, g, kd): bend the body PICTURE along the snake's path. The picture is cut into thin slices (STEP pixels long);
// each slice is drawn rotated to follow the path, so the pattern and the taper run smoothly around the bends.
// The belly stripe stays on the same side of the snake all the way (it starts on the bottom of the neck).
function drawArtBody(ctx, g, kd) {
  const art = kd.body, p = g.p, STEP = 1.5, cum = [0];   // STEP = slice length in pixels: very thin slices so bends look like one smooth stretched body
  for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));   // distance along the snake at every point
  const L = cum[cum.length - 1], sy = BODY_W / art.h, H = art.h * sy;                                                  // L = length, H = drawn thickness at the head
  let i = 0;
  const at = s => { while (i < p.length - 2 && cum[i + 1] < s) i++; const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 2)], t = (s - cum[i]) / ((cum[i + 1] - cum[i]) || 1);
    return { x: p[i][0] + (p[i + 1][0] - p[i][0]) * t, y: p[i][1] + (p[i + 1][1] - p[i][1]) * t, ang: Math.atan2(b[1] - a[1], b[0] - a[0]) }; };   // position + direction at distance s
  const flip = Math.cos(at(0).ang) < 0;   // neck going left: mirror the picture so the belly is still underneath
  ctx.imageSmoothingQuality = "high";
  for (let s = 0; s < L; s += STEP) {
    const m = at(Math.min(L, s + STEP / 2)), w = Math.min(STEP + 1.5, L - s + 1.5), u0 = s / L * art.w, uw = w / L * art.w;   // w = slice length drawn, u0/uw = which part of the picture
    ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(m.ang); if (flip) ctx.scale(1, -1);
    ctx.drawImage(art.img, u0 * art.R, 0, Math.min(uw, art.w - u0) * art.R, art.h * art.R, -STEP / 2, -H / 2, w, H);
    ctx.restore();
  }
}
// SNK_CV = the one canvas all snake bodies are painted on. It lives inside the board SVG (in a <foreignObject>), so redrawing is just painting -
// no picture file has to be encoded each time a head moves.
let SNK_CV = null;
function snakeCanvas() {
  if (!SNK_CV) {
    SNK_CV = document.createElement("canvas");
    SNK_CV.width = BOARD_BOX.w * 2; SNK_CV.height = BOARD_BOX.h * 2;   // 2 = twice the pixels, for sharpness
    SNK_CV.style.cssText = `width:${BOARD_BOX.w}px;height:${BOARD_BOX.h}px;display:block;pointer-events:none`;
  }
  return SNK_CV;
}
// snakeLayer(): paints all snake bodies onto the canvas and returns the SVG text of all snake heads. Redone only when a head moves (the cache key changes).
function snakeLayer() {
  const key = ART.v + JSON.stringify(G.S);
  if (SNK.key === key) return SNK.svg;
  const cv = snakeCanvas(), Q = 2, ctx = cv.getContext("2d");   // Q = canvas sharpness (2 = twice the pixels)
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);   // wipe the old snakes
  ctx.setTransform(Q, 0, 0, Q, -BOARD_BOX.x * Q, -BOARD_BOX.y * Q);               // canvas uses stage coordinates
  let heads = "";
  const pts = [], headTf = {};   // pts = centre-line points of each snake (keeps square numbers clear of bodies); headTf[square] = how each head is drawn (reused for the Charmer's glowing heads)
  // What a snake body should steer around, in grid coordinates [column, visual row]: every ladder, every other snake's head and tail, and the bodies of snakes already routed.
  const avoidBase = [], ends = n => { const [r, c] = rc(+n); return [c, 9 - r, c, 9 - r]; }, placed = [];
  for (const [a, b] of Object.entries(G.L)) { const [r1, c1] = rc(+a), [r2, c2] = rc(+b); avoidBase.push([c1, 9 - r1, c2, 9 - r2]); }
  Object.keys(G.S).map(Number).sort((a, b) => G.S[a] - G.S[b]).forEach(h => {
    const t = G.S[h], kd = ART.kinds[G.kind[t] % ART.kinds.length];
    const avoid = [...avoidBase, ...placed, ...Object.keys(G.S).filter(x => +x !== h).map(ends), ...Object.values(G.S).filter(x => x !== t).map(ends)];
    const g = snakeGeom(h, t, avoid);
    for (let i = 1; i < g.R.length; i++) placed.push([...g.R[i - 1], ...g.R[i]]);
    pts.push(g.p);
    if (kd.body) drawArtBody(ctx, g, kd); else drawFlatBody(ctx, g, kd);
    headTf[h] = headTransform(h, t, kd, g);
    heads += `<use href="#${kd.head.p}all" transform="${headTf[h]}"/>`;
  });
  SNK = { key, svg: heads, pts, headTf, headSq: new Set(Object.keys(G.S).map(Number)) };   // the heads go on top of the bodies canvas
  return SNK.svg;
}

// ------------------------------------------------------------------ LADDERS
// Ladders are built from the ladder pictures: straight ladders from ladder_straight.svg, diagonal ones from ladder_slanted.svg. The picture is
// STACKED (pieces overlap a little so the rungs keep an even gap) to cover the distance between the two squares; slanted pieces are ROTATED (never
// sheared) to point from one square to the other. Each ladder gets a 3px brown (BROWN) border. All ladders are painted once, on their own canvas.
const LADDER_PERIOD = { straight: 85.7, slanted: 84.2 };   // picture units from one stacked piece to the next (pieces overlap by ~14 so the rungs stay evenly spaced)
const LADDER_LEAN = .182;                                  // how far the slanted picture's rails drift sideways for every unit of height
let LAD_CV = null;   // the ladder canvas (lives inside the board SVG, like the snake canvas)
function ladderCanvas() {
  if (!LAD_CV) {
    LAD_CV = document.createElement("canvas");
    LAD_CV.width = BOARD_BOX.w * 2; LAD_CV.height = BOARD_BOX.h * 2;
    LAD_CV.style.cssText = `width:${BOARD_BOX.w}px;height:${BOARD_BOX.h}px;display:block;pointer-events:none`;
  }
  return LAD_CV;
}
// stackLadder(ctx, a, b): draw one ladder from square a (bottom) to square b (top) onto ctx (which already uses stage coordinates).
function stackLadder(ctx, a, b) {
  const [x1, y1] = xy(a), [x2, y2] = xy(b), dx = x2 - x1, dy = y2 - y1, Ln = Math.hypot(dx, dy);
  const straight = Math.abs(dx) < 4, art = straight ? ART.ladder.straight : ART.ladder.slanted, P = LADDER_PERIOD[straight ? "straight" : "slanted"], lean = straight ? 0 : LADDER_LEAN;
  const total = Ln + 36 * BS, k = Math.hypot(1, lean), s0 = .96 * BS;                         // total = how long the ladder is drawn (a little past the two square centres)
  const n = Math.max(1, Math.round((total - 100 * s0 * k) / (P * s0 * k) + 1));                // n = number of stacked pieces
  const s = total / (((n - 1) * P + 100) * k);                                                 // s = scale so the stack is exactly 'total' long
  const angD = Math.atan2(dy, dx), norm = r => { while (r > Math.PI) r -= 2 * Math.PI; while (r <= -Math.PI) r += 2 * Math.PI; return r; };
  let best = null;                                                                              // choose mirror + direction needing the smallest rotation
  for (const m of [1, -1]) {
    if (straight && m === -1) continue;
    const angV = Math.atan2(1, m * lean);
    for (const flip of [0, Math.PI]) { const rot = norm(angD - angV + flip); if (!best || Math.abs(rot) < Math.abs(best.rot)) best = { rot, m }; }
  }
  const cx = art.w / 2 + (n - 1) * lean * P / 2, cy = ((n - 1) * P + 100) / 2;               // centre of the stack in picture units
  ctx.save();
  ctx.translate((x1 + x2) / 2, (y1 + y2) / 2); ctx.rotate(best.rot); ctx.scale(best.m * s, s); ctx.translate(-cx, -cy);
  ctx.imageSmoothingQuality = "high";
  for (let i = 0; i < n; i++) ctx.drawImage(art.img, i * lean * P, i * P, art.w, art.h);
  ctx.restore();
}
// drawLadders(): paint every ladder with its brown outline (the outline = the ladder's silhouette stamped around it in a 3px circle).
function drawLadders() {
  const cv = ladderCanvas(), ctx = cv.getContext("2d"), Q = 2, W = cv.width, H = cv.height;
  const mk = () => { const c = document.createElement("canvas"); c.width = W; c.height = H; return c; };
  const tmp = mk(), tx = tmp.getContext("2d"), sil = mk(), sx = sil.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
  for (const [a, b] of Object.entries(G.L)) {
    tx.setTransform(1, 0, 0, 1, 0, 0); tx.clearRect(0, 0, W, H); tx.setTransform(Q, 0, 0, Q, -BOARD_BOX.x * Q, -BOARD_BOX.y * Q);
    stackLadder(tx, +a, b);                                                                    // 1. this ladder on its own
    sx.setTransform(1, 0, 0, 1, 0, 0); sx.clearRect(0, 0, W, H); sx.globalCompositeOperation = "source-over"; sx.drawImage(tmp, 0, 0);
    sx.globalCompositeOperation = "source-in"; sx.fillStyle = BROWN; sx.fillRect(0, 0, W, H); sx.globalCompositeOperation = "source-over";   // 2. its brown silhouette
    for (let i = 0; i < 20; i++) { const an = i / 20 * 2 * Math.PI; ctx.drawImage(sil, Math.cos(an) * 3 * Q, Math.sin(an) * 3 * Q); }       // 3. the 3px border
    ctx.drawImage(tmp, 0, 0);                                                                  // 4. the ladder on top of its border
  }
}

// ------------------------------------------------------------------ ITEMS ON THE BOARD
// G.items = items lying on squares: { type: "stick"|"brick"|"drink"|"stone", sq: square, trap: true if it is a toy brick someone PLACED }.
// They are drawn above ladders and snakes so they are never hidden. Placed bricks glow red (they are traps).
// itemFit(type, maxW, maxH): size to draw an item so it fits inside a box, keeping its shape.
function itemFit(type, maxW, maxH) { const a = ITEMS[type], k = Math.min(maxW / a.w, maxH / a.h); return { w: a.w * k, h: a.h * k }; }
// renderItems(): redraw the items layer if the list changed.
function renderItems() {
  const key = JSON.stringify(G.items.map(i => [i.type, i.sq, !!i.trap]));
  if (G.itemKey === key) return;
  G.itemKey = key;
  let s = "";
  for (const it of G.items) {
    const [x, y] = xy(it.sq), k = ITEM_BOARD_SCALE[it.type] || 1, f = itemFit(it.type, 60 * BS * k, 52 * BS * k);
    s += `<image class="gitem${it.trap ? " trap" : ""}" href="${A(ITEMS[it.type].file)}" x="${f1(x - f.w / 2)}" y="${f1(y - f.h / 2 - 2)}" width="${f1(f.w)}" height="${f1(f.h)}"/>`;
  }
  $("gItems").innerHTML = s;
}

// ------------------------------------------------------------------ BOARD
// ---- square numbers ----
// NUM_H = height of the number pictures (bigger = more readable). Numbers sit in a corner of their tile; placeNumbers() picks a corner no snake or ladder covers.
const NUM_H = 24 * BS;
// numWidth(n): how wide the number n is when drawn from the digit pictures (falls back to a text estimate).
function numWidth(n) {
  const gs = [...String(n)].map(c => ART.digits[+c]);
  return gs.some(g => !g) ? String(n).length * 14 : gs.reduce((a, g) => a + g.w / g.h * NUM_H + 1, -1);
}
// numSvg(n,x,y): SVG text that draws number n with its top-left corner at (x,y), using the digit pictures (plain text if they're missing).
function numSvg(n, x, y) {
  const gs = [...String(n)].map(c => ART.digits[+c]);
  if (gs.some(g => !g)) return `<text x="${x}" y="${y + NUM_H}" font-size="22" fill="#fff" stroke="#000" stroke-width="3" paint-order="stroke">${n}</text>`;
  let o = "", cx = x;
  for (const g of gs) { const w = g.w / g.h * NUM_H; o += `<image href="${A(g.f)}" x="${f1(cx)}" y="${f1(y)}" width="${f1(w)}" height="${NUM_H}"/>`; cx += w + 1; }
  return o;
}
// segDist(px,py, ax,ay, bx,by): shortest distance from point (px,py) to the line segment a-b.
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1, t = cl(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
// placeNumbers(): for every tile choose the corner for its number: top-right first, then top-left, bottom-right, bottom-left - the first one
// that no snake body, snake head or ladder passes over. If every corner is covered, use top-right. Called whenever the snakes change (see render()).
function placeNumbers() {
  const ladders = Object.entries(G.L).map(([a, b]) => {   // ladder centre lines, trimmed where the rails end
    const [x1, y1] = xy(+a), [x2, y2] = xy(b), [ux, uy] = unit(x2 - x1, y2 - y1);
    return [x1 + ux * 22, y1 + uy * 22, x2 - ux * 22, y2 - uy * 22];
  });
  for (let n = 1; n <= 100; n++) {
    const [r0, c0] = rc(n), x = BX0 + c0 * CX, y = BY0 + (9 - r0) * CY, w = numWidth(n), pad = 8;
    const corners = [[x + TW - pad - w, y + pad], [x + pad, y + pad], [x + TW - pad - w, y + TW - pad - NUM_H], [x + pad, y + TW - pad - NUM_H]];   // TR, TL, BR, BL
    let chosen = corners[0];
    if (!SNK.headSq.has(n)) {
      for (const c of corners) {
        const cx = c[0] + w / 2, cy = c[1] + NUM_H / 2, reach = Math.hypot(w / 2, NUM_H / 2) * .8;   // reach = how far the number sticks out from its centre
        const hitSnake = SNK.pts.some(p => p.some(q => Math.abs(q[0] - cx) < 60 && Math.abs(q[1] - cy) < 60 && Math.hypot(q[0] - cx, q[1] - cy) < BODY_W / 2 + 3 + reach));
        const hitLadder = ladders.some(l => segDist(cx, cy, l[0], l[1], l[2], l[3]) < 36 * BS + reach);
        if (!hitSnake && !hitLadder) { chosen = c; break; }
      }
    }
    $("nm" + n).innerHTML = numSvg(n, chosen[0], chosen[1]);
  }
}
// catHref(): picture address of the cat's current skin.
const catHref = () => A(ART.cats[G.catSkin % ART.cats.length].f);

// buildBoard(): builds the whole board SVG once at game start. Layers, bottom to top: tile shadows, tiles (with numbers), ladders, snake bodies,
// snake heads, items, highlight outlines, the Charmer's glowing heads, drag ghost, pawns.
function buildBoard() {
  let sh = "", tl = "", hl = "";
  const S0 = ART.shadow;
  for (let n = 1; n <= 100; n++) {
    const [r0, c0] = rc(n), x = BX0 + c0 * CX, y = BY0 + (9 - r0) * CY;
    const L = ART.tiles[(r0 + c0) % 2 === 0 ? "dark" : "light"], T = L[(n * 37 % 11) % L.length];   // checkerboard colours
    sh += `<use href="#${S0.p}all" transform="translate(${f1(x - (S0.vb[2] * TK - TW) / 2)} ${f1(y + .5)}) scale(${TK})"/>`;
    tl += `<g class="tile" id="tl${n}"><use href="#${T.p}all" transform="translate(${f1(x)} ${f1(y)}) scale(${TK})"/><g class="nm" id="nm${n}"></g></g>`;
    hl += `<rect class="hl" id="hl${n}" x="${f1(x)}" y="${f1(y)}" width="${TW}" height="${TW}" rx="7"/>`;   // the pulsing lime outline (hidden until needed)
  }
  // pawns: one group per player, plus one for the cat. Their position/size is set by placePawns().
  let pw = "";
  G.players.forEach((p, i) => {
    pw += `<g class="pw" id="pw${i}" data-k="${i}"><g class="bob"><g class="ring"><circle r="58" fill="none" stroke="${LIME}" stroke-width="7"/></g>` +
      `<circle r="50" fill="${p.color}" stroke="#000" stroke-width="4"/><image href="${A(PORT[p.cls] + ".svg")}" x="-54" y="-56" width="108" height="108" preserveAspectRatio="xMidYMid meet"/></g></g>`;
  });
  if (G.cat) pw += `<g class="pw cat" id="pwc"><g class="bob"><g class="ring"><circle r="62" fill="none" stroke="${LIME}" stroke-width="7"/></g><image id="catimg" href="${catHref()}" x="-64" y="-54" width="128" height="108" preserveAspectRatio="xMidYMid meet"/></g></g>`;
  const fo = id => `<g id="${id}"><foreignObject x="${BOARD_BOX.x}" y="${BOARD_BOX.y}" width="${BOARD_BOX.w}" height="${BOARD_BOX.h}" style="pointer-events:none"></foreignObject></g>`;
  $("board").innerHTML = `<svg viewBox="${BOARD_BOX.x} ${BOARD_BOX.y} ${BOARD_BOX.w} ${BOARD_BOX.h}"><defs>${artDefs()}</defs><g>${sh}</g><g>${tl}</g>${fo("gLadBody")}${fo("gSnkBody")}<g id="gSnk"></g><g id="gItems"></g><g>${hl}</g><g id="gHandle"></g><g id="gGhost"></g><g id="gPawn">${pw}</g></svg>`;
  $("gLadBody").firstChild.appendChild(ladderCanvas());   // the ladder canvas sits above the tiles...
  $("gSnkBody").firstChild.appendChild(snakeCanvas());    // ...and the snake-body canvas above the ladders
  drawLadders();
  G.snkKey = ""; G.numKey = ""; G.itemKey = "";
}

// ------------------------------------------------------------------ HIGHLIGHTS
// setHL([squares]): show the pulsing lime outline on exactly these squares (empty list = hide all). Used while a piece is being dragged.
function setHL(list) { for (let n = 1; n <= 100; n++) $("hl" + n).classList.toggle("on", list.includes(n)); }

// ------------------------------------------------------------------ PAWNS
// placePawns(): put every pawn (and the cat) on its square. Pawns on the same square share it: the more there are, the smaller each gets.
// A pawn whose player drank an energy drink this turn (p.big) is drawn a little bigger.
function placePawns() {
  const tokens = G.players.map((p, i) => ({ el: $("pw" + i), sq: p.pos, big: p.big }));
  if (G.cat) tokens.push({ el: $("pwc"), sq: G.cat.pos });
  const by = {};   // by[square] = list of tokens standing there
  tokens.forEach(t => (by[t.sq] = by[t.sq] || []).push(t));
  for (const sq in by) {
    const list = by[sq], m = list.length, cols = Math.ceil(Math.sqrt(m)), rows = Math.ceil(m / cols);   // arrange in a grid
    const cell = 82 * BS / Math.max(cols, rows), size = Math.min(72 * BS, cell * 1.08), [cx, cy] = xy(+sq);   // cell = room per pawn, size = drawn pawn size
    list.forEach((t, i) => {
      const row = Math.floor(i / cols), inRow = row < rows - 1 ? cols : m - cols * (rows - 1);          // last row may be shorter: centre it
      const x = cx + (i % cols - (inRow - 1) / 2) * cell, y = cy - 2 + (row - (rows - 1) / 2) * cell;
      if (t.el.classList.contains("drag")) return;                                                     // don't fight the mouse while dragging
      t.el.style.transform = `translate(${f1(x)}px,${f1(y)}px) scale(${(size / 100 * (t.big ? 1.18 : 1)).toFixed(3)})`;   // CSS transition animates growing/shrinking/moving
    });
  }
}

// ------------------------------------------------------------------ LEFT-HAND PLAYER PANELS
// Each panel: the panel art, the portrait on the halftone square, the player's name in the lime box, three item slots in the dark rectangles,
// and the Buff / Debuff counters hanging underneath. On the player's turn the panel (.pbody) "sinks" a little into its static shadow (CSS .cur); the counters and shadow do not move.
// fitPx(text, width, max): font size that makes the text fit inside a field.
const fitPx = (t, w, mx) => Math.max(9, Math.min(mx, w / (Math.max(1, t.length) * .62)));
// panelPos(i): stage coordinates of the top-left of the panel for player i.
const panelPos = i => [PANEL.x, PANEL.y0 + i * PANEL.pitch];
// slotCenter(i, j): stage coordinates of the centre of item slot j on player i's panel (used to launch thrown items from the slot).
function slotCenter(i, j) { const [px, py] = panelPos(i), s = PANEL.slots[j]; return [px + s.x + s.w / 2, py + s.y + s.h / 2]; }
// buildPanels(): one panel per player. Panels alternate orange / blue.
function buildPanels() {
  $("panels").innerHTML = G.players.map((p, i) => {
    const [px, py] = panelPos(i), f = PANEL.field, pt = PANEL.portrait;
    const slots = PANEL.slots.map((s, j) => `<div class="slot" data-p="${i}" data-i="${j}" style="left:${s.x}px;top:${s.y}px;width:${s.w}px;height:${s.h}px"></div>`).join("");
    return `<div class="pp" id="pp${i}" style="left:${px}px;top:${py}px" title="${esc(CLASSES.find(c => c.id === p.cls).name)}"><img class="psh" src="${A("player_panel_shadow.svg")}" alt="" style="left:${PANEL_SHADOW.x}px;width:${PANEL_SHADOW.artW}px;transform-origin:0 0;transform:scale(${PANEL_SHADOW.w / PANEL_SHADOW.artW},${PANEL_SHADOW.h / PANEL_SHADOW.artH})"><div class="pbody"><img class="pbg" src="${A("player_panel_" + (i % 2 ? "dark" : "light") + ".svg")}" alt=""><img class="port" src="${A(PORT[p.cls] + ".svg")}" alt="" style="left:${pt.cx}px;top:${pt.cy}px;height:${pt.size + 16}px">
<div class="fld" style="left:${f.x}px;top:${f.y}px;width:${f.w}px;height:${f.h}px;font-size:${fitPx(p.name, f.w - 12, 24)}px">${esc(p.name)}</div>${slots}</div>
<div class="ctr" style="left:168px"><img class="csh" src="${A("counter_shadow.svg")}" alt=""><img src="${A("counter_buff.svg")}" alt=""><span id="bf${i}">+0</span></div>
<div class="ctr" style="left:272px"><img class="csh" src="${A("counter_shadow.svg")}" alt=""><img src="${A("counter_debuff.svg")}" alt=""><span id="df${i}">-0</span></div></div>`;
  }).join("");
}
// updateSlots(): show each player's items in their three slots (an item picture fitted to the slot, centred).
function updateSlots() {
  G.players.forEach((p, i) => {
    PANEL.slots.forEach((s, j) => {
      const el = document.querySelector(`.slot[data-p="${i}"][data-i="${j}"]`), t = p.items[j] || "";
      if (el.dataset.t === t) return;
      el.dataset.t = t;
      if (!t) { el.innerHTML = ""; return; }
      const f = itemFit(t, 56, 40);
      el.innerHTML = `<img src="${A(ITEMS[t].file)}" alt="${ITEMS[t].name}" title="${ITEMS[t].name}" style="width:${f.w}px;height:${f.h}px">`;
    });
  });
}

// setCounter(id, text): show text on a Buff/Debuff counter. When the number CHANGES the whole counter animates: it sinks, comes back up with a lime
// glow (CSS class "pop") and plays a small click. G.ctrPrev remembers the last text of every counter; the first call for a counter never animates.
function setCounter(id, text) {
  const el = $(id), prev = G.ctrPrev || (G.ctrPrev = {});
  el.textContent = text;
  if (prev[id] !== undefined && prev[id] !== text) {
    const box = el.parentElement;
    box.classList.remove("pop"); void box.offsetWidth; box.classList.add("pop");   // (reading offsetWidth lets the animation restart if it is already running)
    sfx("small");
  }
  prev[id] = text;
}

// ------------------------------------------------------------------ MAIN DRAW FUNCTION
// render(): bring the screen up to date with G. Called after every change. Cheap enough to call often.
function render() {
  if (!G) return;
  if (!G.built || !$("tl1")) { buildBoard(); buildPanels(); G.built = 1; }                       // first call: build everything
  const sv = snakeLayer();
  if (G.snkKey !== SNK.key) { $("gSnk").innerHTML = sv; G.snkKey = SNK.key; }       // redraw snakes only if they changed
  if (G.numKey !== SNK.key) { placeNumbers(); G.numKey = SNK.key; }               // move square numbers out from under snakes/ladders
  renderItems();
  const occ = new Set(G.players.map(p => p.pos));
  for (let n = 1; n <= 100; n++) {
    const el = $("tl" + n);
    if (el) el.classList.toggle("occ", occ.has(n));   // occupied tiles sink
  }
  placePawns(); updateSlots();
  G.players.forEach((p, i) => {
    const act = G.cur === p && !G.winner && !G.catNow;                               // is it this player's own turn?
    const pw = $("pw" + i);
    if (pw) {
      pw.classList.toggle("act", act);                                        // lime ring + gentle pulse on the pawn
      if (act && $("gPawn").lastChild !== pw) $("gPawn").appendChild(pw);   // bring the active pawn to the front
    }
    const pp = $("pp" + i);
    if (pp) pp.classList.toggle("cur", act || (G.catNow && G.catOwner === p));      // the active panel sinks into its shadow
    setCounter("bf" + i, `+${p.cb || 0}`);                                           // buff counter
    setCounter("df" + i, `-${p.pen || 0}`);                                          // debuff counter
  });
  if (G.cat && $("pwc")) $("pwc").classList.toggle("act", !!G.catNow && !G.winner);
}

// switchCat(): change the cat to a different random picture (never the same as now). Called when the cat is clicked or moves squares.
function switchCat() {
  if (!G || !G.cat || ART.cats.length < 2) return;
  let n; do { n = rnd(0, ART.cats.length - 1); } while (n === G.catSkin % ART.cats.length);
  G.catSkin = n;
  $("catimg").setAttribute("href", catHref());
}
