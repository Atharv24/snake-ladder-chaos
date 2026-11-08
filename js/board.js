// =====================================================================================
//  board.js  -  square numbering and random board generation
//  Squares are numbered 1-100 in the classic zig-zag: row 0 (bottom) runs left to right, row 1 right to left, and so on.
//  Snakes are stored as { headSquare: tailSquare }. Ladders as { bottomSquare: topSquare }.
// =====================================================================================

// rc(n): square number -> [row, column]. Row 0 is the bottom row, column 0 the left column.
const rc = n => { const i = n - 1, r = Math.floor(i / 10); return [r, r % 2 ? 9 - i % 10 : i % 10]; };
// toN(r,c): the opposite - [row, column] -> square number.
const toN = (r, c) => r * 10 + (r % 2 ? 9 - c : c) + 1;
// cellPx(c, vr): on-screen pixel centre of the tile in column c, "visual row" vr (0 = TOP row of the screen).
const cellPx = (c, vr) => [BX0 + c * CX + TW / 2, BY0 + vr * CY + 46 * BS];
// xy(n): on-screen pixel centre of square n. Used by pawns, ladders, snakes.
function xy(n) { const [r, c] = rc(n); return cellPx(c, 9 - r); }
// squareAt(x, y): which square (1-100) is at a screen position? Returns 0 if the position is off the board. Used when dropping a piece.
function squareAt(x, y) {
  const c = Math.floor((x - BX0) / CX), vr = Math.floor((y - BY0) / CY);
  return (c < 0 || c > 9 || vr < 0 || vr > 9) ? 0 : toN(9 - vr, c);
}

// tryBoard(): one attempt at a random board following the layout rules. Returns null if the attempt breaks a rule.
// Rules: 2 snakes (one long, one short) with heads on 91-99 and a ladder ending between them;
// other snakes weighted toward the upper rows; ladders mostly vertical (at most 1 wide one); every row but the bottom has something.
function tryBoard() {
  const used = [], L = {}, Sn = {};
  // ok(n,g): is square n free and at least g squares away from every used square?
  const ok = (n, g) => n > 1 && n < 100 && used.every(u => Math.abs(u - n) >= g);
  // add(g, ...squares): claim squares if they are all free and not too close to each other
  const add = (g, ...ns) => {
    for (let i = 0; i < ns.length; i++) {
      if (!ok(ns[i], g) || ns.some((m, j) => j !== i && Math.abs(m - ns[i]) < g)) return false;
    }
    used.push(...ns); return true;
  };
  const h1 = rnd(91, 95), h2 = rnd(h1 + 4, 99), e = rnd(h1 + 2, h2 - 2);   // two top snake heads and the ladder's top square between them
  const t1 = h1 - rnd(8, 14), t2 = h2 - rnd(35, 55);                        // snake 1 is short, snake 2 is long
  if (!add(2, h1, h2, e, t1, t2)) return null;
  Sn[h1] = t1; Sn[h2] = t2;
  let s = 0;   // the ladder that ends at e: find a bottom square 20-50 below, no more than 4 columns away
  for (let k = 0; k < 60 && !L[s]; k++) { s = e - rnd(20, 50); if (s > 1 && Math.abs(rc(s)[1] - rc(e)[1]) <= 4 && add(2, s)) L[s] = e; }
  if (!L[s]) return null;
  const wr = [];   // weighted list of head rows: higher rows appear more often
  for (let r = 1; r <= 8; r++) for (let k = 0; k < r * r; k++) wr.push(r);
  for (let i = 2; i < CONFIG.SNAKES; i++) {   // the remaining snakes
    let done = false;
    for (let k = 0; k < 80 && !done; k++) {
      const hr = wr[rnd(0, wr.length - 1)], tr = Math.max(0, hr - rnd(1, 4)), hc = rnd(0, 9), tc = cl(hc + rnd(-4, 4), 0, 9);
      const h = toN(hr, hc), t = toN(tr, tc);
      if (h - t >= 6 && add(k < 40 ? 2 : 1, h, t)) { Sn[h] = t; done = true; }
    }
    if (!done) return null;
  }
  let wide = 0;   // how many wide (mostly horizontal) ladders so far (max 1)
  for (let i = 1; i < CONFIG.LADDERS; i++) {   // the remaining ladders
    let done = false;
    for (let k = 0; k < 80 && !done; k++) {
      const horiz = !wide && Math.random() < .15, sr = rnd(0, 7), sc = rnd(0, 9);
      const er = sr + (horiz ? rnd(1, 2) : rnd(2, 5)), ec = cl(sc + (horiz ? (Math.random() < .5 ? -1 : 1) * rnd(6, 9) : rnd(-3, 3)), 0, 9);
      if (er > 8 || (horiz && Math.abs(ec - sc) < 5)) continue;
      const a = toN(sr, sc), b = toN(er, ec);
      if (add(k < 40 ? 2 : 1, a, b)) { L[a] = b; if (horiz) wide++; done = true; }
    }
    if (!done) return null;
  }
  // final checks: every row above the bottom is used, left/middle/right thirds are balanced, and not too many low snakes
  const pts = [...Object.keys(L), ...Object.values(L), ...Object.keys(Sn), ...Object.values(Sn)].map(Number), rows = new Set(pts.map(n => rc(n)[0]));
  for (let r = 1; r < 10; r++) if (!rows.has(r)) return null;
  const cb = [0, 0, 0]; pts.forEach(n => cb[rc(n)[1] < 3 ? 0 : rc(n)[1] < 7 ? 1 : 2]++);
  if (cb.some(x => x < 5)) return null;
  if (Object.keys(Sn).map(Number).filter(h => rc(h)[0] < 5).length > 2) return null;
  return { L, S: Sn, cobra: t2 };   // "cobra" = the tail square of the long snake; that snake wears the cobra head
}
// genBoard(): keep trying until a valid board comes out. Returns { L, S, cobra }.
function genBoard() { for (let i = 0; i < 3000; i++) { const b = tryBoard(); if (b) return b; } return genBoard(); }
