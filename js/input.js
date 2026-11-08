// =====================================================================================
//  input.js  -  everything the PLAYER does with the mouse/finger:
//    1. the prompt box + choice buttons (bottom of the board log panel)
//    2. drag-and-drop of pawns and snake heads
//    3. the dice: grab, throw, bounce around the rolling board (or just press ROLL)
//    4. clicking the cat to change its picture
//  rules.js calls: ask(), choose(), awaitMove(), rollDice(). Nothing here knows the game rules.
// =====================================================================================

// stagePt(e): mouse position converted to the 1920x1080 stage's own coordinates (works at any window size / zoom).
function stagePt(e) {
  const r = $("stage").getBoundingClientRect();
  return [(e.clientX - r.left) * 1920 / r.width, (e.clientY - r.top) * 1080 / r.height];
}

// ------------------------------------------------------------------ 1. PROMPT BOX + BUTTONS
// setPrompt(text): show a message in the prompt box (empty text clears it) and remove old buttons.
function setPrompt(t) { $("ptxt").textContent = t; $("btns").innerHTML = ""; $("prompt").classList.remove("choice"); }
// makeBtn(label, alt): a button drawn with the counter art (see .cbtn in css/style.css). alt = true gives the blue (debuff) version.
function makeBtn(label, alt) {
  const b = document.createElement("button");
  b.className = "cbtn" + (alt ? " alt" : "");
  b.innerHTML = `<span>${label}</span>`;
  return b;
}
// choose(msg, opts, p): show msg with one big button per option. Resolves with the clicked option's value.
// opts are strings or {label, value, alt}. While buttons are showing, the prompt grows to cover most of the log (CSS class "choice").
function choose(msg, opts, p) {
  const actor = p || (G && G.cur);
  const curIdx = actor && G ? G.players.indexOf(actor) : 0;
  const isMyTurn = !NET.active || !G || (curIdx === NET.myPlayerIndex);

  // If online and it's someone else's decision, wait for their choice
  if (NET.active && G && actor) {
    if (NET.isHost) {
      broadcast({ type: "WAIT_CHOOSE", playerIndex: curIdx, msg, opts });
    }
    if (!isMyTurn) {
      setPrompt(`${actor.name} is making a choice...`);
      return new Promise(res => {
        NET.pendingChoiceRes = res;
      });
    }
  }

  return new Promise(res => {
    setPrompt(msg);
    opts.forEach(o => {
      const b = makeBtn(o.label ?? o, o.alt);
      b.onclick = () => {
        setPrompt("");
        const val = o.value ?? o;
        if (NET.active) {
          sendAction({ type: "CHOOSE", val });
        }
        res(val);
      };
      $("btns").appendChild(b);
    });
    if (opts.length) $("prompt").classList.add("choice");
  });
}
// ask(msg, opts, p): like choose(), BUT if there is only ONE option it is picked automatically with no prompt at all.
// (The caller should log a flavour line in that case - see rules.js.)
async function ask(msg, opts, p) {
  if (opts.length === 1) return opts[0].value ?? opts[0];
  return choose(msg, opts, p);
}

// ------------------------------------------------------------------ 2. DRAG AND DROP OF PIECES
// PEND = the move the game is waiting for right now: { pieces:[...], res:function }. null when nothing is pending.
// A "piece" = { key, el, targets:[squares it may land on], ghost:function(x,y)->svg text (snake heads only) }.
let PEND = null;
// DRAG = the piece being held by the mouse right now: { piece, moved }.
let DRAG = null;

// awaitMove({pieces, text, button}): wait until the player drops one of the pieces on one of its allowed squares,
// OR presses the helper button on the rolling board (e.g. "Move for me") OR hits the Space bar. Resolves { key, to } for a drop, or null for the button.
async function awaitMove({ pieces, text, button }) {
  const curIdx = G && G.cur ? G.players.indexOf(G.cur) : 0;
  const isMyTurn = !NET.active || !G || (curIdx === NET.myPlayerIndex);

  if (NET.active && G && G.cur) {
    if (NET.isHost) {
      const isPawn = pieces.length === 1 && pieces[0].key === "pawn";
      broadcast({
        type: "WAIT_MOVE",
        playerIndex: curIdx,
        moveKind: isPawn ? "pawn" : "heads",
        targets: isPawn ? pieces[0].targets : [],
        heads: isPawn ? null : pieces.map(p => ({ h: p.key, targets: p.targets })),
        text,
        button: button ? button.label : null
      });
    }

    if (!isMyTurn) {
      setPrompt(`Waiting for ${G.cur.name} to make their move...`);
      return new Promise(res => {
        NET.pendingMoveRes = res;
      });
    }
  }

  pieces.forEach(p => { if (p.el) p.el.classList.add("grab"); });
  setPrompt(text);
  const mb = $("moveBtn");
  const pressed = new Promise(res => {
    if (!button) return;                                    // no helper button for this move: only a drop can finish it
    mb.querySelector("span").textContent = button.label; mb.style.display = "block";
    mb.onclick = () => {
      if (NET.active) sendAction({ type: "MOVE", result: null });
      res(null);
    };
  });
  const dropped = new Promise(res => {
    PEND = {
      pieces,
      res: dropRes => {
        if (NET.active) sendAction({ type: "MOVE", result: dropRes });
        res(dropRes);
      }
    };
  });
  const result = await Promise.race([dropped, pressed]);
  mb.style.display = "none"; mb.onclick = null;
  pieces.forEach(p => { if (p.el) p.el.classList.remove("grab"); });
  PEND = null; DRAG = null; setPrompt(""); setHL([]); $("gGhost").innerHTML = ""; $("gHandle").innerHTML = "";
  return result;
}

// Space bar: same as pressing the ROLL button (when the dice are waiting) or the helper button on the rolling board ("Move for me" / "Just roll").
window.addEventListener("keydown", e => {
  if (e.code !== "Space" || e.repeat) return;
  if (/INPUT|TEXTAREA|SELECT/.test((e.target.tagName || ""))) return;   // typing a name: leave Space alone
  e.preventDefault();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  if (DICE.waiting && !DICE.flying && DICE.canInteract) { sfx("small"); rollPressed(); }
  else if ($("moveBtn").style.display === "block") { sfx("small"); $("moveBtn").click(); }   // "Move for me" / "Just roll" / "Roll" (item phase) / "Cancel" (item targeting)
});

// Mouse pressed: grab a piece, throw a die, or click the cat.
window.addEventListener("pointerdown", e => {
  const t = e.target;
  const sl = t.closest && t.closest(".slot.usable");                                // clicking one of your glowing items (item phase)
  if (sl && ITEMWAIT) { e.preventDefault(); ITEMWAIT.res(+sl.dataset.i); return; }
  if (TGT) {                                                                        // choosing a target square for an item
    const [x, y] = stagePt(e), sq = squareAt(x, y);
    if (TGT.targets.includes(sq)) { e.preventDefault(); TGT.res(sq); return; }
  }
  if (t.closest && t.closest(".cat")) { switchCat(); sfx("small"); }                                  // 4. clicking the cat changes its picture (any time, any player)
  const die = t.closest && t.closest(".die");
  if (die && DICE.waiting && !DICE.flying && DICE.canInteract) { e.preventDefault(); dieDown(+die.dataset.i, e); return; }   // 3. grab a die (only on your turn)
  const g = t.closest && t.closest(".grab");
  if (!g || !PEND) return;
  const piece = PEND.pieces.find(p => p.el === g);
  if (!piece) return;
  e.preventDefault();
  DRAG = { piece, moved: false };
  sfx("small");                                                                     // picked up
  setHL(piece.targets);                                                             // pulsing lime outlines on every legal square
  if (piece.ghost) { const [x, y] = stagePt(e); $("gGhost").innerHTML = piece.ghost(x, y); }   // snake heads: a copy follows the mouse
  else piece.el.classList.add("drag");                                              // pawns: the pawn itself follows the mouse
  dragTo(e);
});
// Mouse moved: drag the held piece / die along.
window.addEventListener("pointermove", e => { if (DRAG) dragTo(e); if (DD) dieMove(e); });
function dragTo(e) {
  if (!DRAG) return;
  DRAG.moved = true;
  const [x, y] = stagePt(e), p = DRAG.piece;
  if (p.ghost) $("gGhost").innerHTML = p.ghost(x, y);
  else p.el.style.transform = `translate(${f1(x)}px,${f1(y)}px) scale(.95)`;
}
// Mouse released: drop. Legal square -> the move is done. Anywhere else -> the piece slides back.
window.addEventListener("pointerup", e => {
  if (DD) { dieUp(e); return; }
  if (!DRAG) return;
  const [x, y] = stagePt(e), p = DRAG.piece, sq = squareAt(x, y);
  p.el.classList.remove("drag"); $("gGhost").innerHTML = ""; setHL([]);
  const ok = DRAG.moved && p.targets.includes(sq);
  DRAG = null;
  if (ok) { sfx("tock"); PEND.res({ key: p.key, to: sq }); }          // a good drop: the "tock" sound plays right now, as the piece lands
  else render();                                                                    // snap the pawn back to its square
});

// makeHandles(heads): put a copy of each snake head the Charmer may grab on top of the board, with a lime outline that pulses in size
// (CSS classes .hd and .hpulse); returns the list of pieces for awaitMove. heads = [{ h: head square, targets: [squares], ghost: function }]
function makeHandles(heads) {
  let s = "";
  heads.forEach(o => {
    const kd = ART.kinds[G.kind[G.S[o.h]] % ART.kinds.length], [x, y] = xy(o.h);
    s += `<g class="grab hd" data-k="${o.h}"><circle cx="${f1(x)}" cy="${f1(y - 4)}" r="42" fill="rgba(255,255,255,.01)"/><g class="hpulse"><use href="#${kd.head.p}all" transform="${SNK.headTf[o.h]}"/></g></g>`;   // the invisible circle makes the head easy to grab
  });
  $("gHandle").innerHTML = s;
  return heads.map(o => ({ key: o.h, el: $("gHandle").querySelector(`[data-k="${o.h}"]`), targets: o.targets, ghost: o.ghost }));
}

// ------------------------------------------------------------------ ITEM INPUT (used by rules.js: itemPhase / useItem)
// ITEMWAIT = waiting for the player to click one of their glowing items: { res }. TGT = waiting for a click on one of the highlighted squares: { targets, res }.
let ITEMWAIT = null, TGT = null;
// showHelper(label, onclick): show the big helper button on the rolling board with a label (it doubles as the Space-bar action).
function showHelper(label, fn) { const mb = $("moveBtn"); mb.querySelector("span").textContent = label; mb.style.display = "block"; mb.onclick = fn; }
function hideHelper() { const mb = $("moveBtn"); mb.style.display = "none"; mb.onclick = null; }
// awaitItemChoice(p, text, label): make player p's items glow and wait. Resolves with the SLOT NUMBER of the item they click, or null if they press the helper button (label, e.g. "Roll").
async function awaitItemChoice(p, text, label) {
  const pIdx = G.players.indexOf(p);
  const isMyTurn = !NET.active || !G || (pIdx === NET.myPlayerIndex);

  if (NET.active && NET.isHost) {
    broadcast({ type: "WAIT_ITEM", playerIndex: pIdx, text, label });
  }

  if (!isMyTurn) {
    setPrompt(`Waiting for ${p.name} to choose items or roll...`);
    return new Promise(res => {
      NET.pendingItemRes = res;
    });
  }

  const idx = pIdx;
  const slots = [...document.querySelectorAll(`.slot[data-p="${idx}"]`)].filter(s => s.dataset.t);
  slots.forEach(s => s.classList.add("usable"));                  // pulse + lime glow (CSS .slot.usable)
  setPrompt(text);
  const pressed = new Promise(res => showHelper(label, () => {
    if (NET.active) sendAction({ type: "ITEM_CHOICE", val: null });
    res(null);
  }));
  const clicked = new Promise(res => {
    ITEMWAIT = {
      res: slotIdx => {
        if (NET.active) sendAction({ type: "ITEM_CHOICE", val: slotIdx });
        res(slotIdx);
      }
    };
  });
  const r = await Promise.race([pressed, clicked]);
  hideHelper(); ITEMWAIT = null; slots.forEach(s => s.classList.remove("usable")); setPrompt("");
  return r;
}
// awaitTarget({targets, text, label}): highlight squares (pulsing lime outline) and wait for a click on one of them. Resolves with the square, or null if "Cancel" (the helper button / Space) is pressed.
async function awaitTarget({ targets, text, label }) {
  const curIdx = G && G.cur ? G.players.indexOf(G.cur) : 0;
  const isMyTurn = !NET.active || !G || (curIdx === NET.myPlayerIndex);

  if (NET.active && G && G.cur) {
    if (NET.isHost) {
      broadcast({ type: "WAIT_TARGET", playerIndex: curIdx, targets, text, label });
    }
    if (!isMyTurn) {
      setPrompt(`Waiting for ${G.cur.name} to choose target...`);
      return new Promise(res => {
        NET.pendingTargetRes = res;
      });
    }
  }

  setHL(targets); setPrompt(text);
  const pressed = new Promise(res => showHelper(label || "Cancel", () => {
    if (NET.active) sendAction({ type: "TARGET", val: null });
    res(null);
  }));
  const picked = new Promise(res => {
    TGT = {
      targets,
      res: sq => {
        if (NET.active) sendAction({ type: "TARGET", val: sq });
        res(sq);
      }
    };
  });
  const r = await Promise.race([pressed, picked]);
  hideHelper(); TGT = null; setHL([]); setPrompt("");
  return r;
}
// elCenter(el): centre of a page element in stage coordinates (to launch or land flying items on pawns).
function elCenter(el) { const r = el.getBoundingClientRect(), s = $("stage").getBoundingClientRect(); return [(r.x + r.width / 2 - s.left) * 1920 / s.width, (r.y + r.height / 2 - s.top) * 1080 / s.height]; }
// flyItem(type, from, to, mode): animate a copy of an item picture from one stage position to another. mode "toss" = a spinning arc (stone, stick, drink),
// "slide" = a flat glide (toy brick). Resolves when it lands (with the landing "tock" sound).
function flyItem(type, from, to, mode, isRemote) {
  if (NET.active && NET.isHost && !isRemote) {
    broadcast({ type: "FLY_ITEM", itemType: type, from, to, mode });
  }
  const f = itemFit(type, 56, 56), el = document.createElement("img"), toss = mode === "toss", dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
  el.src = A(ITEMS[type].file); el.className = "fly"; el.style.width = f.w + "px"; el.style.height = f.h + "px";
  $("fly").appendChild(el);
  const at = (p, rot, sc) => `translate(${f1(p[0] - f.w / 2)}px,${f1(p[1] - f.h / 2)}px) rotate(${rot}deg) scale(${sc})`;
  const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2 - (toss ? Math.min(200, 70 + dist * .25) : 0)];   // the top of the arc
  const spin = toss ? (type === "stick" ? 720 : 540) : 0;
  const anim = el.animate([{ transform: at(from, 0, 1) }, { transform: at(mid, spin / 2, toss ? 1.3 : 1.05), offset: .5 }, { transform: at(to, spin, toss ? 1 : .95) }],
    { duration: toss ? 750 : 650, easing: toss ? "ease-in-out" : "cubic-bezier(.45,.05,.4,1)", fill: "forwards" });
  sfx("small");
  return anim.finished.catch(() => {}).then(() => { el.remove(); sfx("tock"); });
}

// ------------------------------------------------------------------ 3. THE DICE
// The dice are real 3D cubes (six faces from dice_no_1..6.svg). Waiting dice spin slowly so you can see their different sides.
// A throw is PRE-CALCULATED: the game first simulates the whole roll (movement, wall bounces, dice bumping each other, tumbling) and decides
// the result, then adjusts the tumbling so the cube arrives exactly on the result as it stops - no snapping at the end.
// The roll is then played back over ROLL_MS milliseconds (config.js), matching the dice sound.
// DICE = state of the dice on the rolling board.
//   list: the dice { el, cube, x, y, vx, vy, rx, ry, mode, val }   (rx/ry = rotation angles in degrees; mode = "idle" | "held" | "fly" | "rest")
//   waiting: true while the game waits for a throw   flying: true while a roll is playing   done: function that finishes the roll
//   play: the roll being played back { t0: start time, frames: simulated positions/angles per die, vals: results }
const DICE = { list: [], waiting: false, flying: false, canInteract: false, done: null, loop: false, play: null, slideTimer: null };
let DD = null;   // DD = the die being held by the mouse: { i, samples:[{t,x,y}] }
// FACE_ANGLES[v] = the [rx, ry] rotation that turns face v towards the player (opposite faces add up to 7).
const FACE_ANGLES = { 1: [0, 0], 2: [-90, 0], 3: [0, -90], 4: [0, 90], 5: [90, 0], 6: [0, 180] };

// trayPt(e): mouse position relative to the top-left of the rolling board.
function trayPt(e) { const [x, y] = stagePt(e); return [x - TRAY.x, y - TRAY.y]; }
// dieClamp(d): keep a die fully inside the rolling board.
function dieClamp(d) {
  const h = DICE_SIZE / 2;
  d.x = cl(d.x, DICE_AREA.x1 + h, DICE_AREA.x2 - h); d.y = cl(d.y, DICE_AREA.y1 + h, DICE_AREA.y2 - h);
}
// dieDraw(d): move the die to its position and turn its cube to its current angles.
function dieDraw(d) {
  d.el.style.transform = `translate(${f1(d.x - DICE_SIZE / 2)}px,${f1(d.y - DICE_SIZE / 2)}px)`;
  d.cube.style.transform = `rotateX(${f1(d.rx)}deg) rotateY(${f1(d.ry)}deg)`;
}

// rollDice(n): put n dice at their waiting spot (slowly spinning) and wait for a throw or the ROLL button. Resolves with the list of results.
function rollDice(n) {
  const curIdx = G && G.cur ? G.players.indexOf(G.cur) : 0;
  const isMyTurn = !NET.active || !G || (curIdx === NET.myPlayerIndex);

  if (NET.active && NET.isHost) {
    // Notify guests that dice are waiting to be rolled
    broadcast({ type: "WAIT_ROLL", n, playerIndex: curIdx, prompt: $("ptxt") ? $("ptxt").textContent : "" });
  }

  return new Promise(res => {
    if (DICE.slideTimer) { clearTimeout(DICE.slideTimer); DICE.slideTimer = null; }
    DICE.play = null;
    DD = null;
    $("dice").innerHTML = "";
    DICE.list = [];
    for (let i = 0; i < n; i++) {
      const el = document.createElement("div"); el.className = "die"; el.dataset.i = i;
      el.style.pointerEvents = isMyTurn ? "auto" : "none";
      el.style.cursor = isMyTurn ? "grab" : "default";
      el.innerHTML = `<div class="cube">${[1, 2, 3, 4, 5, 6].map(v => `<img class="df df${v}" src="${A(`dice_no_${v}.svg`)}" alt="" draggable="false">`).join("")}</div>`;
      $("dice").appendChild(el);
      const d = { el, cube: el.firstChild, x: DICE_IDLE[i][0], y: DICE_IDLE[i][1], vx: 0, vy: 0, rx: rnd(0, 359), ry: rnd(0, 359), mode: "idle", val: 1 };
      dieDraw(d); DICE.list.push(d);
    }
    DICE.waiting = true; DICE.flying = false; DICE.canInteract = isMyTurn;

    if (isMyTurn) {
      $("rollBtn").classList.add("ready");   // the ROLL button appears only for the active player
    } else {
      $("rollBtn").classList.remove("ready");
      setPrompt(`Waiting for ${G && G.cur ? G.cur.name : 'player'} to roll...`);
    }

    DICE.done = res;
    if (!DICE.loop) { DICE.loop = true; requestAnimationFrame(diceTick); }
  });
}

// stepDice(list, dt): advance a list of dice by dt milliseconds of physics: move, bounce off the walls, slow down (friction), tumble, bump each other.
// Works on any list of { x, y, vx, vy, rx, ry, mode }, so it can run on the real dice or on the pre-calculation copy. Returns true while something still moves.
function stepDice(list, dt) {
  let moving = false;
  list.forEach(d => {
    if (d.mode !== "fly") return;
    if (Math.hypot(d.vx, d.vy) < .04) { d.mode = "rest"; return; }   // slow enough: this die has stopped
    moving = true;
    d.x += d.vx * dt; d.y += d.vy * dt;
    const h = DICE_SIZE / 2;                                          // bounce off the four walls of the rolling board
    if (d.x < DICE_AREA.x1 + h) { d.x = DICE_AREA.x1 + h; d.vx = Math.abs(d.vx) * .8; }
    if (d.x > DICE_AREA.x2 - h) { d.x = DICE_AREA.x2 - h; d.vx = -Math.abs(d.vx) * .8; }
    if (d.y < DICE_AREA.y1 + h) { d.y = DICE_AREA.y1 + h; d.vy = Math.abs(d.vy) * .8; }
    if (d.y > DICE_AREA.y2 - h) { d.y = DICE_AREA.y2 - h; d.vy = -Math.abs(d.vy) * .8; }
    const f = Math.pow(.9965, dt); d.vx *= f; d.vy *= f;              // friction: the die slows down
    d.ry += d.vx * dt * .9; d.rx -= d.vy * dt * .9;                   // the cube rolls in the direction it travels
  });
  separateDice(list);                                                  // dice can never overlap: they bounce off each other
  return moving;
}

// diceTick(): runs every frame. Waiting/held dice spin slowly in place; during a roll it plays back the pre-calculated frames.
// IMPORTANT: the next frame is requested FIRST and the work is wrapped in try/catch, so even if something goes wrong once, this loop can never die
// (a dead loop would leave a roll unfinished and freeze the game).
let diceLast = 0;
function diceTick(now) {
  requestAnimationFrame(diceTick);
  try {
    const dt = Math.min(32, Math.max(0, now - (diceLast || now))); diceLast = now;
    DICE.list.forEach(d => { if (d.mode === "idle" || d.mode === "held") { d.rx += .1 * dt; d.ry += .15 * dt; } });
    separateDice(DICE.list);                                             // also keeps a held die from being dragged onto the other one
    const P = DICE.play;
    if (P) {                                                             // a roll is being played back
      // k = how far through the roll we are (0..1). It is clamped at 0 because the browser's frame time can be a hair EARLIER than the moment
      // the throw happened; a negative k used to crash this loop and freeze the game.
      const k = Math.min(1, Math.max(0, (performance.now() - P.t0) / ROLL_MS)), f = P.frames[Math.min(P.frames.length - 1, Math.floor(k * (P.frames.length - 1)))];
      DICE.list.forEach((d, i) => { d.x = f[i].x; d.y = f[i].y; d.rx = f[i].rx; d.ry = f[i].ry; });
      if (k >= 1) {                                                      // roll finished: the dice rest on their results
        DICE.play = null; DICE.flying = false; DICE.list.forEach(d => d.mode = "rest");
        DICE.slideTimer = setTimeout(() => {
          DICE.slideTimer = null;
          slideDiceToCenter();
          if (DICE.done) {
            const cb = DICE.done;
            DICE.done = null;
            cb(P.vals);
          }
        }, 300);   // a small pause, then the dice slide to the middle of the board (the buttons live at the bottom)
      }
    }
    DICE.list.forEach(dieDraw);
  } catch (err) { console.error("Dice loop error:", err); }
}

// slideDiceToCenter(): after a roll, glide the resting dice to the middle of the rolling board so the result stays in plain view
// while the "Move for me" button sits at the bottom. DICE_GAP apart if there are two dice.
function slideDiceToCenter() {
  const n = DICE.list.length, cx = (DICE_AREA.x1 + DICE_AREA.x2) / 2, cy = 235;
  DICE.list.forEach((d, i) => { d.x = cx + (i - (n - 1) / 2) * DICE_GAP; d.y = cy; d.el.style.transition = "transform .55s cubic-bezier(.4, 0, .2, 1)"; });
}

// separateDice(list): keep every pair of dice at least DICE_GAP apart. Two flying dice bounce off each other; a flying die bounces off a resting
// or held one; if there is no other way (e.g. squeezed against a wall) the other die is nudged away.
function separateDice(L) {
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j];
      let dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy);
      if (dist >= DICE_GAP) continue;
      if (dist < 1) { dx = 1; dy = 0; dist = 1; }
      const nx = dx / dist, ny = dy / dist, ov = DICE_GAP - dist;                       // n = direction from a to b, ov = how much they overlap
      const mv = d => d.mode === "held" ? 0 : d.mode === "rest" ? .25 : 1;                 // how easily each die is pushed (held = not at all)
      const ma = mv(a), mb = mv(b), tot = (ma + mb) || 1;
      a.x -= nx * ov * ma / tot; a.y -= ny * ov * ma / tot; b.x += nx * ov * mb / tot; b.y += ny * ov * mb / tot;   // push apart
      if (pass === 0) {                                                                  // bounce (only once per step)
        const va = a.vx * nx + a.vy * ny, vb = b.vx * nx + b.vy * ny;                   // speeds along the line between the dice
        if (a.mode === "fly" && b.mode === "fly") { if (va - vb > 0) { const d = (va - vb) * .9; a.vx -= d * nx; a.vy -= d * ny; b.vx += d * nx; b.vy += d * ny; } }
        else if (a.mode === "fly" && va > 0) { a.vx -= 1.8 * va * nx; a.vy -= 1.8 * va * ny; }
        else if (b.mode === "fly" && vb < 0) { b.vx -= 1.8 * vb * nx; b.vy -= 1.8 * vb * ny; }
      }
      dieClamp(a); dieClamp(b);
      const d2 = Math.hypot(b.x - a.x, b.y - a.y);                                       // still overlapping because of a wall? shove the other die along
      if (d2 < DICE_GAP - .5) { const k = DICE_GAP - d2; b.x += nx * k; b.y += ny * k; dieClamp(b); if (Math.hypot(b.x - a.x, b.y - a.y) < DICE_GAP - .5) { a.x -= nx * k; a.y -= ny * k; dieClamp(a); } }
    }
  }
}

// rollPressed(): the ROLL button (or Space bar) -> throw with a random direction and strength.
function rollPressed() {
  if (!DICE.waiting || DICE.flying || !DICE.canInteract) return;
  const a = Math.random() * 6.283, sp = .85 + Math.random() * .6;
  launch(Math.cos(a) * sp, Math.sin(a) * sp);
}
// A die is grabbed: start recording the mouse path so the throw direction/speed can be measured on release.
function dieDown(i, e) {
  if (!DICE.canInteract) return;
  const [x, y] = trayPt(e);
  DD = { i, samples: [{ t: performance.now(), x, y }] };
  DICE.list[i].mode = "held";
  dieMove(e);
}
function dieMove(e) {
  const [x, y] = trayPt(e), d = DICE.list[DD.i];
  d.x = x; d.y = y; dieClamp(d);
  DD.samples.push({ t: performance.now(), x, y });
  if (DD.samples.length > 8) DD.samples.shift();
}
// Die released: speed and direction = how the mouse moved over the last ~100ms. A weak flick still rolls (with a default push).
function dieUp(e) {
  const s = DD.samples, a = s[0], b = s[s.length - 1], dt = Math.max(1, b.t - a.t);
  let vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt, sp = Math.hypot(vx, vy);
  DD = null;
  if (sp < .25) { const ang = Math.random() * 6.283; vx = Math.cos(ang); vy = Math.sin(ang); sp = 1; }   // barely moved: gentle random roll
  const k = cl(sp, .8, 2.2) / sp;                                                                       // keep the throw within sensible speeds
  launch(vx * k, vy * k);
}

// launch(vx,vy): start a roll. Speeds are in pixels per millisecond. Decides the results, pre-calculates the whole roll, starts the sound and the playback.
function launch(vx, vy, forceVals) {
  DICE.waiting = false; DICE.flying = true; DICE.canInteract = false;
  DICE.list.forEach(d => { d.el.style.pointerEvents = "none"; d.el.style.cursor = "default"; });
  $("rollBtn").classList.remove("ready");                      // the ROLL button disappears until the next roll
  const base = Math.atan2(vy, vx), sp = Math.hypot(vx, vy);
  const vals = forceVals || DICE.list.map(() => d6());   // vals = the results

  if (NET.active && !forceVals) {
    sendAction({ type: "ROLL_LAUNCH", vx, vy, vals });
  }
  // sim = a copy of the dice that we run the physics on ahead of time
  const sim = DICE.list.map((d, j) => {
    const a = base + (j ? (j % 2 ? .45 : -.45) : 0), s = sp * (1 - .12 * j);   // extra dice fly off at slightly different angles
    return { x: d.x, y: d.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, rx: d.rx, ry: d.ry, mode: "fly" };
  });
  const frames = [sim.map(d => ({ x: d.x, y: d.y, rx: d.rx, ry: d.ry }))];
  for (let n = 0; n < 900; n++) {                              // run the physics (16.7ms per step) until every die has stopped
    const moving = stepDice(sim, 16.7);
    frames.push(sim.map(d => ({ x: d.x, y: d.y, rx: d.rx, ry: d.ry })));
    if (!moving && sim.every(d => d.mode === "rest")) break;
  }
  // make each cube end exactly on its result: work out how far its final tumble angles are from the result's angles, and spread that
  // correction over the whole roll in step with how much it has rotated so far - so it never snaps at the end
  sim.forEach((d, i) => {
    const [X, Y] = FACE_ANGLES[vals[i]], last = frames[frames.length - 1][i];
    const tx = Math.round((last.rx - X) / 360) * 360 + X, ty = Math.round((last.ry - Y) / 360) * 360 + Y, dx = tx - last.rx, dy = ty - last.ry;
    const cum = [0];
    for (let n = 1; n < frames.length; n++) cum.push(cum[n - 1] + Math.abs(frames[n][i].rx - frames[n - 1][i].rx) + Math.abs(frames[n][i].ry - frames[n - 1][i].ry));
    frames.forEach((f, n) => { const q = cum[cum.length - 1] > 1 ? cum[n] / cum[cum.length - 1] : n / (frames.length - 1); f[i].rx += dx * q; f[i].ry += dy * q; });
  });
  DICE.list.forEach(d => { d.mode = "fly"; d.cube.style.transition = "none"; });
  DICE.play = { t0: performance.now(), frames, vals };
  sfx("dice");                                                 // the rattle starts at the very moment the dice are thrown
}
