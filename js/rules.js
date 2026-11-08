// =====================================================================================
//  rules.js  -  the GAME RULES and the turn loop.
//  Each class has one function in LOGIC (near the bottom). To change how a class plays, edit its function.
//  Every function that has "async" in front of it can WAIT (for a player's drag, a die roll, or a short pause); they use "await" for that.
// =====================================================================================

// ------------------------------------------------------------------ FLAVOUR TEXT (what the board log says). Edit freely!
// Each entry is a function that picks one random sentence. p = player name, others as shown.
const FLAVOR = {
  turn:    p => pick([`${p} steps up to the board.`, `All eyes on ${p}.`, `${p} cracks their knuckles. Your move!`, `The dice are warm and ${p} is ready.`]),
  again:   p => pick([`${p} is on a roll and gets another turn!`, `A six! ${p} goes again.`, `The dice love ${p}. Another turn!`]),
  rolled:  (p, r) => pick([`${p} rolls a ${r}.`, `The die clatters to a stop: ${r} for ${p}.`, `${p} throws a ${r}.`, `It\u2019s a ${r}!`]),
  move:    (p, a, b) => pick([`${p} hops from ${a} to ${b}.`, `${p} marches on to square ${b}.`, `${p} makes it to ${b}.`]),
  stay:    p => pick([`${p} doesn\u2019t go anywhere.`, `${p} shuffles on the spot.`]),
  exact:   p => pick([`${p} overshoots: an exact roll is needed to finish. Staying put.`, `Too much! ${p} must land exactly on 100.`]),
  ladder:  (p, a, b) => pick([`${p} scrambles up the ladder from ${a} to ${b}!`, `A ladder! ${p} climbs ${a} to ${b} without breaking a sweat.`, `${p} takes the shortcut: ${a} to ${b}.`]),
  snake:   (p, a, b) => pick([`SSSSS! A snake swallows ${p}: ${a} down to ${b}.`, `${p} steps on a snake and slithers ${a} to ${b}.`, `Chomp! ${p} is devoured and spat out on ${b}.`]),
  win:     p => pick([`${p} reaches 100 and wins the game!`, `Square 100! ${p} is the champion!`]),
  spawn:   (it, sq) => pick([`A ${it} appears on square ${sq}!`, `Something glints on square ${sq}: a ${it}.`, `A ${it} drops onto square ${sq}.`]),
  pickup:  (p, it) => pick([`${p} grabs the ${it}.`, `${p} pockets a ${it}.`, `${p} finds a ${it} and snatches it up.`]),
  swap:    (p, a, b) => `${p} drops the ${a} and picks up the ${b} instead.`,
  trap:    p => pick([`${p} steps on a toy brick. Ouch! -3 on the next roll.`, `Ow! ${p} treads on a toy brick: -3 on the next roll.`]),
  drink:   p => pick([`${p} chugs an energy drink and puffs up with energy: +3 on this roll!`, `Glug glug! ${p} feels the buzz: +3 on this roll.`]),
  stone:   (p, v) => pick([`${p} hurls a stone at ${v}: thunk! -1 on their next roll.`, `${p} lobs a stone and hits ${v}. -1 on their next roll.`]),
  brick:   (p, sq) => pick([`${p} slides a toy brick onto square ${sq}. Watch your step!`, `${p} sets a toy brick trap on square ${sq}.`]),
  stick:   (p, a, b) => pick([`${p} prods the snake with a stick: its head shuffles from ${a} to ${b}.`, `Poke! ${p}'s stick nudges a snake head from ${a} to ${b}.`]),
  recharge: p => `${p}\u2019s snake-charming flute needs a moment to recharge.`,
  catRoll: (p, r) => pick([`${p}\u2019s cat pounces ${r} squares ahead.`, `The cat bolts ${r} squares!`, `Meow! The cat dashes ${r} squares.`])
};

// ------------------------------------------------------------------ BASIC MOVEMENT
// set(o, n): put a piece (a player or the cat) on square n, redraw, and pause briefly so it can be followed.
// quiet = true when the "tock" sound has already played (a drag and drop plays it at the instant of the drop).
// Otherwise the tock is timed to land when the pawn arrives (its slide takes ~0.3s; the sound has 60ms of silence trimmed off).
async function set(o, n, quiet) {
  if (!quiet) sfx("tock", 270);
  o.pos = n; render();
  syncGameState();
  await sleep(CONFIG.STEP_MS);
  if (o !== G.cat) await landOn(o);   // a player arriving on a square may pick up an item or trigger a toy-brick trap (the cat ignores items)
}

function syncGameState() {
  if (NET.active && NET.isHost && G) {
    broadcast({
      type: "STATE_SYNC",
      players: G.players.map(p => ({ pos: p.pos, cb: p.cb, pen: p.pen, items: p.items, big: p.big })),
      S: G.S,
      L: G.L,
      items: G.items,
      cat: G.cat,
      catNow: G.catNow,
      curIndex: G.cur ? G.players.indexOf(G.cur) : null,
      winnerIndex: G.winner ? G.players.indexOf(G.winner) : null
    });
  }
}
// win(p): mark player p as the winner.
function win(p) { sfx("big"); G.winner = p; log(`<b>${FLAVOR.win(p.name)}</b>`); syncGameState(); }

// selfMove(p, t): the player moves THEIR OWN pawn to square t. They drag the pawn onto the glowing square, or press "Move for me".
// (Used for the move a roll decides - never for snakes, ladders, pushes or the cat.)
async function selfMove(p, t) {
  if (t === p.pos) { log(FLAVOR.stay(p.name)); return; }   // the target is the square the pawn already stands on: nothing to drag (e.g. Gambler failing on square 1)
  const el = $("pw" + G.players.indexOf(p));
  const r = await awaitMove({ pieces: [{ key: "pawn", el, targets: [t] }], text: `${p.name}: drag your piece to square ${t}, or press Space.`, button: { label: "Move for me", value: 1 } });
  log(FLAVOR.move(p.name, p.pos, t));
  await set(p, t, r !== null);   // r !== null means it was dragged and dropped (sound already played)
}

// slide(p): if player p is standing on a ladder bottom or a snake head, take it. The Struggler rolls to resist first.
async function slide(p) {
  const n = p.pos, L = G.L[n], Sn = G.S[n];
  if (L) {
    if (p.cls === "struggler") {   // Struggler picks two "failure" numbers, then rolls: hitting one means no climb
      const nums = [1, 2, 3, 4, 5, 6].map(x => ({ label: String(x), value: x }));
      const f1_ = await ask(`${p.name}: pick your first failure number for this ladder`, nums, p);
      const f2_ = await ask(`${p.name}: pick a second failure number`, nums.filter(o => o.value !== f1_), p);
      const r = d6();
      log(`${p.name} bets against ${f1_} and ${f2_}, and rolls ${r}.`);
      if (r === f1_ || r === f2_) { log("A failure number! The ladder wobbles and " + p.name + " stays put."); return; }
    }
    log(FLAVOR.ladder(p.name, n, L)); await set(p, L);
  } else if (Sn) {
    if (p.cls === "struggler") {   // Struggler rolls: even = dodge the snake
      const r = d6(); log(`${p.name} rolls ${r} against the snake.`);
      if (r % 2 === 0) { log("Even! " + p.name + " wriggles out of the snake\u2019s jaws."); return; }
    }
    log(FLAVOR.snake(p.name, n, Sn)); await set(p, Sn);
  }
}
// go(p, t): normal move for a roll - drag to t, win if t is 100, otherwise take any snake/ladder.
async function go(p, t) {
  if (t > 100) { log(FLAVOR.exact(p.name)); return; }
  if (t === p.pos) { log(FLAVOR.stay(p.name)); return; }
  await selfMove(p, t);
  if (t === 100) return win(p);
  await slide(p);
}
// hit(v, np, why): another player's effect moves victim v to square np (pushed, pulled, nudged, knocked down...). The Struggler may dodge. Returns true if v moved.
async function hit(v, np, why) {
  if (np === v.pos) return false;
  if (v.cls === "struggler") {
    const r = d6(); log(`${v.name} rolls ${r} against being ${why}.`);
    if (r % 2 === 0) { log("Even! Dodged it neatly."); return false; }
    log("Odd. It lands.");
  }
  log(`${v.name} is ${why}: ${v.pos} to ${np}.`);
  await set(v, np);
  if (np === 100) { win(v); return true; }
  await slide(v);
  return true;
}
// rollBonus(p): read and clear player p's pending bonus (p.cb: energy drinks, cat knock-downs) and penalty (p.pen: cat charm, stones, toy bricks).
// Returns bonus - penalty, which is added to their roll (the move is never less than 0). These are the numbers on the Buff / Debuff counters.
function rollBonus(p) {
  const b = p.cb || 0, d = p.pen || 0; p.cb = 0; p.pen = 0;
  if (b) log(`${p.name} adds a +${b} bonus to this roll.`);
  if (d) log(`${p.name} suffers a -${d} penalty on this roll.`);
  return b - d;
}
// infatuate(v): the cat charms v (-1 on their next roll). The Struggler may resist.
async function infatuate(v) {
  if (v.cls === "struggler") { const r = d6(); log(`${v.name} rolls ${r} against the cat\u2019s charm.`); if (r % 2 === 0) { log("Even! Immune to cuteness."); return; } log("Odd. Those eyes are irresistible."); }
  v.pen = (v.pen || 0) + 1;
  log(`${v.name} is infatuated with the cat: -1 on their next roll.`);
}

// ------------------------------------------------------------------ ROLLING
// roll(p, label): prompt the player, wait for the dice throw (or ROLL button), return the number.
async function roll(p, label) {
  setPrompt(`${p.name}: ${label || "grab the die and throw it, or press ROLL / Space"}.`);
  const [r] = await rollDice(1);
  setPrompt(""); log(FLAVOR.rolled(p.name, r));
  return r;
}
// roll2(p): same with two dice (Gambler). Returns [a, b].
async function roll2(p) {
  setPrompt(`${p.name}: throw both dice, or press ROLL / Space.`);
  const v = await rollDice(2);
  setPrompt(""); log(`${p.name} throws ${v[0]} and ${v[1]}.`);
  return v;
}

// ------------------------------------------------------------------ CLASS LOGIC  (each returns true if the player gets another turn)
const LOGIC = {
  // Plain roll-and-move (also used by the Struggler): roll, subtract any cat penalty, move. A 6 gives another turn.
  async base(p) { const r = await roll(p), net = rollBonus(p); await go(p, p.pos + Math.max(0, r + net)); return r === 6; },

  // BULLY: only asks Push/Pull if someone is within 6 squares ahead (otherwise he cannot land on anyone).
  async bully(p) {
    const inRange = G.players.some(q => q !== p && q.pos > p.pos && q.pos <= p.pos + 6);
    let dir = null;
    if (inRange) dir = await ask(`${p.name}: Push or Pull?`, ["Push", "Pull"]);
    else log(`${p.name} looks around: nobody within reach. No one to bully this turn!`);
    const r = await roll(p), net = rollBonus(p), from = p.pos, t = from + Math.max(0, r + net);
    if (t > 100) { log(FLAVOR.exact(p.name)); return r === 6; }
    if (t === from) { log(FLAVOR.stay(p.name)); return r === 6; }
    await selfMove(p, t);
    if (t === 100) { win(p); return false; }
    // passing over players: nudge each one forward or back 1
    for (const q of G.players.filter(q => q !== p && q.pos > from && q.pos < t)) {
      const nd = await ask(`${p.name} passes over ${q.name}: nudge them forward or back 1?`, [{ label: "Forward", value: 1 }, { label: "Back", value: -1 }]);
      log(`${p.name} shoulders past ${q.name}, nudging them ${nd > 0 ? "forward" : "back"} 1.`);
      await hit(q, Math.max(1, q.pos + nd), "nudged");
    }
    // landing on someone: push or pull them with a fresh roll (only checked BEFORE any snake/ladder, so being swallowed to a tail never triggers it)
    const o = G.players.filter(q => q !== p && q.pos === t);
    if (o.length && dir) {
      let v = o[0];
      if (o.length > 1) {
        const vIdx = await ask("Choose your target", o.map(q => ({ label: q.name, value: G.players.indexOf(q) })));
        v = G.players[vIdx] || o[0];
      }
      const x = d6(); log(`${p.name} looms over ${v.name} and rolls ${x} to ${dir.toLowerCase()} them.`);
      const np = dir === "Push" ? v.pos + x : Math.max(1, v.pos - x);
      if (np > 100) log("Overpushed! " + v.name + " stays put."); else await hit(v, np, dir === "Push" ? "pushed" : "pulled");
    }
    if (!G.winner) await slide(p);
    return r === 6;
  },

  // GAMBLER: two dice. A 1 = go back by the other die; double 1s stay; double 6s = another turn; special finish on 97-99.
  async gambler(p) {
    const [a, b] = await roll2(p), again = a === 6 && b === 6, net = rollBonus(p), need = 100 - p.pos;
    if (need < 4 && (a === need || b === need)) { log(`${p.name} rolls the exact ${need} and finishes!`); await selfMove(p, 100); win(p); return false; }
    if (need < 4 && a !== 1 && b !== 1) { log("No exact number: the Gambler stays put."); return again; }
    if (a === 1 && b === 1) { log("Snake eyes! Double 1s: the Gambler stays put."); return false; }
    if (a === 1 || b === 1) { const x = a === 1 ? b : a; log(`A 1! The gamble backfires: back ${x}.`); await selfMove(p, Math.max(1, p.pos - x)); await slide(p); return false; }
    let t = p.pos + Math.max(0, a + b + net);
    if (t > 100) { t = 200 - t; log(`Overshoot! The Gambler bounces back to ${t}.`); }
    await selfMove(p, t);
    if (t === 100) win(p); else await slide(p);
    return again;
  },

  // ORACLE: calls a number first. Right call = bonus d3 added to the move, and snakes can't bite on that move.
  async oracle(p) {
    const call = await ask(`${p.name}: call the number you will roll`, [1, 2, 3, 4, 5, 6].map(n => ({ label: String(n), value: n })));
    const r = await roll(p), net = rollBonus(p);
    if (call !== r) { log(`${p.name} called ${call}: the vision was wrong. No bonus.`); await go(p, p.pos + Math.max(0, r + net)); return r === 6; }
    const b = rnd(1, 3), t = p.pos + Math.max(0, r + net) + b;
    log(`The vision was right! Bonus d3 shows ${b}: ${r + b} squares in total, and snakes can\u2019t bite this move.`);
    if (t > 100) { log(FLAVOR.exact(p.name)); return r === 6; }
    await selfMove(p, t);
    if (t === 100) { win(p); return false; }
    if (G.S[t]) log("The Oracle is immune to the snake!"); else await slide(p);
    return r === 6;
  }
};
LOGIC.struggler = LOGIC.base;   // the Struggler's special rules live inside slide(), hit() and infatuate()

// CAT OWNER: his own turn is a normal roll plus any +3 bonuses the cat earned him. (The cat itself moves in catTurn below.)
LOGIC.cat = async p => {
  const r = await roll(p), net = rollBonus(p);
  await go(p, p.pos + Math.max(0, r + net));
  return r === 6;
};

// charmerRange(p): the snake heads (squares) the Charmer may move: on his row or the rows directly above/below.
const charmerRange = p => Object.keys(G.S).map(Number).filter(h => Math.abs(Math.floor((h - 1) / 10) - Math.floor((p.pos - 1) / 10)) <= 1);
// headTargets(h): free squares on head h's row where it may be moved (must stay above its own tail, avoid snakes/ladders).
function headTargets(h) {
  const t = G.S[h], r0 = Math.floor((h - 1) / 10), used = new Set([...Object.keys(G.S), ...Object.values(G.S), ...Object.keys(G.L), ...Object.values(G.L)].map(Number)), out = [];
  for (let n = r0 * 10 + 1; n <= r0 * 10 + 10; n++) if (n !== h && n > t && n > 1 && n < 100 && !used.has(n)) out.push(n);
  return out;
}
// ghostSvg(h,x,y): picture of snake head h drawn at mouse position (x,y) while the Charmer drags it.
function ghostSvg(h, x, y) {
  const kd = ART.kinds[G.kind[G.S[h]] % ART.kinds.length], b = kd.head.box;
  return `<use href="#${kd.head.p}all" opacity=".9" transform="translate(${f1(x)} ${f1(y - 6)}) scale(${kd.sc * 1.1}) translate(${-(b.x + b.w / 2)} ${-(b.y + b.h / 2)})"/>`;
}
// CHARMER: before rolling, may drag one snake head in range to another square on its row (then waits a turn). Never gets extra turns.
LOGIC.charmer = async p => {
  if (p.cd) { p.cd = 0; log(FLAVOR.recharge(p.name)); }
  else {
    const near = charmerRange(p);
    if (!near.length) log("No snakes in range! Gotta move closer!");
    else {
      const movable = near.map(h => ({ h, targets: headTargets(h), ghost: (x, y) => ghostSvg(h, x, y) })).filter(o => o.targets.length);
      if (!movable.length) log("The snakes in range have nowhere to slither to. Time to roll!");
      else {
        const res = await awaitMove({ pieces: makeHandles(movable), text: `${p.name}: drag a glowing snake head to a new square on its row, or just roll (Space).`, button: { label: "Just roll", value: 1 } });
        $("gHandle").innerHTML = "";
        if (res) {
          const h = res.key, n = res.to, t = G.S[h];
          delete G.S[h]; G.S[n] = t; p.cd = 1;   // the snake keeps its tail; its head (and body) move
          log(`${p.name} plays a tune and the snake from ${h} slithers its head over to ${n}. The body follows!`);
          render(); syncGameState(); await sleep(CONFIG.STEP_MS);
        }
      }
    }
  }
  const r = await roll(p), net = rollBonus(p);
  await go(p, p.pos + Math.max(0, r + net));
  return false;
};

// ------------------------------------------------------------------ THE CAT'S TURN (after its owner's turn)
// catTurn(p): the cat moves by its own roll (it wraps around past 100), infatuates anyone it jumps over and knocks down anyone it lands on.
async function catTurn(p) {
  G.catNow = true; render();
  let again = true;
  while (again && !G.winner) {
    again = false;
    const r = await roll(p, "roll for the cat");
    log(FLAVOR.catRoll(p.name, r));
    const from = G.cat.pos, path = new Set();
    for (let i = 1; i < r; i++) { const x = from + i; path.add(x > 100 ? x - 100 : x); }   // squares jumped over
    let t = from + r; if (t === 100) t = 1; else if (t > 100) t -= 100;
    await set(G.cat, t); switchCat();                       // the cat moved: it changes picture
    again = r === 6;
    for (const v of G.players.filter(q => q !== p && q.pos !== t && path.has(q.pos))) await infatuate(v);
    let k = 0;
    for (const v of G.players.filter(q => q !== p && q.pos === t)) if (await hit(v, v.pos > 10 ? v.pos - 10 : 1, "knocked down by the cat")) k++;
    if (k) { p.cb = (p.cb || 0) + 3 * k; log(`${p.name} gains +${3 * k} on his next roll. Good kitty!`); }
  }
  G.catNow = false; render();
}

// ------------------------------------------------------------------ THE TURN LOOP
// resetInteraction(): after an error, clear everything a half-finished turn could leave behind (waiting dice, drags, buttons, highlights, prompts)
// so the next player starts from a clean screen.
function resetInteraction() {
  PEND = null; DRAG = null; DD = null; ITEMWAIT = null; TGT = null;     // no pending drag or item choice, nothing held
  document.querySelectorAll(".slot.usable").forEach(e => e.classList.remove("usable"));
  DICE.waiting = false; DICE.flying = false; DICE.canInteract = false; DICE.play = null; DICE.done = null;
  $("rollBtn").classList.remove("ready");
  $("moveBtn").style.display = "none"; $("moveBtn").onclick = null;
  $("gHandle").innerHTML = ""; $("gGhost").innerHTML = ""; setHL([]); setPrompt("");
  document.querySelectorAll(".grab, .drag").forEach(e => e.classList.remove("grab", "drag"));
  G.catNow = false; render();
}
// ERRORS = number of turns in a row that crashed. If it reaches 3 the game stops with a message instead of looping forever.
let ERRORS = 0;

// ------------------------------------------------------------------ ITEMS
// Items lie on squares (G.items) until a player steps on them. A player holds up to ITEM_MAX (3) in the slots of their panel (p.items = list of item types).
// Items are used BEFORE rolling (see itemPhase). They work on the Struggler too and never trigger his dodge ability. None of them affect the cat.
//   stick  - nudge any snake head 1 square sideways          brick - set a trap (-3 on the next roll of whoever steps on it, even you) in your row or the rows above/below
//   drink  - +3 on your next roll (and your pawn puffs up for the turn)          stone - hit another player: -1 on their next roll
// rowOf(sq): the board row of a square (0 = bottom row).
const rowOf = sq => Math.floor((sq - 1) / 10);
// itemAt(sq): the item (or trap) lying on a square, if any.
const itemAt = sq => G.items.find(i => i.sq === sq);
// spawnWeight(sq, initial): how likely a square is to get the next item. The 6 STARTING items (initial = true) have a tiny bias for the bottom half of
// the board; items that appear later have a tiny bias for squares near the player furthest from 100 (the one who is furthest behind).
function spawnWeight(sq, initial) {
  if (initial) return rowOf(sq) < 5 ? 1.25 : 1;
  const last = G.players.reduce((a, q) => q.pos < a.pos ? q : a, G.players[0]);        // the player furthest from 100
  return 1 + .6 * Math.max(0, 1 - Math.abs(sq - last.pos) / 30);
}
// spawnItem(quiet): put a random item on a random empty square (never 1 or 100, never under a pawn, the cat or another item, never on a snake head or the bottom of a ladder).
// quiet = true for the starting items (no log line each, and they use the bottom-half bias).
function spawnItem(quiet) {
  const free = [];
  for (let sq = 2; sq <= 99; sq++) if (!G.S[sq] && !G.L[sq] && !itemAt(sq) && !G.players.some(q => q.pos === sq) && !(G.cat && G.cat.pos === sq)) free.push(sq);
  if (!free.length) return;
  let r = Math.random() * free.reduce((a, sq) => a + spawnWeight(sq, quiet), 0), sq = free[free.length - 1];   // weighted random pick
  for (const f of free) { r -= spawnWeight(f, quiet); if (r <= 0) { sq = f; break; } }
  const type = pick(Object.keys(ITEMS));
  G.items.push({ type, sq });
  if (!quiet) log(FLAVOR.spawn(ITEMS[type].name, sq));
  render();
}
// landOn(p): called whenever player p arrives on a square. It runs BEFORE slide() takes a snake or ladder, so if an item shares a tile with a snake head (the Charmer or a stick can move a head onto one)
// the player picks the item up first and is bitten afterwards. A placed toy brick trips them (-3 on their next roll); a loose item is picked up
// (if their hands are full they may swap one of their items for it).
async function landOn(p) {
  const it = itemAt(p.pos);
  if (!it) return;
  if (it.trap) {                                                    // a toy-brick trap: it hurts whoever steps on it, including the player who placed it
    G.items.splice(G.items.indexOf(it), 1); p.pen = (p.pen || 0) + 3; log(FLAVOR.trap(p.name)); sfx("press"); render(); syncGameState(); return;
  }
  const name = ITEMS[it.type].name;
  if (p.items.length < ITEM_MAX) { G.items.splice(G.items.indexOf(it), 1); p.items.push(it.type); log(FLAVOR.pickup(p.name, name)); sfx("small"); render(); syncGameState(); return; }
  const c = await ask(`${p.name}: your hands are full. Swap one of your items for the ${name} on the ground?`, [...p.items.map((t, i) => ({ label: ITEMS[t].name, value: i })), { label: "Leave it", value: -1 }], p);
  if (c >= 0) { const mine = p.items[c]; p.items[c] = it.type; it.type = mine; log(FLAVOR.swap(p.name, ITEMS[mine].name, name)); sfx("small"); render(); syncGameState(); }
}
// itemPhase(p): before p rolls, let them use any of their items. Their items glow; click one to use it, or press Roll / Space to carry on.
async function itemPhase(p) {
  while (p.items.length && !G.winner) {
    const i = await awaitItemChoice(p, `${p.name}: click a glowing item to use it, or roll without (Space).`, "Roll");
    if (i === null) break;
    await useItem(p, i);
  }
}
// nudgeTargets(h): the squares a stick can push snake head h to: the free squares right next to it on its row.
const nudgeTargets = h => headTargets(h).filter(n => Math.abs(n - h) === 1);
// useItem(p, i): use the item in slot i of player p. The player picks the target first (and can Cancel); only then is the item spent and its animation played.
async function useItem(p, i) {
  const type = p.items[i], pi = G.players.indexOf(p), from = slotCenter(pi, i);
  if (type === "drink") {                                           // +3 for you; the can is tossed to your pawn
    p.items.splice(i, 1); render(); syncGameState();
    await flyItem("drink", from, elCenter($("pw" + pi)), "toss");
    p.cb = (p.cb || 0) + 3; p.big = true; log(FLAVOR.drink(p.name)); render(); syncGameState();
  } else if (type === "stone") {                                    // -1 for another player (never the cat)
    const others = G.players.filter(q => q !== p);
    if (!others.length) { log("There is nobody to throw the stone at."); return; }
    const sq = await awaitTarget({ targets: [...new Set(others.map(q => q.pos))], text: `${p.name}: click the player to hit with the stone.` });
    if (sq === null) return;
    let v = others.filter(q => q.pos === sq)[0];
    const here = others.filter(q => q.pos === sq);
    if (here.length > 1) {
      const vIdx = await ask("Who gets hit?", here.map(q => ({ label: q.name, value: G.players.indexOf(q) })));
      v = G.players[vIdx] || here[0];
    }
    p.items.splice(i, 1); render(); syncGameState();
    await flyItem("stone", from, xy(sq), "toss");
    v.pen = (v.pen || 0) + 1; log(FLAVOR.stone(p.name, v.name)); render(); syncGameState();
  } else if (type === "brick") {                                    // a trap in your row or the rows above/below
    const targets = [], row = rowOf(p.pos);
    for (let r = Math.max(0, row - 1); r <= Math.min(9, row + 1); r++) for (let c = 0; c < 10; c++) {
      const sq = toN(r, c);
      if (sq !== 100 && !itemAt(sq) && !G.players.some(q => q.pos === sq) && !(G.cat && G.cat.pos === sq)) targets.push(sq);
    }
    if (!targets.length) { log("There is no free square to put the brick on."); return; }
    const sq = await awaitTarget({ targets, text: `${p.name}: click a square (your row, or the row above/below) for the toy brick.` });
    if (sq === null) return;
    p.items.splice(i, 1); render(); syncGameState();
    await flyItem("brick", from, xy(sq), "slide");
    G.items.push({ type: "brick", sq, trap: true }); log(FLAVOR.brick(p.name, sq)); render(); syncGameState();
  } else if (type === "stick") {                                    // nudge any snake head 1 square
    const movable = Object.keys(G.S).map(Number).map(h => ({ h, targets: nudgeTargets(h), ghost: (x, y) => ghostSvg(h, x, y) })).filter(o => o.targets.length);
    if (!movable.length) { log("No snake head has room to be nudged right now."); return; }
    const res = await awaitMove({ pieces: makeHandles(movable), text: `${p.name}: drag a glowing snake head 1 square sideways with the stick.`, button: { label: "Cancel", value: 1 } });
    $("gHandle").innerHTML = "";
    if (!res) return;
    p.items.splice(i, 1); render(); syncGameState();
    await flyItem("stick", from, xy(res.key), "toss");
    const h = res.key, n = res.to, t = G.S[h];
    delete G.S[h]; G.S[n] = t; log(FLAVOR.stick(p.name, h, n)); render(); syncGameState(); await sleep(CONFIG.STEP_MS);
  }
}

// play(): runs the whole game: Charmer first, Cat owner last, everyone else in setup order. Repeats until someone wins.
// Every turn: (1) every 3rd turn of the game a new item appears, (2) the player may use items, (3) the class's own turn.
// Each player's turn is wrapped in try/catch: if the rules code hits an error the game shows a message in the board log, cleans up and moves on
// to the next player instead of silently freezing.
async function play() {
  const rk = p => p.cls === "charmer" ? -1 : p.cls === "cat" ? 1 : 0;   // turn order rank
  G.order = [...G.players].sort((a, b) => rk(a) - rk(b));
  while (!G.winner) {
    for (const p of G.order) {
      if (G.winner) break;
      try {
        G.turnNo = (G.turnNo || 0) + 1;
        if (G.turnNo % ITEM_EVERY === 0) spawnItem();                 // a new item appears every ITEM_EVERY turns
        let again = true;
        while (again && !G.winner) {
          G.cur = p; render();
          syncGameState();
          log(`<b>\u2014 ${FLAVOR.turn(esc(p.name))} \u2014</b>`);
          await itemPhase(p);                                          // items are used before rolling
          again = await (LOGIC[p.cls] || LOGIC.base)(p);          // run this class's turn
          if (again && !G.winner) log(FLAVOR.again(p.name));
        }
        if (p.cls === "cat" && !G.winner) await catTurn(p);
        p.big = false; render();                                      // an energy-drink boost lasts for the turn only
        ERRORS = 0;                                               // a turn finished normally
      } catch (err) {
        console.error("Turn crashed:", err);
        ERRORS++;
        resetInteraction();
        if (ERRORS >= 3) {                                        // repeated crashes: stop here and tell the player
          log(`<b>The game hit repeated errors (${esc(err.message || err)}). Please reload the page.</b>`);
          await choose("Something went wrong.", [{ label: "Reload", value: 1 }]);
          location.reload(); return;
        }
        log(`<b>Something went wrong during ${esc(p.name)}\u2019s turn (${esc(err.message || err)}). Moving on to the next player.</b>`);
        await sleep(800);
      }
    }
  }
  render();
  await choose(`${G.winner.name} wins!`, [{ label: "Play again", value: 1 }]);
  location.reload();
}
