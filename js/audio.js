// =====================================================================================
//  audio.js  -  sound effects. sfx("name") plays one of the sounds listed in SOUNDS (config.js).
//  Sounds are decoded once into memory and played with the Web Audio API so they start the instant they are asked for.
//  Browsers keep audio silent until the player's first click/key press - unlockAudio() handles that.
// =====================================================================================

// VOLUME = sound-effects volume as a step from 0 (mute) to 10 (full). Set from the Settings tab (setVolume in main.js); remembered between visits when the browser allows it.
let VOLUME = 7;
try { const v = parseInt(localStorage.getItem("snc_volume"), 10); if (v >= 0 && v <= 10) VOLUME = v; } catch (e) { /* storage not available: keep the default */ }
let ACTX = null;     // ACTX = the browser's audio engine (created on load; "suspended" until the first click or key press)
const BUF = {};      // BUF[name] = the decoded sound (filled by loadSounds)

// loadSounds(): read every file listed in SOUNDS and decode it. Called once from main.js at start-up.
async function loadSounds() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;                                     // very old browser: the game simply stays silent
  ACTX = new AC();
  for (const [name, s] of Object.entries(SOUNDS)) {
    try {
      let bytes;
      if (window.EMBED && EMBED[s.file]) {             // single-file build: the sound is stored inside the page as base64 text
        const bin = atob(EMBED[s.file].split(",")[1]); bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        bytes = bytes.buffer;
      } else bytes = await (await fetch("assets/" + s.file)).arrayBuffer();   // normal folder: read the mp3 file
      BUF[name] = await ACTX.decodeAudioData(bytes);
    } catch (e) { console.warn("Could not load sound", name, e); }
  }
}
// unlockAudio(): wake the audio engine. Browsers only allow sound after the player has interacted, so this runs on the first click / key press.
function unlockAudio() { if (ACTX && ACTX.state === "suspended") ACTX.resume(); }
addEventListener("pointerdown", unlockAudio, { capture: true });
addEventListener("keydown", unlockAudio, { capture: true });

// sfx(name, delayMs): play a sound. delayMs = wait this long first (used to line a sound up with an animation).
// Each file starts with a little silence; SOUNDS[name].skip cuts it off so the sound hits exactly when sfx() is called.
function sfx(name, delayMs) {
  const buf = BUF[name], s = SOUNDS[name];
  if (!ACTX || !buf) return;
  const src = ACTX.createBufferSource(), gain = ACTX.createGain();
  src.buffer = buf; gain.gain.value = (s.volume || 1) * VOLUME / 10;   // master volume from the Settings tab
  src.connect(gain); gain.connect(ACTX.destination);
  src.start(ACTX.currentTime + (delayMs || 0) / 1000, s.skip || 0);
}

// ---- button sounds: ONE listener plays the right sound for every kind of button (so new buttons only need the right CSS class) ----
// pointerdown (not click) so the sound is instant. See SOUNDS in config.js for which file is which.
addEventListener("pointerdown", e => {
  const t = e.target.closest ? e.target.closest("button") : null;
  if (!t || t.disabled) return;
  if (t.classList.contains("go")) sfx("big");                                // Start game
  else if (t.closest("#btns")) sfx("press");                                 // choice buttons in the board log (numbers, Push/Pull...)
  else sfx("small");                                                         // everything else: tabs, expand, close, ROLL, Move for me, class buttons
});
