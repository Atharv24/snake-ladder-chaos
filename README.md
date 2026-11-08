# Snakes, Ladders and Chaos!

A browser board game: Snakes and Ladders with six character classes that bend the rules.
Plain HTML, CSS and JavaScript - no frameworks, no build step.

## Run it

1. Install Python 3 (python.org).
2. In this folder run `python serve.py` - it opens http://localhost:8000.

(Opening `index.html` by double-click will not work: browsers block reading the `assets/` folder from a file.)

## Project layout

```
index.html          page structure (what elements exist and where scripts load)
css/
  style.css         all styling and screen positions
js/                 game code, loaded in this order by index.html
  config.js         settings, class descriptions, colours, layout numbers   <- start here for small changes
  board.js          square numbering and random snake/ladder generation
  art.js            loading the SVG art (assets/manifest.json)
  rulebook.js       the Rulebook tab text (RULES_HTML), built from config.js numbers
  render.js         drawing: snakes, ladders, tiles, pawns, player panels
  audio.js          sound effects: sfx("name") (which file is which: SOUNDS in config.js)
  input.js          prompts/buttons, drag and drop, the dice, Space bar
  rules.js          class rules, ITEMS, flavour text, the turn loop       <- edit class and item behaviour here
  main.js           start screen, tabs (log / rulebook / about), window scaling
assets/             all SVG art, the font, sounds/ (mp3 effects) and manifest.json
docs/mockup.jpg     the first design mockup
docs/mockup_v2.jpg  the mockup with the three containers and item slots
RULES.txt           the full rules: every class, items, bonus-roll rules
serve.py            tiny local web server
```

Every function and variable in the JS files has a comment saying what it does and where it is used.

## Common changes

| I want to...                         | Edit                                             |
|--------------------------------------|--------------------------------------------------|
| change number of snakes/ladders      | `CONFIG` in `js/config.js`                       |
| change a class description           | `CLASSES` in `js/config.js`                      |
| change item numbers (3 slots, start count, spawn every N turns) | `ITEM_*` in `js/config.js`      |
| change where the three containers / panels sit | `BOXES`, `BOARD_BOX`, `PANEL`, `BX0`.. in `js/config.js` |
| change what the board log says       | `FLAVOR` in `js/rules.js`                        |
| change how a class plays             | `LOGIC` in `js/rules.js`                         |
| change pawn / snake / number sizes   | `render.js` (`placePawns`, `SW`, `NUM_H`)        |
| change which sound plays            | `SOUNDS` in `js/config.js` (and `ROLL_MS` for the dice roll length) |
| swap or add art                      | put the SVG in `assets/`, list it in `assets/manifest.json` |

## Notes

- The game is drawn on a fixed 1920x1080 stage that is scaled to fit the window (`fit()` in `js/main.js`).
- Snake bodies and ladders use the art in `assets/`; a snake with no body picture falls back to a flat placeholder.
- Every snake gets its own head design (8 heads + the cobra = 9 snakes). If you raise `CONFIG.SNAKES`, add heads to `assets/manifest.json` first.
- The background is the flat blue with `assets/pattern.svg` (a square tile, 1 viewBox unit = 1 pixel) repeated over it. Replace that file with your design; no code change needed.
- `python tools/build_standalone.py` packs everything into one self-contained `dist/snakes-ladders-and-chaos.html` for quick sharing or previewing.
