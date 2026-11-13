// =====================================================================================
//  preload.js  -  starts loading the game's art, fonts and sounds the moment the page opens, and drives the little loading bar
//  (#tLoad, bottom-left of the title / play / local / host / join screens). New art files: add their names to PRELOAD_SVGS.
// =====================================================================================
const PRELOAD_SVGS = ["button_about_dark.svg", "button_about_light.svg", "button_back.svg", "button_boardlog_dark.svg", "button_boardlog_light.svg", "button_chat_dark.svg", "button_chat_light.svg", "button_home.svg", "button_playscreen_description.svg", "button_roll.svg", "button_roll_shadow.svg", "button_rulebook_dark.svg", "button_rulebook_light.svg", "button_settings_dark.svg", "button_settings_light.svg", "button_shadow.svg", "cat_1.svg", "cat_2.svg", "cat_3.svg", "cat_4.svg", "cat_5.svg", "cat_6.svg", "container_red.svg", "counter_buff.svg", "counter_debuff.svg", "counter_shadow.svg", "dice_no_1.svg", "dice_no_2.svg", "dice_no_3.svg", "dice_no_4.svg", "dice_no_5.svg", "dice_no_6.svg", "head_bully.svg", "head_catlady.svg", "head_charmer.svg", "head_gambler.svg", "head_oracle.svg", "head_struggler.svg", "item_energy_drink.svg", "item_stick.svg", "item_stone.svg", "item_toy_brick.svg", "ladder_slanted.svg", "ladder_straight.svg", "logo.svg", "no_0_B.svg", "no_1_B.svg", "no_2_B.svg", "no_3_B.svg", "no_4_B.svg", "no_5_B.svg", "no_6_B.svg", "no_7_B.svg", "no_8_B.svg", "no_9_B.svg", "panel_boardlog.svg", "panel_pick_dark.svg", "panel_pick_light.svg", "panel_rollingboard.svg", "pattern.svg", "player_panel_dark.svg", "player_panel_light.svg", "player_panel_shadow.svg", "screen_bg.svg", "snake_body_2.svg", "snake_body_3.svg", "snake_body_4.svg", "snake_body_5.svg", "snake_body_6.svg", "snake_body_7.svg", "snake_body_8.svg", "snake_body_9.svg", "snake_body_cobra.svg", "snake_head_2.svg", "snake_head_3.svg", "snake_head_4.svg", "snake_head_5.svg", "snake_head_6.svg", "snake_head_7.svg", "snake_head_8.svg", "snake_head_9.svg", "snake_head_cobra.svg", "tile_dark.svg", "tile_light.svg", "tile_shadow.svg"];
const PRELOAD_HOLD = [];   // keeps the decoded pictures in memory so they show instantly later
(function preload() {
  const total = PRELOAD_SVGS.length + 2 + 5; let done = 0;   // pictures + 2 fonts + 5 sounds
  const tick = () => {
    done++; const el = document.getElementById("tLoad"); if (!el) return;
    el.querySelector("i").style.width = Math.min(100, done / total * 100) + "%";
    if (done >= total && !el.classList.contains("done")) { el.classList.add("done"); setTimeout(() => el.classList.add("gone"), 1000); }   // the bar vanishes, "Assets loaded" shows for a second, then slides off the screen
  };
  PRELOAD_SVGS.forEach(f => {
    const im = new Image(); PRELOAD_HOLD.push(im);
    new Promise(res => { im.onload = res; im.onerror = res; im.src = A(f); }).then(() => im.decode ? im.decode().catch(() => {}) : 0).then(tick);
  });
  ["20px MC", "20px LM"].forEach(fnt => document.fonts.load(fnt).catch(() => {}).then(tick));
  let snd = 0; const hasAudio = window.AudioContext || window.webkitAudioContext;   // sounds are decoded by loadSounds() in audio.js; we just watch BUF
  const iv = setInterval(() => {
    const n = hasAudio ? Math.min(5, Object.keys(BUF).length) : 5;
    while (snd < n) { snd++; tick(); }
    if (snd >= 5) clearInterval(iv);
  }, 150);
  setTimeout(() => { done = total - 1; tick(); }, 30000);    // safety: never leave the bar hanging
})();
