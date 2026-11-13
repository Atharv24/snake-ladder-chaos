// =====================================================================================
//  config.js  -  THE FILE TO EDIT FOR SMALL CHANGES
//  Rules numbers, class descriptions, colours and screen positions all live here.
//  (Every .js file is loaded by index.html in this order: config, board, art, render, input, rules, main.)
// =====================================================================================

// ---- Game settings you can change ----
const CONFIG = {
  LADDERS: 9,         // how many ladders each board gets
  SNAKES: 9,          // how many snakes each board gets (at most 1 more than the number of ordinary snake heads in manifest.json: the cobra + one head each)
  MIN_PLAYERS: 2,     // fewest players allowed on the setup screen
  MAX_PLAYERS: 6,     // most players allowed (the layout has room for 6 panels)
  STEP_MS: 350        // pause (milliseconds) after every piece movement so you can follow what happened
};

// ---- Sounds. file = path inside assets/. skip = seconds of leading silence to cut so the sound lands exactly on the action.
//   volume = 0..1 (optional). Change which sound a name uses by editing "file" here; the events that use each name are in audio.js / rules.js / input.js.
const SOUNDS = {
  small: { file: "sounds/button_sound_small.mp3",    skip: 0.028 },   // tabs, expand/close, ROLL, Move for me, picking up a pawn
  press: { file: "sounds/button_sound_medium_1.mp3", skip: 0.120 },   // the big choice buttons in the board log
  tock:  { file: "sounds/button_sound_medium_2.mp3", skip: 0.060 },   // a piece landing / being dropped on a square
  big:   { file: "sounds/button_sound_big.mp3",      skip: 0.045 },   // Start game, winning
  dice:  { file: "sounds/sound_dice_roll.mp3",       skip: 0.028 }    // the dice roll (its last bounce is at ~0.93s, so a roll lasts ROLL_MS = 930)
};
const ROLL_MS = 930;   // how long a dice roll animation lasts (milliseconds). Matches the dice sound so the dice stop with the last rattle.

const LIME = "#c3f73a";   // the bright lime used by the art (taken from tile_dark.svg). Used for the active-turn ring and tile highlights.

// ---- The six classes. "id" is used by the code, "name" is shown on screen, "text" is shown on the setup screen and in the Rulebook ----
const CLASSES = [
  { id: "bully",     name: "Bully",         text: "Land exactly on a player with your own roll: roll a die and push or pull them that many squares (choose before rolling). Pass over a player: nudge them 1 square forward or back. A 6 gives another turn." },
  { id: "gambler",   name: "Gambler",       text: "Rolls 2 dice and moves the total. A 1 on either die sends him back by the other die (double 1s: stay put). Only double 6s give another turn. Past 100 he bounces back; from 97-99 either die must show the exact number needed." },
  { id: "cat",       name: "The One with the Cat", text: "Goes last, then rolls for the cat, which wraps around the board and ignores snakes, ladders and items. Players the cat jumps over: -1 on their next roll. Players it lands on are knocked down 10 squares and give her +3 on her next roll each (an overshoot loses it)." },
  { id: "struggler", name: "Struggler",     text: "Every forced effect (snakes, pushes, the cat) gets a die roll: even dodges, odd hits. At a ladder, pick two failure numbers first: roll one of them and he does not climb. A 6 gives another turn." },
  { id: "oracle",    name: "Oracle",        text: "Calls a number from 1-6 before rolling. A right call adds a 3-sided bonus die to the move, and snakes cannot bite on that move. A wrong call costs nothing. A 6 gives another turn." },
  { id: "charmer",   name: "Snake Charmer", text: "Always goes first. Before rolling, may move the head of a snake on her row, or the row above or below, to another free square on that row, then must recharge for a turn. Players already on that square are safe. Never gets an extra turn, even on a 6." }
];

// Which portrait file belongs to which class (files live in assets/). These are also the pawns on the board.
const PORT = { bully: "head_bully", gambler: "head_gambler", cat: "head_catlady", struggler: "head_struggler", oracle: "head_oracle", charmer: "head_charmer" };

// Short info shown on the class pick panels (most important first). <b>..</b> highlights the key words. Full rules: CLASS_RULES in rulebook.js.
const CLASS_BRIEF = {
  bully: { tag: "Push, pull, nudge", pts: ["<b>Land on a player:</b> roll a die and push or pull them that many squares (choose before rolling).", "<b>Pass over a player:</b> nudge them 1 square forward or back.", "Works on your own roll, before snakes and ladders.", "A 6 gives another turn."] },
  gambler: { tag: "Two dice, big risks", pts: ["Rolls <b>2 dice</b> and moves the total.", "A <b>1</b> on either die sends you back by the other die. Double 1s: stay put.", "Extra turn only on <b>double 6s</b>.", "Past 100 you <b>bounce back</b>. From 97-99 either die must show the exact number."] },
  cat: { tag: "A cat on the loose", pts: ["Goes <b>last</b>, then rolls for the <b>cat</b>, which wraps around the board.", "Players the cat jumps over: <b>-1</b> on their next roll.", "A player it lands on is knocked down <b>10 squares</b>; you get <b>+3</b> on your next roll for each.", "The cat ignores snakes, ladders and items."] },
  struggler: { tag: "Dodges, mostly", pts: ["Anything forced (snakes, pushes, the cat): roll a die. <b>Even dodges</b>, odd hits.", "Ladders: pick <b>2 failure numbers</b>, then roll. Hit one and you do not climb.", "Items work normally.", "A 6 gives another turn."] },
  oracle: { tag: "Calls the roll", pts: ["<b>Call a number</b> (1-6) before rolling.", "Right call: add a <b>d3 bonus</b>, and snakes cannot bite on that move.", "A wrong call costs nothing.", "A 6 gives another turn."] },
  charmer: { tag: "Moves snake heads", pts: ["Always goes <b>first</b>.", "Before rolling, drag a <b>snake head</b> on your row (or one row above or below) to another free square, then recharge for a turn.", "Players already on that square are safe.", "<b>Never</b> gets an extra turn, even on a 6."] }
};

// Player colours (player 1 first). Each pawn gets a disc of its player's colour behind the face.
const COLORS = ["#d64545", "#3b82c4", "#e0a82e", "#8b5cc7", "#2f9e8f", "#e07a2e", "#c44a96", "#6b7280"];

// ---- Screen layout numbers (the screen is a fixed 1920x1080 canvas). The board sits in a red container on the blue background; the player panels (left) and tabs/log/dice (right) sit directly on the blue:
//      LEFT (player panels)  |  MIDDLE (the board)  |  RIGHT (tab buttons + board log + rolling board)  ----
const BOXES = [                                   // the red container drawn behind the board (container_red.svg, stretched). The left and right sections sit straight on the blue background.
  { id: "boxM", x: 412,  y: 10, w: 1050, h: 1060 }
];
const BOARD_BOX = { x: 412, y: 10, w: 1050, h: 1060 };   // the board SVG / canvases cover the whole middle container (stage coordinates)
const BX0 = 449;          // left edge of the first board column
const BY0 = 50;           // top edge of the first board row
const CX = 99;            // horizontal distance between the left edges of two neighbouring tiles
const CY = 99;            // vertical distance between the tops of two neighbouring tiles
const TW = 85;            // drawn width (and height of the top face) of one tile
const TK = TW / 115.17;   // scale factor from the tile SVG's own size to its drawn size
const BS = TW / 88.7;     // BS = "board scale": everything drawn on the board (snakes, pawns, numbers, items) is sized relative to this
// Player panels (left): panel art is 376.23 x 160.98. Slots/field/portrait are measured from the art (panel coordinates).
// The shadow under each panel (player_panel_shadow.svg, art size 394.74 x 173.45) is stretched to hang off the panel exactly like the Buff/Debuff counters' shadow does
// (counter_shadow.svg sits 2.4px left of its counter, 4.6px wider, and ends 9px below it): x = left offset, w/h = drawn size. The shadow never moves; on its turn the panel sinks 3px straight down onto it (.pp.cur in style.css).
const PANEL_SHADOW = { x: -2.4, w: 376.23 + 4.6, h: 160.98 + 9.04, artW: 394.74, artH: 173.45 };
const PANEL = { x: 12, y0: 30, pitch: 172, w: 376.23, h: 160.98,
  field: { x: 155.6, y: 12.3, w: 192.4, h: 33.5 },                       // the lime player-name box
  portrait: { cx: 73.6, cy: 74.8, size: 116 },                           // the halftone square for the face
  slots: [{ x: 161.2, y: 53.8, w: 47, h: 33.6 }, { x: 228.3, y: 54.3, w: 47, h: 33.6 }, { x: 295.4, y: 53.8, w: 47, h: 33.6 }] };   // the 3 item slots
// Rolling board (the dice tray) on the right: its position on screen and the area dice may roll in (relative to the tray's top-left)
const TRAY = { x: 1485, y: 540, w: 409, h: 515 };
const DICE_AREA = { x1: 28, y1: 30, x2: 381, y2: 485 };   // dice stay inside this rectangle
const DICE_GAP = 76;                                        // dice are never allowed closer than this (centre to centre), so they cannot overlap
const DICE_SIZE = 60;                                       // drawn size of a die (a 3D cube) in pixels
const DICE_IDLE = [[320, 352], [250, 352]];                // where waiting dice sit and spin (one or two dice), just above the ROLL button

// ---- Items (see the Items section of rules.js). file = art in assets/, w/h = art size (used to fit it in slots and on tiles) ----
const ITEMS = {
  stick: { name: "Stick",       file: "item_stick.svg",        w: 64.16, h: 74.04 },
  brick: { name: "Toy brick",   file: "item_toy_brick.svg",    w: 84.66, h: 61.72 },
  drink: { name: "Energy drink", file: "item_energy_drink.svg", w: 66.48, h: 81.67 },
  stone: { name: "Stone",       file: "item_stone.svg",        w: 77.28, h: 50.04 }
};
const ITEM_START = 6;        // how many items are lying on the board when a game starts
const ITEM_EVERY = 3;        // a new item appears every this-many turns
const ITEM_MAX = 3;          // most items a player can hold
const BROWN = "#2f2504";     // the dark brown used for outlines (ladder border)
const ITEM_BOARD_SCALE = { drink: 1.3, brick: 1.3 };   // items lying on the board are drawn this many times bigger than the default (others = 1)

// ---- Small helper functions used everywhere ----
const $ = id => document.getElementById(id);                         // $("log") = find the page element with id "log"
const d6 = () => 1 + Math.floor(Math.random() * 6);                  // roll one six-sided die (returns 1-6)
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));   // random whole number from a to b (both included)
const sleep = ms => new Promise(r => setTimeout(r, ms));             // wait for ms milliseconds (used as: await sleep(300))
const pick = arr => arr[Math.floor(Math.random() * arr.length)];     // choose one random item from a list (used for flavour text)
const f1 = v => v.toFixed(1);                                        // round a number to 1 decimal (keeps drawing code short)
const cl = (v, a, b) => Math.max(a, Math.min(b, v));                 // clamp: keep v between a and b
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));   // make player-typed names safe to show

// ---- The two big pieces of live data ----
var G = null;                                  // G = the running GAME (players, snakes, ladders, cat...). null until Start is pressed.
var S = { n: 2, rows: [], msg: "", pick: null, mode: "local", netState: "idle" };   // S = the SETUP screen state (mode: "local"|"online", netState: "idle"|"hosting"|"joining"|"lobby")

// ---- The board log (right side). log("text") adds one line; HTML like <b> is allowed ----
function log(t) {
  const l = $("log");
  if (l) { l.insertAdjacentHTML("beforeend", `<div>${t}</div>`); l.scrollTop = l.scrollHeight; }   // keep the newest line in view
  const big = $("biglog");        // if the log is open in the big pop-up, add the line there too
  if (big) { big.insertAdjacentHTML("beforeend", `<div>${t}</div>`); big.scrollTop = big.scrollHeight; }
  if (typeof NET !== "undefined" && NET.active && NET.isHost) {
    broadcast({ type: "LOG_LINE", html: t });
  }
}
