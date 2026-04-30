/* game.js — engine, physics, rendering, and main loop for the cat platformer.
 *
 * The level is a 2D ASCII grid (see js/level.js). Each tile is TILE × TILE px.
 * The world is `LEVEL_WIDTH` tiles wide and `LEVEL_HEIGHT` tiles tall; the
 * canvas viewport is 800 × 480 (smaller than the world) and the camera scrolls
 * horizontally to follow the cat.
 *
 * Physics summary (numbers tuned for "feels responsive"):
 *
 *   GRAVITY        +0.5 px / frame²  (positive Y is down)
 *   FRICTION       0.85 horizontal velocity multiplier when no input
 *   MOVE_ACC       0.6  px / frame²  acceleration from L/R input
 *   MAX_RUN        3.6  px / frame   horizontal cap
 *   JUMP_VEL       10   px / frame   instantaneous upward speed on jump
 *   MAX_FALL       12   px / frame   terminal velocity
 *   COYOTE_TIME    0.10 s            grace window to jump after leaving a ledge
 *   JUMP_BUFFER    0.10 s            grace window to "remember" a jump press
 *   ASCEND_GRAV    GRAVITY × 0.55    while jump is held during ascent
 *
 * Collision is resolved per-axis: we move the player on X first and clip
 * against any solid tile in their AABB, then move on Y and clip again. This
 * avoids the classic "corner sticks" bug.
 */
(function () {
  'use strict';

  // ------ constants ----------------------------------------------------------
  const TILE = 32;
  const VIEW_W = 800;
  const VIEW_H = 480;

  const GRAVITY = 0.5;
  const ASCEND_GRAV = 0.275;       // softer gravity while ascending + jump held → variable height
  const APEX_GRAV   = 0.18;        // additional softening near jump apex (|vy| small) — gives a tiny "hang" the player can aim from
  const APEX_BAND   = 1.5;         // |vy| threshold (px/frame) for the apex-hang region
  const MOVE_ACC = 0.6;            // ground horizontal acceleration
  const AIR_ACC  = 0.36;           // air horizontal acceleration ≈ 60% of ground (mid-jump corrections shouldn't snap)
  const FRICTION = 0.85;
  const MAX_RUN  = 3.6;            // base max horizontal speed
  const SPRINT_RUN = 5.4;          // max horizontal speed while sprinting (Shift / RT held)
  const JUMP_VEL = 10;             // base jump impulse (small cat, walking)
  const SPRINT_JUMP_BONUS = 1.2;   // extra upward impulse when launching at full sprint — running jumps reach further
  const MAX_FALL = 12;
  const COYOTE_TIME = 0.10;
  const JUMP_BUFFER = 0.10;

  // Hitbox dims per power state. Sprites in sprites.js are baked at matching
  // sizes (small: 56×48, big: 72×64). When the cat eats cat food, we swap
  // both the sprite set and the hitbox.
  //   small   — default
  //   big     — ate cat food; absorbs one extra hit
  //   shooter — ate magic fish; can throw fishbones (X key); same dims as big
  const POWER = {
    small:   { w: 20, h: 22, spriteW: 56, spriteH: 48, sizeKey: 'small' },
    big:     { w: 22, h: 28, spriteW: 72, spriteH: 64, sizeKey: 'big' },
    shooter: { w: 22, h: 28, spriteW: 72, spriteH: 64, sizeKey: 'big' },
  };
  const SHOOT_COOLDOWN = 0.32;        // seconds between fishbones
  const FISHBONE_VX    = 5.0;
  const FISHBONE_GRAV  = 0.4;
  const FISHBONE_BOUNCE_VY = -5.0;

  // Down-pounce: the cat dive-bombs straight down. Faster fall than gravity
  // alone, no horizontal control, instant-kill on contact (incl. wasps).
  const POUND_VY        = 14;          // initial slam speed
  const POUND_BOUNCE_VY = -6.0;        // small bounce off the floor on landing
  const POUND_LOCKOUT   = 0.05;        // ignore down-press for a beat after landing
  // Brief window right after a jump where pounce is suppressed. Stops a
  // careless down-tap (or analog-stick overshoot on gamepad) from snapping
  // the player into a pounce + ground-thud the moment they leave the floor.
  const POUND_JUMP_GRACE = 0.12;       // seconds
  // Default sizes (small). Used by entity factories before the player powers up.
  const PLAYER_W = POWER.small.w;
  const PLAYER_H = POWER.small.h;

  // Which cat palette is selected. Persisted across sessions in localStorage.
  // Defaults to 'tabby'.
  const CAT_STORAGE_KEY = 'pounce_cat';
  let selectedCat = 'tabby';
  try {
    const saved = localStorage.getItem(CAT_STORAGE_KEY);
    if (saved && Sprites.cats[saved]) selectedCat = saved;
  } catch (e) { /* localStorage may be disabled — that's fine */ }
  function persistCat() {
    try { localStorage.setItem(CAT_STORAGE_KEY, selectedCat); } catch (e) {}
  }

  // Music on/off persists too. Default ON. Mapping is stored as a 0/1 string.
  const MUSIC_STORAGE_KEY = 'pounce_music';
  let musicEnabled = true;
  try {
    const saved = localStorage.getItem(MUSIC_STORAGE_KEY);
    if (saved === '0') musicEnabled = false;
  } catch (e) {}
  function persistMusicPref() {
    try { localStorage.setItem(MUSIC_STORAGE_KEY, musicEnabled ? '1' : '0'); } catch (e) {}
  }
  function syncMusicButton() {
    const btn = document.getElementById('music-toggle');
    if (!btn) return;
    // Icon-only — the on/off state is communicated via aria-pressed (CSS
    // strikes the icon when pressed=false). Keeps the bottom frame compact.
    btn.textContent = '♪';
    btn.setAttribute('aria-pressed', musicEnabled ? 'true' : 'false');
  }
  function toggleMusic() {
    musicEnabled = !musicEnabled;
    persistMusicPref();
    syncMusicButton();
    if (musicEnabled) {
      // Only resume the music if the run is actually in progress.
      if (game.mode === 'playing') tryStartMusic();
    } else {
      Audio.musicStop();
    }
  }
  // Wrapper used everywhere musicStart would otherwise be called directly.
  // Skips entirely if the player has muted the soundtrack.
  function tryStartMusic() {
    if (musicEnabled) Audio.musicStart();
  }

  // Sound-effects on/off — independent of music. Persists across sessions
  // under `pounce_sfx`; default ON. The actual gating happens in audio.js
  // (every SFX entry-point checks the flag); we just track the preference
  // here, sync the button, and forward the new value via setSfxEnabled.
  const SFX_STORAGE_KEY = 'pounce_sfx';
  let sfxEnabled = true;
  try {
    const saved = localStorage.getItem(SFX_STORAGE_KEY);
    if (saved === '0') sfxEnabled = false;
  } catch (e) {}
  function persistSfxPref() {
    try { localStorage.setItem(SFX_STORAGE_KEY, sfxEnabled ? '1' : '0'); } catch (e) {}
  }
  function syncSfxButton() {
    const btn = document.getElementById('sfx-toggle');
    if (!btn) return;
    btn.textContent = '◎';
    btn.setAttribute('aria-pressed', sfxEnabled ? 'true' : 'false');
  }
  function toggleSfx() {
    sfxEnabled = !sfxEnabled;
    persistSfxPref();
    syncSfxButton();
    Audio.setSfxEnabled(sfxEnabled);
  }
  // Apply the saved preference at boot so the gate matches the visual state.
  Audio.setSfxEnabled(sfxEnabled);

  // -------------------------------------------------------------------------
  //  MID-RUN SAVE STATE
  // -------------------------------------------------------------------------
  // Snapshot the active run to localStorage every couple of seconds. On a
  // fresh page load, the title screen offers RESUME instead of START if a
  // valid snapshot exists.
  //
  // Schema (`v: 1`):
  //   level / difficulty / selectedCat        — context the run was started in
  //   score / lives / collected / timer       — run progress
  //   levelTime / cameraX                     — camera + timer continuity
  //   player {x,y,vx,vy,power,w,h,facing,
  //           invuln, shootCooldown}          — actor state
  //   tiles (string[])                        — the MUTATED grid (Q→@ etc)
  //   items (0|1 flags)                       — which collectibles still alive
  //   enemies (0|1|2 flags)                   — alive | stomped | gone
  //   timestamp                               — for staleness checks
  // -------------------------------------------------------------------------
  const SNAPSHOT_KEY = 'pounce_snapshot';
  const SNAPSHOT_INTERVAL = 2.0;     // seconds between auto-saves
  const SNAPSHOT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
  let snapshotTimer = 0;

  function saveSnapshot() {
    if (game.mode !== 'playing') return;
    const p = game.player;
    if (!p) return;
    const snap = {
      // v: 2 — bumped when level widths expanded so stale v1 snapshots
      // from before the L1/L2/L3 expansion don't restore mismatched
      // tile arrays into the new world.
      v: 2,
      level: currentLevel,
      difficulty,
      selectedCat,
      score: game.score,
      lives: game.lives,
      collected: game.collected,
      timer: game.timer,
      levelTime: game.levelTime,
      cameraX: game.cameraX,
      tempoBoosted: !!game.tempoBoosted,
      player: {
        x: p.x, y: p.y, vx: p.vx, vy: p.vy,
        power: p.power, w: p.w, h: p.h,
        facing: p.facing, invuln: p.invuln,
        shootCooldown: p.shootCooldown,
      },
      tiles: tiles.map((r) => r.join('')),
      items:   game.items.map((i)   => i.alive ? 1 : 0),
      enemies: game.enemies.map((e) => !e.alive ? 0 : (e.stomped ? 2 : 1)),
      timestamp: Date.now(),
    };
    try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap)); } catch (e) {}
  }

  function clearSnapshot() {
    try { localStorage.removeItem(SNAPSHOT_KEY); } catch (e) {}
  }

  function loadSnapshot() {
    try {
      const raw = localStorage.getItem(SNAPSHOT_KEY);
      if (!raw) return null;
      const snap = JSON.parse(raw);
      if (!snap || snap.v !== 2) return null;
      // Stale or future-dated → ignore.
      if (typeof snap.timestamp === 'number') {
        const age = Date.now() - snap.timestamp;
        if (age < 0 || age > SNAPSHOT_MAX_AGE_MS) return null;
      }
      // Sanity-check the level the snapshot was for.
      if (typeof snap.level !== 'number' || snap.level < 0 || snap.level >= LEVEL_COUNT) {
        return null;
      }
      // Defensive: reject if the saved tile grid doesn't match the current
      // level's width. If a level got expanded between save and load we'd
      // otherwise restore a too-narrow tile array into the wider world.
      const expected = window.LEVELS && window.LEVELS[snap.level] &&
                       window.LEVELS[snap.level].width;
      if (
        Array.isArray(snap.tiles) && snap.tiles.length > 0 &&
        typeof expected === 'number' &&
        snap.tiles[0].length !== expected
      ) {
        return null;
      }
      return snap;
    } catch (e) { return null; }
  }

  function resumeFromSnapshot(snap) {
    currentLevel = snap.level;
    persistCurrentLevel();
    if (snap.difficulty && DIFFICULTY[snap.difficulty]) {
      difficulty = snap.difficulty;
    }
    if (snap.selectedCat && Sprites.cats[snap.selectedCat]) {
      selectedCat = snap.selectedCat;
    }
    // Spin the level up so we can overwrite onto fresh-loaded entity arrays.
    loadLevel();
    TIMER_START = diffCfg().timer;
    START_LIVES = diffCfg().lives;
    game.lives = snap.lives;
    game.score = snap.score;
    game.collected = snap.collected;
    game.timer = snap.timer;
    game.levelTime = snap.levelTime;
    game.cameraX = snap.cameraX || 0;
    game.tempoBoosted = !!snap.tempoBoosted;
    Object.assign(game.player, snap.player);
    if (Array.isArray(snap.tiles)) tiles = snap.tiles.map((r) => r.split(''));
    if (Array.isArray(snap.items)) {
      const n = Math.min(game.items.length, snap.items.length);
      for (let i = 0; i < n; i++) game.items[i].alive = !!snap.items[i];
    }
    if (Array.isArray(snap.enemies)) {
      const n = Math.min(game.enemies.length, snap.enemies.length);
      for (let i = 0; i < n; i++) {
        const s = snap.enemies[i];
        if (s === 0) game.enemies[i].alive = false;
        else if (s === 2) { game.enemies[i].alive = true; game.enemies[i].stomped = true; }
        else game.enemies[i].alive = true;
      }
    }
    game.mode = 'playing';
    Audio.musicTempo(game.tempoBoosted ? 1.4 : 1.0);
    tryStartMusic();
  }

  // Look for a stale-or-fresh snapshot once at boot; the title screen
  // uses this to switch the START prompt between "fresh run" and "resume".
  let pendingSnapshot = loadSnapshot();

  // ---- high-contrast mode (accessibility) ----
  // Boosts the canvas's contrast + saturation via a CSS filter so similar-
  // hued entities are easier to distinguish. Body class drives the filter;
  // localStorage persists the preference.
  const HC_STORAGE_KEY = 'pounce_high_contrast';
  let highContrast = false;
  try {
    if (localStorage.getItem(HC_STORAGE_KEY) === '1') highContrast = true;
  } catch (e) {}
  function syncHcButton() {
    const btn = document.getElementById('contrast-toggle');
    if (!btn) return;
    btn.textContent = '☀';
    btn.setAttribute('aria-pressed', highContrast ? 'true' : 'false');
  }
  function applyHc() {
    if (highContrast) document.body.classList.add('high-contrast');
    else              document.body.classList.remove('high-contrast');
  }
  function toggleHc() {
    highContrast = !highContrast;
    try { localStorage.setItem(HC_STORAGE_KEY, highContrast ? '1' : '0'); } catch (e) {}
    applyHc();
    syncHcButton();
  }
  applyHc();

  // ---- per-channel volume sliders ----
  const MUSIC_VOL_KEY = 'pounce_music_vol';
  const SFX_VOL_KEY   = 'pounce_sfx_vol';
  function loadVol(key) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return 1;
      const v = parseFloat(raw);
      return isNaN(v) ? 1 : Math.max(0, Math.min(1, v));
    } catch (e) { return 1; }
  }
  function saveVol(key, v) {
    try { localStorage.setItem(key, String(v)); } catch (e) {}
  }
  let musicVolume = loadVol(MUSIC_VOL_KEY);
  let sfxVolume   = loadVol(SFX_VOL_KEY);
  Audio.setMusicVolume(musicVolume);
  Audio.setSfxVolume(sfxVolume);

  // ---- game-speed multiplier ----
  // Scales the simulation's dt — everything that ticks (player physics,
  // enemy AI, gravity, the level timer, particles, animations) slows or
  // speeds up together. The audio engine is intentionally untouched so
  // music keeps its normal tempo; only gameplay timing changes.
  // Range: 0.5 (half-speed accessibility / lower-end machines) to 1.0
  // (default native speed). Default 1.0.
  const SPEED_KEY = 'pounce_game_speed';
  function loadSpeed() {
    try {
      const raw = localStorage.getItem(SPEED_KEY);
      if (raw == null) return 1;
      const v = parseFloat(raw);
      if (isNaN(v)) return 1;
      return Math.max(0.5, Math.min(1.0, v));
    } catch (e) { return 1; }
  }
  function saveSpeed(v) {
    try { localStorage.setItem(SPEED_KEY, String(v)); } catch (e) {}
  }
  let gameSpeed = loadSpeed();

  // -------------------------------------------------------------------------
  //  TOP-3 LEADERBOARD — global, Supabase-backed (cat-ski's pattern)
  // -------------------------------------------------------------------------
  // localStorage caches the most recent fetched board so the strip paints
  // instantly at boot. On boot and on each submit, we re-fetch the
  // authoritative top-3 from Supabase to merge in concurrent plays.
  //
  // The Supabase publishable (anon) key is intentionally shipped to the
  // browser — it's the public side of an RLS-protected table where anon
  // can SELECT and INSERT but nothing else. Cheating welcome; resets are
  // manual.
  //
  // To wire this up against your own table, create one in Supabase with:
  //   id          int8 (primary, identity)
  //   created_at  timestamptz default now()
  //   name        varchar
  //   score       int8
  // RLS on, with policies allowing anon SELECT and anon INSERT only.
  //
  const SUPABASE_URL    = 'https://pdjrvlhepiwkshxerkpz.supabase.co';
  const SUPABASE_KEY    = 'sb_publishable_NrfBsFhfj0DSKqDEKeUCMQ_H5oDG-Zv';
  const SCORES_TABLE    = 'pounce_scores';
  const LB_LIMIT        = 3;
  const LB_CACHE_KEY    = 'pounce_leaderboard_v1';
  const LB_LASTNAME_KEY = 'pounce_lb_last_name';

  function sanitizeBoard(arr) {
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(e => e && typeof e.name === 'string' && typeof e.score === 'number')
      .map(e => ({ name: e.name, score: e.score }))
      .slice(0, LB_LIMIT);
  }
  function loadLeaderboardCache() {
    try {
      const raw = localStorage.getItem(LB_CACHE_KEY);
      if (raw) return sanitizeBoard(JSON.parse(raw));
    } catch (_) {}
    return [];
  }
  function saveLeaderboardCache() {
    try { localStorage.setItem(LB_CACHE_KEY, JSON.stringify(leaderboard)); }
    catch (_) {}
  }
  let leaderboard = loadLeaderboardCache();

  const lbEl = document.getElementById('leaderboard');
  function renderLeaderboard() {
    if (!lbEl) return;
    lbEl.innerHTML = '';
    // Anchor: a small "TOP 3" badge so the strip reads as global high
    // scores at a glance instead of an unlabelled three-column grid.
    const label = document.createElement('span');
    label.className = 'lb-label';
    label.textContent = 'TOP 3';
    lbEl.appendChild(label);
    for (let i = 0; i < LB_LIMIT; i++) {
      const e = leaderboard[i];
      const row = document.createElement('span');
      row.className = 'lb-row' + (e ? '' : ' lb-empty');
      const r = document.createElement('span');
      r.className = 'lb-rank';
      r.textContent = (i + 1) + '.';
      const n = document.createElement('span');
      n.className = 'lb-name';
      n.textContent = e ? e.name : '---';
      const s = document.createElement('span');
      s.className = 'lb-score';
      s.textContent = e ? String(e.score) : '-----';
      row.appendChild(r); row.appendChild(n); row.appendChild(s);
      lbEl.appendChild(row);
    }
  }
  renderLeaderboard();

  async function fetchGlobalLeaderboard() {
    if (!SUPABASE_URL || !SUPABASE_KEY) return;
    const url = SUPABASE_URL + '/rest/v1/' + SCORES_TABLE +
                '?select=name,score&order=score.desc&limit=' + LB_LIMIT;
    try {
      const res = await fetch(url, {
        headers: {
          'apikey':        SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
        },
      });
      if (!res.ok) return;
      const rows = await res.json();
      leaderboard = sanitizeBoard(rows);
      saveLeaderboardCache();
      renderLeaderboard();
    } catch (_) {
      // Network down — keep the cached strip. No-op.
    }
  }

  async function submitGlobalScore(name, score) {
    if (!SUPABASE_URL || !SUPABASE_KEY) return;
    try {
      const res = await fetch(SUPABASE_URL + '/rest/v1/' + SCORES_TABLE, {
        method: 'POST',
        headers: {
          'apikey':        SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'Content-Type':  'application/json',
          'Prefer':        'return=minimal',
        },
        body: JSON.stringify({ name, score }),
      });
      if (!res.ok) return;
      fetchGlobalLeaderboard();
    } catch (_) {}
  }

  // Kick off the network refresh after the cached strip is on screen.
  fetchGlobalLeaderboard();

  function qualifiesForLeaderboard(score) {
    if (!isFinite(score) || score <= 0) return false;
    if (leaderboard.length < LB_LIMIT) return true;
    return score > leaderboard[leaderboard.length - 1].score;
  }

  function insertLeaderboardEntry(name, score) {
    const clean = String(name || '')
      .toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 5).trim() || 'CAT';
    leaderboard.push({ name: clean, score });
    leaderboard.sort((a, b) => b.score - a.score);
    leaderboard = leaderboard.slice(0, LB_LIMIT);
    saveLeaderboardCache();
    renderLeaderboard();
  }

  // ---- name-entry overlay wiring ----
  const lbEntry      = document.getElementById('lb-entry');
  const lbNameInput  = document.getElementById('lb-name-input');
  const lbSubmitBtn  = document.getElementById('lb-submit');
  let lbEntryActive  = false;

  function showLbEntry() {
    if (!lbEntry || !lbNameInput) return;
    lbEntryActive = true;
    lbEntry.classList.remove('hidden');
    let lastName = '';
    try { lastName = localStorage.getItem(LB_LASTNAME_KEY) || ''; } catch (_) {}
    lbNameInput.value = lastName;
    setTimeout(() => {
      try { lbNameInput.focus(); lbNameInput.select(); } catch (_) {}
    }, 50);
  }

  function submitLbEntry() {
    if (!lbEntryActive) return;
    const name = (lbNameInput && lbNameInput.value || '')
      .toUpperCase().slice(0, 5).trim();
    if (game.score > 0) {
      const finalName = name || 'CAT';
      insertLeaderboardEntry(finalName, game.score);
      try { localStorage.setItem(LB_LASTNAME_KEY, finalName); } catch (_) {}
      submitGlobalScore(finalName, game.score);
    }
    hideLbEntry();
  }

  function hideLbEntry() {
    lbEntryActive = false;
    if (lbEntry) lbEntry.classList.add('hidden');
    // Move focus off any element inside the entry block so the global
    // keydown handler picks up SPACE / R / ENTER for restart again.
    const active = document.activeElement;
    if (active && lbEntry && lbEntry.contains(active)) {
      try { active.blur(); } catch (_) {}
      try { canvas.focus(); } catch (_) {}
    }
  }

  if (lbSubmitBtn) {
    lbSubmitBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      submitLbEntry();
    });
  }
  if (lbNameInput) {
    lbNameInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        submitLbEntry();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        hideLbEntry();
      }
    });
    lbNameInput.addEventListener('input', () => {
      lbNameInput.value = lbNameInput.value.toUpperCase().slice(0, 5);
    });
  }

  // Difficulty preset table. Each entry overrides a handful of tunables —
  // lives, timer, enemy speed multiplier. The selected mode is read at
  // restart() time, so changing it on the title screen takes effect on the
  // next run.
  const DIFFICULTY = {
    easy:   { lives: 5, timer: 280, enemyMul: 0.75, label: 'EASY',   blurb: '5 lives · slow enemies · long timer' },
    normal: { lives: 3, timer: 200, enemyMul: 1.00, label: 'NORMAL', blurb: '3 lives · standard enemies' },
    hard:   { lives: 1, timer: 150, enemyMul: 1.30, label: 'HARD',   blurb: '1 life · fast enemies · short timer' },
  };
  const DIFFICULTY_ORDER = ['easy', 'normal', 'hard'];
  const DIFFICULTY_STORAGE_KEY = 'pounce_difficulty';
  let difficulty = 'normal';
  try {
    const saved = localStorage.getItem(DIFFICULTY_STORAGE_KEY);
    if (saved && DIFFICULTY[saved]) difficulty = saved;
  } catch (e) {}
  function persistDifficulty() {
    try { localStorage.setItem(DIFFICULTY_STORAGE_KEY, difficulty); } catch (e) {}
  }
  function diffCfg() { return DIFFICULTY[difficulty]; }

  // These are now per-difficulty. Mutated each restart() so they always
  // match the currently-selected preset.
  let TIMER_START = DIFFICULTY[difficulty].timer;
  let START_LIVES = DIFFICULTY[difficulty].lives;

  // ------ canvas + state -----------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // Make the canvas focusable so that key events feel anchored to it,
  // and so the page doesn't scroll when arrow keys are pressed.
  canvas.tabIndex = 0;
  canvas.addEventListener('mousedown', () => canvas.focus());

  // Level dimensions are now per-level. H is constant (always 15) but W
  // varies — level 1 is much wider than levels 2 and 3. World dimensions
  // get recomputed inside loadLevel() each time we switch levels.
  let W = 240;
  const H = window.LEVEL_HEIGHT || 15;
  let WORLD_W = W * TILE;
  const WORLD_H = H * TILE;

  // Mutable level grid (array of arrays of single chars). Built fresh in
  // loadLevel() so restart works.
  let tiles = null;

  // Multi-level state: which level is currently being played, plus a
  // persisted progress object tracking the highest unlocked level and the
  // best score earned per level.
  const LEVEL_STORAGE_KEY    = 'pounce_level';
  const PROGRESS_STORAGE_KEY = 'pounce_progress';
  const LEVEL_COUNT = (window.LEVELS && window.LEVELS.length) || 1;
  let currentLevel = 0;
  try {
    const saved = parseInt(localStorage.getItem(LEVEL_STORAGE_KEY), 10);
    if (!isNaN(saved) && saved >= 0 && saved < LEVEL_COUNT) currentLevel = saved;
  } catch (e) {}
  function persistCurrentLevel() {
    try { localStorage.setItem(LEVEL_STORAGE_KEY, String(currentLevel)); } catch (e) {}
  }
  let progress = { unlocked: 1, bestScores: new Array(LEVEL_COUNT).fill(0) };
  try {
    const raw = localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') {
        if (typeof obj.unlocked === 'number' && obj.unlocked >= 1 && obj.unlocked <= LEVEL_COUNT) {
          progress.unlocked = obj.unlocked;
        }
        if (Array.isArray(obj.bestScores)) {
          for (let i = 0; i < LEVEL_COUNT; i++) {
            if (typeof obj.bestScores[i] === 'number') progress.bestScores[i] = obj.bestScores[i];
          }
        }
      }
    }
  } catch (e) {}
  function persistProgress() {
    try { localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress)); } catch (e) {}
  }
  // Session-best score: highest score the player has reached across all
  // runs since this page was loaded. Resets on reload by design — players
  // see "can I beat what I just did?" tension within a session, while the
  // per-level bestScores in `progress` carries across sessions for the
  // intro/level-select chips and the global leaderboard.
  let sessionBest = 0;

  // If the saved currentLevel is locked (e.g., progress was wiped), reset to 0.
  if (currentLevel >= progress.unlocked) currentLevel = 0;

  const game = {
    mode: 'intro',          // intro | playing | paused | dying | dead | settling | win
    lives: START_LIVES,
    score: 0,
    collected: 0,
    totalCollectibles: 0,
    timer: TIMER_START,
    levelTime: 0,
    cameraX: 0,
    player: null,
    playerStart: { x: 0, y: 0 },
    goal: null,
    enemies: [],
    items: [],
    powerUps: [],           // cans / fish that have popped out of boxes
    projectiles: [],        // fishbones currently in flight
    particles: [],          // cosmetic puffs / sparkles
    tileBumps: [],          // per-tile head-bump pop animations (Q boxes)
    flash: 0,               // brief screen flash on stomp (cosmetic)
    shakeT: 0,              // remaining shake duration in seconds
    shakeAmp: 0,            // shake amplitude in pixels
    dyingT: 0,              // time spent in 'dying' mode
    dyingKind: null,        // 'final' (game over) | 'pit' (lose-a-life respawn)
    respawnFadeT: 0,        // black-fade-out timer after respawning at start
    deathTimer: 0,
    settleT: 0,             // time spent in 'settling' (cat curling onto bed)
    settleZAt: 0,           // last time we spawned a sleep-Z particle
  };

  // Trigger a brief camera shake. New shakes don't override stronger ones
  // already in flight — `Math.max` keeps the bigger of the two so a stomp
  // that lands during a pound doesn't downgrade the pound's shake.
  function shake(durSec, amp) {
    if (durSec > game.shakeT)  game.shakeT  = durSec;
    if (amp     > game.shakeAmp) game.shakeAmp = amp;
  }

  // ------ helpers ------------------------------------------------------------
  function rectOverlap(a, b) {
    return (
      a.x < b.x + b.w &&
      a.x + a.w > b.x &&
      a.y < b.y + b.h &&
      a.y + a.h > b.y
    );
  }

  function isSolidChar(c) {
    // ground (#), dirt (=), platform (-), unused box (Q), used box (@)
    return c === '#' || c === '=' || c === '-' || c === 'Q' || c === '@';
  }

  function tileAt(col, row) {
    if (col < 0 || col >= W || row < 0 || row >= H) return '.';
    return tiles[row][col];
  }

  function isSolidAt(col, row) {
    return isSolidChar(tileAt(col, row));
  }

  // ------ entity factories ---------------------------------------------------
  function makePlayer(px, py) {
    return {
      x: px,
      y: py,
      w: POWER.small.w,
      h: POWER.small.h,
      vx: 0,
      vy: 0,
      onGround: false,
      facing: 'right',
      state: 'idle',
      animFrame: 0,
      animTimer: 0,
      invuln: 0,
      coyote: 0,
      jumpBuffer: 0,
      prevJump: false,
      // Power state machine. 'small' = default; 'big' = ate cat food, takes
      // an extra hit before dying; 'shooter' = ate magic fish, can throw
      // fishbones with the X key. Sprite + hitbox swap on transition.
      power: 'small',
      powerXfade: 0,           // brief visual pulse during grow / shrink
      shootCooldown: 0,        // seconds until next fishbone is allowed
      prevShoot: false,        // edge-detect the shoot key
      lastStepAt: 0,           // animTimer of last step-puff spawn
      pounding: false,         // currently slamming downward
      poundLockout: 0,         // small grace window after a pound lands
      poundJumpGrace: 0,       // post-jump window where pounce is suppressed
      prevDown: false,         // edge-detect the down key
    };
  }

  // Switch the player's size in place. The hitbox bottom stays anchored to
  // its current position (so feet stay on the same surface) and the head
  // moves up/down to fit the new height. We don't try to resolve clipping at
  // the new size — the next physics frame will push the player out of any
  // tile they overlap.
  function setPlayerPower(newPower) {
    const p = game.player;
    if (p.power === newPower) return;
    const oldH = p.h;
    const newDims = POWER[newPower];
    p.power = newPower;
    p.w = newDims.w;
    // Anchor the feet: shift y so y + h stays the same.
    p.y = (p.y + oldH) - newDims.h;
    p.h = newDims.h;
    p.powerXfade = 0.4;
  }

  // Enemy stats by type:
  //   B = dog          — 26×20, walking patroller, ~1 px/frame
  //   D = child        — 24×12, slower crawl
  //   W = wasp         — 18×12, flies in a sine wave, can't be stomped
  const ENEMY_DIMS = {
    B: { w: 26, h: 20, vx: -0.95, flying: false },
    D: { w: 24, h: 12, vx: -0.55, flying: false },
    W: { w: 18, h: 12, vx: -1.6,  flying: true  },
  };

  function makeEnemy(type, px, py) {
    const dims = ENEMY_DIMS[type] || ENEMY_DIMS.B;
    const mul = diffCfg().enemyMul;
    const e = {
      type,
      x: px,
      y: py,
      w: dims.w,
      h: dims.h,
      vx: dims.vx * mul,           // difficulty scales enemy speed
      vy: 0,
      flying: dims.flying,
      alive: true,
      stomped: false,
      stompTimer: 0,
      animTimer: 0,
      animFrame: 0,
    };
    // Wasps remember the y they spawned at; their sine wave is centred on it.
    if (e.flying) {
      e.baseY = py;
      e.flyPhase = Math.random() * Math.PI * 2;
    }
    return e;
  }

  // ------ level loading ------------------------------------------------------
  function loadLevel() {
    // Pick the right level data based on currentLevel and update the world
    // dimensions accordingly. Camera-clamping uses the live W / WORLD_W so
    // a wider level scrolls farther.
    const ld = (window.LEVELS && window.LEVELS[currentLevel]) || {
      grid: window.LEVEL,
      width: window.LEVEL_WIDTH,
      height: window.LEVEL_HEIGHT,
    };
    W = ld.width;
    WORLD_W = W * TILE;
    tiles = ld.grid.map((row) => row.split(''));

    game.enemies = [];
    game.items = [];
    game.powerUps = [];
    game.projectiles = [];
    game.particles = [];
    game.tileBumps = [];
    game.totalCollectibles = 0;
    game.goal = null;
    cameraLead = 0;          // reset look-ahead bias for the fresh level

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = tiles[y][x];
        const wx = x * TILE;
        const wy = y * TILE;

        if (c === 'P') {
          // Player feet should rest on the tile *below* the P glyph: place
          // the hitbox so its bottom aligns with (y+1)*TILE.
          const startX = wx + (TILE - PLAYER_W) / 2;
          const startY = (y + 1) * TILE - PLAYER_H;
          game.playerStart = { x: startX, y: startY };
          game.player = makePlayer(startX, startY);
          tiles[y][x] = '.';
        } else if (c === 'G') {
          game.goal = { x: wx, y: wy };
          tiles[y][x] = '.';
        } else if (c === 'F') {
          game.items.push({
            type: 'F',
            x: wx,
            y: wy,
            alive: true,
            bob: Math.random() * Math.PI * 2,
          });
          game.totalCollectibles++;
          tiles[y][x] = '.';
        } else if (c === 'Y') {
          game.items.push({
            type: 'Y',
            x: wx,
            y: wy,
            alive: true,
            bob: Math.random() * Math.PI * 2,
          });
          game.totalCollectibles++;
          tiles[y][x] = '.';
        } else if (c === 'B' || c === 'D' || c === 'W') {
          const dims = ENEMY_DIMS[c];
          const ex = wx + (TILE - dims.w) / 2;
          // Walking enemies: feet on the tile below the glyph.
          // Flying enemies: the glyph row IS where the wasp hovers.
          const ey = dims.flying
            ? wy + (TILE - dims.h) / 2
            : (y + 1) * TILE - dims.h;
          game.enemies.push(makeEnemy(c, ex, ey));
          tiles[y][x] = '.';
        }
      }
    }
  }

  function restart() {
    // Re-read the difficulty config in case the player changed it on the
    // title screen between runs.
    TIMER_START = diffCfg().timer;
    START_LIVES = diffCfg().lives;
    game.lives = START_LIVES;
    game.score = 0;
    game.collected = 0;
    game.timer = TIMER_START;
    game.levelTime = 0;
    game.cameraX = 0;
    game.flash = 0;
    game.shakeT = 0;
    game.shakeAmp = 0;
    game.dyingT = 0;
    game.dyingKind = null;
    game.respawnFadeT = 0;
    game.deathTimer = 0;
    game.tempoBoosted = false;
    hideLbEntry();
    loadLevel();
    game.mode = 'playing';
    Audio.musicTempo(1.0);
    tryStartMusic();
  }

  function respawnPlayer() {
    const p = game.player;
    p.x = game.playerStart.x;
    p.y = game.playerStart.y;
    p.vx = 0;
    p.vy = 0;
    p.invuln = 1.5;
    p.facing = 'right';
    p.state = 'idle';
    // Lose all power state on respawn — Mario-style. Reset dimensions
    // directly because game.playerStart was sized for the small hitbox.
    p.power = 'small';
    p.w = POWER.small.w;
    p.h = POWER.small.h;
    p.shootCooldown = 0;
    // Clear all transient physics + input state so the cat doesn't, e.g.,
    // fire a pounce on the very first frame after teleporting back to the
    // start because the player was still holding ↓ during the fade.
    p.pounding = false;
    p.poundLockout = 0;
    p.poundJumpGrace = 0;
    p.coyote = 0;
    p.jumpBuffer = 0;
    p.prevJump = false;
    p.prevDown = false;
    p.prevShoot = false;
    p.animTimer = 0;
    p.animFrame = 0;
    p.lastStepAt = 0;
    p.powerXfade = 0;
    game.cameraX = 0;
    cameraLead = 0;
  }

  // ------ input --------------------------------------------------------------
  const keys = Object.create(null);

  function setKey(e, down) {
    const k = e.key.toLowerCase();
    keys[k] = down;
    // Prevent the page from scrolling when arrow keys / space are pressed.
    if (
      k === ' ' ||
      k === 'arrowup' ||
      k === 'arrowdown' ||
      k === 'arrowleft' ||
      k === 'arrowright'
    ) {
      e.preventDefault();
    }
  }

  document.addEventListener('keydown', (e) => {
    // While the high-score input is open and focused, let the input handle
    // its own keys natively — don't pipe them into the game's key state.
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
      return;
    }
    setKey(e, true);
    Audio.resume();

    const k = e.key.toLowerCase();

    // Audio + accessibility toggles short-circuit BEFORE any mode-specific
    // routing so they work instantly in any mode, including the intro
    // screen and game-over.
    if (k === 'm') { toggleMusic(); return; }
    if (k === 'n') { toggleSfx();   return; }
    if (k === 'c') { toggleHc();    return; }

    // ---- intro screen: arrows cycle the cat picker, anything else starts ----
    if (game.mode === 'intro') {
      if (k === 'arrowleft' || k === 'a') {
        const i = Sprites.catNames.indexOf(selectedCat);
        const n = Sprites.catNames.length;
        selectedCat = Sprites.catNames[(i - 1 + n) % n];
        persistCat();
        return;
      }
      if (k === 'arrowright' || k === 'd') {
        const i = Sprites.catNames.indexOf(selectedCat);
        selectedCat = Sprites.catNames[(i + 1) % Sprites.catNames.length];
        persistCat();
        return;
      }
      // Number keys 1/2/3 jump straight to that level if it's unlocked.
      if (k >= '1' && k <= '9') {
        const idx = parseInt(k, 10) - 1;
        if (idx < LEVEL_COUNT && levelUnlocked(idx)) {
          currentLevel = idx;
          persistCurrentLevel();
        }
        return;
      }
      // L cycles forward through unlocked levels.
      if (k === 'l') {
        for (let step = 1; step <= LEVEL_COUNT; step++) {
          const next = (currentLevel + step) % LEVEL_COUNT;
          if (levelUnlocked(next)) { currentLevel = next; persistCurrentLevel(); break; }
        }
        return;
      }
      // Difficulty hotkeys: E = easy, H = hard, default Space-press uses
      // whatever's currently selected.
      if (k === 'e') { difficulty = 'easy';   persistDifficulty(); return; }
      if (k === 'h') { difficulty = 'hard';   persistDifficulty(); return; }
      // No key for "normal" specifically — clicking the chip handles it,
      // and players can also tap E or H twice to step around.
      // R on the intro wipes the saved snapshot so the next Start is fresh.
      if (k === 'r') {
        clearSnapshot();
        pendingSnapshot = null;
        return;
      }
      // Any "start" key launches the run. If a snapshot is queued (loaded
      // at boot, not yet wiped), resume from it; otherwise call restart()
      // which reloads the level and resets per-run state.
      if (
        k === ' ' || k === 'enter' || k === 'w' || k === 'arrowup' ||
        k === 's' || k === 'arrowdown'
      ) {
        if (pendingSnapshot) {
          const snap = pendingSnapshot;
          pendingSnapshot = null;
          resumeFromSnapshot(snap);
        } else {
          restart();
        }
        return;
      }
      // Other keys (e.g. modifiers) — ignore on the title screen.
      return;
    }

    if (game.mode === 'playing' && k === 'p') game.mode = 'paused';
    else if (game.mode === 'paused' && k === 'p') game.mode = 'playing';
    else if (
      (game.mode === 'dead' || game.mode === 'win') &&
      (k === 'enter' || k === 'r' || k === ' ') &&
      !lbEntryActive          // don't restart while the player is typing a name
    ) {
      // After a win on a non-final level, the same key advances to the next
      // level. After a win on the final level, or on death, it restarts the
      // current level.
      if (game.mode === 'win' && currentLevel < LEVEL_COUNT - 1) {
        currentLevel += 1;
        persistCurrentLevel();
      }
      restart();
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    setKey(e, false);
  });

  // Stop browser-default scroll when the canvas has focus and arrow keys are pressed.
  canvas.focus();

  // Wire the music-toggle button on the page (clicking it shouldn't steal
  // focus from the canvas — focus the canvas back after the click so the
  // arrow keys keep working).
  syncMusicButton();
  const musicBtn = document.getElementById('music-toggle');
  if (musicBtn) {
    musicBtn.addEventListener('click', () => {
      Audio.resume();              // first-click also unlocks the AudioContext
      toggleMusic();
      // Drop focus immediately. If the button kept focus, the browser would
      // fire a synthetic `click` on it whenever the user presses Space (the
      // game's jump key) — re-firing the toggle and making it feel "stuck".
      try { musicBtn.blur(); } catch (e) {}
      canvas.focus();
    });
  }

  syncSfxButton();
  const sfxBtn = document.getElementById('sfx-toggle');
  if (sfxBtn) {
    sfxBtn.addEventListener('click', () => {
      Audio.resume();
      toggleSfx();
      try { sfxBtn.blur(); } catch (e) {}
      canvas.focus();
    });
  }

  syncHcButton();
  const hcBtn = document.getElementById('contrast-toggle');
  if (hcBtn) {
    hcBtn.addEventListener('click', () => {
      toggleHc();
      try { hcBtn.blur(); } catch (e) {}
      canvas.focus();
    });
  }

  // ---- volume slider wiring ----
  function wireSlider(id, getter, setter, applyFn, storeKey) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = String(Math.round(getter() * 100));
    const onInput = () => {
      const v = parseInt(el.value, 10) / 100;
      setter(v);
      applyFn(v);
      saveVol(storeKey, v);
    };
    el.addEventListener('input', onInput);
    // After releasing the slider, drop focus back to the canvas so SPACE
    // / arrow keys go to the game instead of nudging the slider.
    el.addEventListener('change', () => { try { el.blur(); } catch (e) {} canvas.focus(); });
    // Stop game keys from reaching the document handler while focused.
    el.addEventListener('keydown', (e) => e.stopPropagation());
  }
  wireSlider(
    'music-volume',
    () => musicVolume,
    (v) => { musicVolume = v; },
    (v) => Audio.setMusicVolume(v),
    MUSIC_VOL_KEY
  );
  wireSlider(
    'sfx-volume',
    () => sfxVolume,
    (v) => { sfxVolume = v; },
    (v) => Audio.setSfxVolume(v),
    SFX_VOL_KEY
  );

  // Game-speed slider — separate from the volume sliders because its
  // range is 50–100 (not 0–100) and it's persisted under a different
  // key. Same focus-release pattern so SPACE / arrows go to the game.
  (function wireSpeedSlider() {
    const el = document.getElementById('speed-slider');
    if (!el) return;
    el.value = String(Math.round(gameSpeed * 100));
    el.addEventListener('input', () => {
      const v = Math.max(50, Math.min(100, parseInt(el.value, 10))) / 100;
      gameSpeed = v;
      saveSpeed(v);
    });
    el.addEventListener('change', () => { try { el.blur(); } catch (e) {} canvas.focus(); });
    el.addEventListener('keydown', (e) => e.stopPropagation());
  })();

  // ---- touch-control wiring ----
  // Each .touch-btn has a data-key matching one of the keys checked by the
  // input helpers (arrowleft / arrowright / space / arrowdown / x). On
  // pointerdown we set keys[k] = true, on pointerup / cancel / leave we
  // clear it. setPointerCapture so a finger that drags off the button
  // still releases cleanly.
  function bindTouchButton(btn) {
    const key = btn.dataset && btn.dataset.key;
    if (!key) return;
    const press = (e) => {
      e.preventDefault();
      keys[key] = true;
      btn.classList.add('pressed');
      Audio.resume();              // first-press unlocks the AudioContext
      try { btn.setPointerCapture(e.pointerId); } catch (err) {}
      // Touch buttons set the `keys` map but never fire a real keydown
      // event, so transitions that live in the document keydown handler
      // (start from intro, restart from dead/win) wouldn't fire for
      // touch-only users. Fast-path the jump-button taps that act as
      // confirm/start/advance buttons across those screens.
      const isStartKey = key === ' ' || key === 'arrowup' || key === 'w' ||
                         key === 'arrowdown' || key === 's';
      if (isStartKey && game.mode === 'intro') {
        if (pendingSnapshot) {
          const snap = pendingSnapshot;
          pendingSnapshot = null;
          resumeFromSnapshot(snap);
        } else {
          restart();
        }
      } else if (
        isStartKey && (game.mode === 'dead' || game.mode === 'win') &&
        !lbEntryActive
      ) {
        if (game.mode === 'win' && currentLevel < LEVEL_COUNT - 1) {
          currentLevel += 1;
          persistCurrentLevel();
        }
        restart();
      }
    };
    const release = () => {
      keys[key] = false;
      btn.classList.remove('pressed');
    };
    btn.addEventListener('pointerdown',   press);
    btn.addEventListener('pointerup',     release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('pointerleave',  release);
    // Also clear if the button gets blurred (e.g. focus moves elsewhere).
    btn.addEventListener('blur', release);
    // Stop the click event from bubbling up to the canvas's intro picker.
    btn.addEventListener('click', (e) => e.stopPropagation());
  }
  document.querySelectorAll('.touch-btn').forEach(bindTouchButton);

  // Switch to touch mode the first time we see a real touch event. This
  // beats the pure-CSS @media (pointer: coarse) on hybrid devices that
  // report mouse-and-touch (e.g. iPad with magic keyboard) — the player
  // still gets the buttons the moment they put a finger on the screen.
  const onFirstTouch = () => {
    document.body.classList.add('touch-active');
    window.removeEventListener('touchstart', onFirstTouch);
  };
  window.addEventListener('touchstart', onFirstTouch, { passive: true });

  function leftKey()   { return !!(keys['a'] || keys['arrowleft']); }
  function rightKey()  { return !!(keys['d'] || keys['arrowright']); }
  function jumpKey()   { return !!(keys['w'] || keys['arrowup'] || keys[' ']); }
  function shootKey()  { return !!(keys['x'] || keys['j']); }
  function downKey()   { return !!(keys['s'] || keys['arrowdown']); }
  // Sprint: hold Shift on keyboard, or RT (gamepad button 7) on a controller.
  // Like Mario's B-button run — increases MAX_RUN to SPRINT_RUN and grants
  // a small jump-impulse bonus so the cat covers wider gaps when committed.
  function sprintKey() { return !!(keys['shift'] || keys['gamepadsprint']); }

  // ------ collision ----------------------------------------------------------

  /**
   * Move `e` along the X axis by `dx`, then resolve any tile overlaps by
   * pushing back and zeroing horizontal velocity. Returns true on hit.
   *
   * The four covered tiles are determined by the entity's AABB. We loop and
   * test isSolidAt() at each integer tile index — tiles are 32 px so an entity
   * can overlap at most a 2×2 grid.
   */
  function moveX(e, dx) {
    e.x += dx;
    const left = Math.floor(e.x / TILE);
    const right = Math.floor((e.x + e.w - 1) / TILE);
    const top = Math.floor(e.y / TILE);
    const bot = Math.floor((e.y + e.h - 1) / TILE);
    let hit = false;
    for (let y = top; y <= bot; y++) {
      for (let x = left; x <= right; x++) {
        if (isSolidAt(x, y)) {
          if (dx > 0) e.x = x * TILE - e.w;
          else if (dx < 0) e.x = (x + 1) * TILE;
          e.vx = 0;
          hit = true;
        }
      }
    }
    return hit;
  }

  /**
   * Move `e` along the Y axis by `dy`, then resolve overlaps. If we hit while
   * moving down, mark `onGround = true`.
   */
  function moveY(e, dy) {
    e.y += dy;
    const left = Math.floor(e.x / TILE);
    const right = Math.floor((e.x + e.w - 1) / TILE);
    const top = Math.floor(e.y / TILE);
    const bot = Math.floor((e.y + e.h - 1) / TILE);
    let hit = false;
    for (let y = top; y <= bot; y++) {
      for (let x = left; x <= right; x++) {
        if (isSolidAt(x, y)) {
          if (dy > 0) {
            e.y = y * TILE - e.h;
            e.onGround = true;
          } else if (dy < 0) {
            e.y = (y + 1) * TILE;
          }
          e.vy = 0;
          hit = true;
        }
      }
    }
    return hit;
  }

  // ------ player update ------------------------------------------------------
  function updatePlayer(dt) {
    const p = game.player;

    // --- down-pounce input ---
    // Detect a fresh down-press while airborne. Pounce locks horizontal
    // input, snaps vy to a high downward speed, and gives a hard hit on
    // contact with anything below — even wasps that would normally have to
    // be shot.
    if (p.poundLockout > 0) p.poundLockout = Math.max(0, p.poundLockout - dt);
    if (p.poundJumpGrace > 0) p.poundJumpGrace = Math.max(0, p.poundJumpGrace - dt);
    const downPressed = downKey() && !p.prevDown;
    p.prevDown = downKey();
    if (
      downPressed &&
      !p.onGround &&
      !p.pounding &&
      p.poundLockout === 0 &&
      p.poundJumpGrace === 0
    ) {
      p.pounding = true;
      p.vy = POUND_VY;
      p.vx = 0;
      Audio.pound();
    }

    // --- horizontal input + acceleration ---
    // Pounce locks horizontal control until the cat lands.
    // Acceleration is reduced in the air (AIR_ACC ≈ 60% of MOVE_ACC) so
    // mid-jump corrections feel like steering, not snapping. The ceiling
    // on speed (MAX_RUN / SPRINT_RUN) doesn't change in air; you just
    // can't *change direction* as quickly while airborne.
    if (!p.pounding) {
      const acc = p.onGround ? MOVE_ACC : AIR_ACC;
      const sprinting = p.onGround && sprintKey();
      const cap = sprinting ? SPRINT_RUN : MAX_RUN;
      if (leftKey()) {
        p.vx -= acc;
        p.facing = 'left';
      }
      if (rightKey()) {
        p.vx += acc;
        p.facing = 'right';
      }
      if (!leftKey() && !rightKey() && p.onGround) {
        p.vx *= FRICTION;
        if (Math.abs(p.vx) < 0.1) p.vx = 0;
      }
      // Track whether the cat is currently sprinting (used to grant a
      // jump-power bonus on the launch frame below).
      p.sprinting = sprinting;
      // Speed cap: hard at the sprint cap if airborne (don't lose speed
      // mid-jump by releasing Shift); for ground, snap toward the active
      // cap so releasing Shift naturally decelerates.
      const effectiveCap = p.onGround ? cap : Math.max(cap, Math.abs(p.vx));
      if (p.vx >  effectiveCap) p.vx =  effectiveCap;
      if (p.vx < -effectiveCap) p.vx = -effectiveCap;
    } else {
      p.vx = 0;
    }

    // --- coyote time + jump buffer (no jumping during pounce) ---
    if (p.onGround) p.coyote = COYOTE_TIME;
    else p.coyote = Math.max(0, p.coyote - dt);

    const jumpPressed = jumpKey() && !p.prevJump;
    if (jumpPressed) p.jumpBuffer = JUMP_BUFFER;
    else p.jumpBuffer = Math.max(0, p.jumpBuffer - dt);
    p.prevJump = jumpKey();

    if (!p.pounding && p.coyote > 0 && p.jumpBuffer > 0) {
      // Sprint jump: launching at full sprint speed gets a small upward
      // bonus on top of JUMP_VEL, so a running jump reaches further AND
      // higher — players can take a wider gap by committing to sprint.
      // Scaled smoothly with current speed so it isn't all-or-nothing.
      const speedT = Math.min(1, Math.max(0, (Math.abs(p.vx) - MAX_RUN) / (SPRINT_RUN - MAX_RUN)));
      p.vy = -(JUMP_VEL + SPRINT_JUMP_BONUS * speedT);
      p.onGround = false;
      p.coyote = 0;
      p.jumpBuffer = 0;
      p.poundJumpGrace = POUND_JUMP_GRACE;
      Audio.jump();
    }

    // --- gravity (variable jump: lighter while ascending + jump held) ---
    if (p.pounding) {
      // Pounce holds the slam speed; standard gravity would slow it.
      p.vy = Math.max(p.vy, POUND_VY);
    } else {
      // Three-zone gravity: while ascending and holding jump, gravity is
      // soft (variable jump height). Near the apex (|vy| small), gravity
      // softens further — that's the apex-hang the player can use to
      // line up the landing. Otherwise normal falling gravity applies.
      const ascending = p.vy < 0 && jumpKey();
      const inApex    = !p.pounding && Math.abs(p.vy) < APEX_BAND && !p.onGround;
      let g;
      if (ascending)      g = ASCEND_GRAV;
      else if (inApex)    g = APEX_GRAV;
      else                g = GRAVITY;
      p.vy += g;
      if (p.vy > MAX_FALL) p.vy = MAX_FALL;
    }

    // --- collision ---
    const wasPounding = p.pounding;
    p.onGround = false;
    const wasRising = p.vy < 0;
    moveX(p, p.vx);
    moveY(p, p.vy);

    // --- pounce-landing detection ---
    // If the cat was pouncing and just hit the ground, exit the state with
    // a small bounce + dust burst. Lockout the down key briefly so a held
    // key doesn't immediately re-trigger.
    if (wasPounding && p.onGround) {
      p.pounding = false;
      p.poundLockout = POUND_LOCKOUT;
      p.vy = POUND_BOUNCE_VY;
      spawnPoundBurst(p);
      Audio.poundLand();
      game.flash = 0.06;
      shake(0.18, 4);          // ground impact
    }

    // --- box hit detection ---
    // If the player was rising and just stopped (head bumped a ceiling),
    // check whether the bumped tile is a Q (power-up box). What pops out
    // depends on the cat's current power state — Mario-style:
    //   small  → cat-food can (next state: big)
    //   big    → magic fish   (next state: shooter)
    //   shooter → magic fish   (extra fish = score bonus)
    if (wasRising && p.vy === 0) {
      const bumpedRow = Math.floor((p.y - 1) / TILE);
      const left = Math.floor(p.x / TILE);
      const right = Math.floor((p.x + p.w - 1) / TILE);
      for (let x = left; x <= right; x++) {
        if (tileAt(x, bumpedRow) === 'Q') {
          tiles[bumpedRow][x] = '@';
          if (p.power === 'small') spawnCatFood(x, bumpedRow);
          else                     spawnFish(x, bumpedRow);
          spawnTileBump(x, bumpedRow);
          Audio.boxHit();
          break;                  // pop only one box per frame
        }
      }
    }

    // --- fishbone shooting ---
    if (p.shootCooldown > 0) p.shootCooldown -= dt;
    const shootPressed = shootKey() && !p.prevShoot;
    p.prevShoot = shootKey();
    if (shootPressed && p.power === 'shooter' && p.shootCooldown <= 0) {
      spawnFishbone();
      p.shootCooldown = SHOOT_COOLDOWN;
      Audio.shoot();
    }

    // --- world boundaries ---
    // Left edge: an invisible wall at x=0 so the cat can't leave the level
    // backwards. The camera already clamps; this stops the player from
    // walking off-screen behind the start.
    if (p.x < 0) { p.x = 0; if (p.vx < 0) p.vx = 0; }
    // Right edge: clamp to world width so the cat can't pass the goal.
    if (p.x + p.w > WORLD_W) { p.x = WORLD_W - p.w; if (p.vx > 0) p.vx = 0; }

    // --- death by pit (fell off the bottom of the world) ---
    if (p.y > WORLD_H + 64) {
      pitDeath();
      return;
    }

    // --- visual state for sprite selection ---
    if (!p.onGround) {
      p.state = p.vy < 0 ? 'jump' : 'fall';
    } else if (Math.abs(p.vx) > 0.5) {
      p.state = 'run';
    } else {
      p.state = 'idle';
    }

    // run animation cycles ~8 fps
    p.animTimer += dt;
    p.animFrame = p.state === 'run' ? Math.floor(p.animTimer * 8) % 2 : 0;

    // Step puffs — spawn a small dust cloud at the feet on each footfall
    // while running on the ground. The visual sells "actually running"
    // without a side-view sprite cycle.
    if (p.state === 'run' && p.onGround) {
      if (p.animTimer - p.lastStepAt > 0.16) {
        spawnStepPuff(p);
        p.lastStepAt = p.animTimer;
      }
    }

    if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - dt);
  }

  // ------ particles (cosmetic) ---------------------------------------------
  function spawnStepPuff(p) {
    const dirX = p.facing === 'right' ? -1 : 1;   // drift opposite of run
    game.particles.push({
      kind: 'puff',
      x: p.x + p.w / 2,
      y: p.y + p.h - 2,
      vx: dirX * 0.35,
      vy: -0.25,
      age: 0,
      life: 0.32,
      alive: true,
    });
  }

  // A down-pounce hits the floor — fan out a small ring of dust particles
  // so the impact has weight. Six pebbles, alternating left and right.
  function spawnPoundBurst(p) {
    const cx = p.x + p.w / 2;
    const baseY = p.y + p.h - 2;
    for (let i = 0; i < 6; i++) {
      const dir = i % 2 === 0 ? -1 : 1;
      const speed = 0.8 + Math.random() * 1.4;
      game.particles.push({
        kind: 'puff',
        x: cx,
        y: baseY,
        vx: dir * speed,
        vy: -0.6 - Math.random() * 1.2,
        age: 0,
        life: 0.5,
        alive: true,
      });
    }
  }

  function updateParticles(dt) {
    for (const par of game.particles) {
      if (!par.alive) continue;
      par.age += dt;
      if (par.age >= par.life) { par.alive = false; continue; }
      par.x += par.vx;
      par.y += par.vy;
      par.vx *= 0.93;
      par.vy += 0.04;
    }
    if (game.particles.length > 32) {
      game.particles = game.particles.filter(p => p.alive);
    }
  }

  // Tile-bump pop: when the cat head-bumps a Q box, the tile briefly
  // jumps up a few pixels and settles. Pure cosmetic — physics still
  // treats the tile as a stationary '@' immediately.
  const TILE_BUMP_DUR = 0.18;     // total animation length (s)
  const TILE_BUMP_PEAK = 8;       // max upward offset (px)
  function spawnTileBump(col, row) {
    // Replace any in-flight bump for the same tile (so a re-hit while still
    // animating restarts the pop rather than stacking).
    for (const b of game.tileBumps) {
      if (b.col === col && b.row === row) { b.t = 0; return; }
    }
    game.tileBumps.push({ col, row, t: 0 });
  }
  function updateTileBumps(dt) {
    for (const b of game.tileBumps) b.t += dt;
    if (game.tileBumps.length > 0 &&
        game.tileBumps[0].t >= TILE_BUMP_DUR) {
      // Cheap GC: only filter when the oldest entry is done. Bumps drop fast.
      game.tileBumps = game.tileBumps.filter(b => b.t < TILE_BUMP_DUR);
    }
  }
  // Returns the current upward offset (px) for the given tile, or 0 if no bump.
  function tileBumpOffset(col, row) {
    for (const b of game.tileBumps) {
      if (b.col !== col || b.row !== row) continue;
      const u = b.t / TILE_BUMP_DUR;
      if (u >= 1) return 0;
      // Half-sine arc: 0 → peak → 0.
      return -TILE_BUMP_PEAK * Math.sin(u * Math.PI);
    }
    return 0;
  }

  function drawParticles() {
    const camX = Math.floor(game.cameraX);
    for (const par of game.particles) {
      if (!par.alive) continue;
      const t = par.age / par.life;
      if (par.kind === 'z') {
        // Sleep-Z: draw a small letter "z" that drifts up and right and
        // fades out. Used during the settle-into-bed beat.
        const alpha = (1 - t) * 0.85;
        const size = 10 + t * 6;
        ctx.save();
        ctx.fillStyle = `rgba(240, 230, 255, ${alpha.toFixed(3)})`;
        ctx.font = `bold ${Math.floor(size)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Z', par.x - camX, par.y);
        ctx.restore();
        continue;
      }
      const alpha = (1 - t) * 0.55;
      const radius = 2.5 + t * 3;
      ctx.fillStyle = `rgba(220, 200, 170, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(par.x - camX, par.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ------ enemies ------------------------------------------------------------
  function updateEnemies(dt) {
    for (const e of game.enemies) {
      if (!e.alive) continue;

      if (e.stomped) {
        e.stompTimer += dt;
        // A killed wasp falls out of the sky; squashed grounds-walkers stay flat.
        if (e.flying) {
          e.vy += GRAVITY;
          if (e.vy > MAX_FALL) e.vy = MAX_FALL;
          e.y += e.vy;
        }
        if (e.stompTimer > 0.7) e.alive = false;
        continue;
      }

      e.animTimer += dt;
      e.animFrame = Math.floor(e.animTimer * 4) % 2;

      if (e.flying) {
        // Wasp: no gravity, sine-wave vertical wobble around baseY, bounce
        // off solid tiles horizontally.
        e.flyPhase += dt * 2.4;
        e.y = e.baseY + Math.sin(e.flyPhase) * 14;
        const hitX = moveX(e, e.vx);
        if (hitX) e.vx = -e.vx;
      } else {
        // Walking enemy: gravity + horizontal patrol with wall-bounce + edge
        // detection so they don't tumble off platforms.
        e.vy += GRAVITY;
        if (e.vy > MAX_FALL) e.vy = MAX_FALL;
        const beforeX = e.x;
        moveX(e, e.vx);
        if (e.x === beforeX) e.vx = -e.vx;
        e.onGround = false;
        moveY(e, e.vy);
        if (e.onGround) {
          const aheadX = e.vx > 0 ? e.x + e.w + 1 : e.x - 1;
          const aheadCol = Math.floor(aheadX / TILE);
          const groundRow = Math.floor((e.y + e.h) / TILE);
          if (!isSolidAt(aheadCol, groundRow)) e.vx = -e.vx;
        }
      }
    }
  }

  // ------ collectibles + enemy collisions -----------------------------------
  function updateCollisions(dt) {
    const p = game.player;
    const pr = { x: p.x, y: p.y, w: p.w, h: p.h };

    for (const item of game.items) {
      if (!item.alive) continue;
      // Slightly inset hitbox so player has to mostly overlap the item.
      const ir = { x: item.x + 6, y: item.y + 6, w: 20, h: 20 };
      if (rectOverlap(pr, ir)) {
        item.alive = false;
        game.collected++;
        game.score += item.type === 'Y' ? 50 : 10;
        Audio.collect();
      }
    }

    if (p.invuln > 0) return;

    for (const e of game.enemies) {
      if (!e.alive || e.stomped) continue;
      const er = { x: e.x, y: e.y, w: e.w, h: e.h };
      if (!rectOverlap(pr, er)) continue;

      // Down-pounce: kills ANYTHING the cat lands on, including wasps.
      // The pound bonus is 200 points (vs 100 for a normal stomp).
      if (p.pounding) {
        e.stomped = true;
        e.stompTimer = 0;
        e.y = e.y + e.h - 6;
        e.h = 6;
        p.vy = -10;             // bigger pound bounce
        p.pounding = false;     // landing on an enemy ends the pounce too
        p.poundLockout = POUND_LOCKOUT;
        game.score += 200;
        game.flash = 0.12;
        shake(0.22, 5);         // big crunch
        Audio.stomp();
        continue;
      }

      // Wasps cannot be stomped — they sting from above. The player has to
      // shoot them with a fishbone projectile (or pounce them, handled
      // above).
      if (e.flying) {
        hurtPlayer();
        continue;
      }

      // Stomp: player is descending and feet are within the top 12 px of the
      // enemy. Otherwise, the player is hurt.
      const feetY = p.y + p.h;
      if (p.vy > 0 && feetY < e.y + 12) {
        e.stomped = true;
        e.stompTimer = 0;
        // Squashed sprites sit lower on the ground.
        e.y = e.y + e.h - 6;
        e.h = 6;
        p.vy = -7; // stomp bounce
        game.score += 100;
        game.flash = 0.08;
        shake(0.12, 2.5);
        Audio.stomp();
      } else {
        hurtPlayer();
      }
    }
  }

  function hurtPlayer() {
    const p = game.player;
    shake(0.22, 4);
    // If the cat is powered up (big or shooter), shrink to small instead of
    // dying — Mario-style: any hit takes the cat all the way back to small.
    if (p.power === 'big' || p.power === 'shooter') {
      setPlayerPower('small');
      p.invuln = 1.5;
      Audio.powerDown();
      return;
    }
    // Small cat takes a fatal hit. Lose a life and route through the same
    // dying-and-respawn flow as a pit fall, so the run resets cleanly to
    // the start of the level instead of carrying the cat past the enemy
    // mid-collision.
    pitDeath();
  }

  // Transition to the brief 'dying' phase. Two flavours:
  //   'pit'   — lost a life from a pit fall, will respawn at start.
  //             Short fade-to-black so the snap doesn't feel like a glitch.
  //   'final' — out of lives. The cat tumbles up off-screen, the music
  //             stops, the screen darkens, then the game-over panel
  //             appears. Gives the death weight instead of an instant cut.
  function startDying(kind) {
    game.mode = 'dying';
    game.dyingT = 0;
    game.dyingKind = kind;
    if (kind === 'final' && game.player) {
      // Tumble: pop the cat upward, give it a small horizontal kick, then
      // gravity takes over. The render path uses the 'hurt' sprite for the
      // duration so the cat reads as dead-not-dazed.
      game.player.vy = -10;
      game.player.vx = (Math.random() < 0.5 ? -1 : 1) * (1.5 + Math.random());
      game.player.invuln = 999;        // can't be hurt again mid-tumble
      game.player.pounding = false;
    }
  }

  function pitDeath() {
    game.lives--;
    if (game.lives <= 0) {
      Audio.death();
      Audio.musicStop();
      startDying('final');
      return;
    }
    Audio.hurt();
    startDying('pit');
  }

  // Final-death entry from non-pit causes (timer ran out — only path that
  // currently routes here, since enemy hits at zero lives also end up here
  // via hurtPlayer → game.lives--).
  function gameOver() {
    Audio.death();
    Audio.musicStop();
    startDying('final');
  }

  // Tick the dying mode forward. Final death tumbles the cat under gravity
  // off-screen and decays cosmetic timers; pit death just counts down to
  // the respawn fade. Both transition out at the end.
  function updateDying(dt) {
    game.dyingT += dt;

    if (game.dyingKind === 'final' && game.player) {
      // Free-fall the cat through tiles (no collision) so the tumble
      // sells "yeah, the cat is gone" rather than the cat awkwardly
      // landing on something.
      const p = game.player;
      p.vy += GRAVITY;
      if (p.vy > MAX_FALL) p.vy = MAX_FALL;
      p.x += p.vx;
      p.y += p.vy;
    }

    // Cosmetic timer decay — flash + shake should fade naturally.
    if (game.flash > 0)  game.flash  = Math.max(0, game.flash  - dt);
    if (game.shakeT > 0) {
      game.shakeT = Math.max(0, game.shakeT - dt);
      if (game.shakeT === 0) game.shakeAmp = 0;
    }
    for (const par of game.particles) {
      if (!par.alive) continue;
      par.age += dt;
      if (par.age >= par.life) par.alive = false;
    }

    // Transition out after the configured beat.
    const FINAL_DUR = 1.6;
    const PIT_DUR   = 0.7;
    const dur = game.dyingKind === 'final' ? FINAL_DUR : PIT_DUR;
    if (game.dyingT >= dur) {
      if (game.dyingKind === 'final') {
        game.mode = 'dead';
        game.deathTimer = 0;
        // Final death wipes the resume point — you can't pick up from
        // a state where you're already game-over.
        clearSnapshot();
        if (qualifiesForLeaderboard(game.score)) {
          setTimeout(showLbEntry, 400);
        }
      } else {
        // Pit respawn — teleport, set the fade-back-in timer, resume play.
        respawnPlayer();
        game.respawnFadeT = 0.35;
        game.mode = 'playing';
      }
    }
  }

  // ------ power-ups (cans + fish that pop out of boxes) ---------------------
  // Pop a cat-food can out of a Q box that just got bonked. The can rises
  // out of the box for ~0.4 s, then becomes a walking item that obeys gravity
  // and bounces off walls (Mario-style mushroom).
  function spawnCatFood(col, row) {
    game.powerUps.push({
      kind: 'food',
      // 14×16 sprite, centred on the 32-wide tile.
      x: col * TILE + (TILE - 14) / 2,
      y: row * TILE,             // starts inside the box
      w: 14, h: 16,
      vx: 0,
      vy: -1.6,                  // emerges upward
      dirX: 1,                   // walking direction once it lands
      state: 'rising',
      riseRemaining: 18,
      alive: true,
    });
  }

  function spawnFish(col, row) {
    // Magic fish power-up. Bigger sprite (22×16) and a static rise — Mario's
    // fire flower doesn't walk; it sits on top of the box. We mirror that:
    // after rising, the fish stays put on top of the (now used) box waiting
    // to be collected. That makes it harder to miss after a big head-bump.
    game.powerUps.push({
      kind: 'fish',
      x: col * TILE + (TILE - 22) / 2,
      y: row * TILE,
      w: 22, h: 16,
      vx: 0,
      vy: -1.4,
      dirX: 1,
      state: 'rising',
      riseRemaining: 20,
      alive: true,
    });
  }

  function updatePowerUps(dt) {
    const p = game.player;
    for (const item of game.powerUps) {
      if (!item.alive) continue;

      if (item.state === 'rising') {
        // Free-floating rise; skip tile collision so the item emerges
        // through the (now used) box without bonking it.
        item.y += item.vy;
        item.riseRemaining += item.vy;
        if (item.riseRemaining <= 0) {
          item.state = item.kind === 'fish' ? 'resting' : 'walking';
          item.vy = 0;
          if (item.state === 'walking') item.vx = item.dirX * 1.4;
        }
      } else if (item.state === 'walking') {
        // Walking: gravity + horizontal patrol with wall-bounce.
        item.vy += GRAVITY;
        if (item.vy > MAX_FALL) item.vy = MAX_FALL;
        const hitX = moveX(item, item.dirX * 1.4);
        if (hitX) item.dirX *= -1;
        moveY(item, item.vy);
      }
      // 'resting' = stationary, just sits and waits to be collected.

      // Despawn if it falls off the world.
      if (item.y > WORLD_H + 64) item.alive = false;

      // Player pickup
      const ir = { x: item.x, y: item.y, w: item.w, h: item.h };
      if (rectOverlap({ x: p.x, y: p.y, w: p.w, h: p.h }, ir)) {
        item.alive = false;
        if (item.kind === 'food') eatCatFood();
        else                       eatFish();
      }
    }
    if (game.powerUps.length > 16) {
      game.powerUps = game.powerUps.filter(i => i.alive);
    }
  }

  function eatCatFood() {
    const p = game.player;
    if (p.power === 'small') {
      setPlayerPower('big');
      game.score += 200;
      Audio.powerUp();
    } else {
      game.score += 100;
      Audio.collect();
    }
  }

  function eatFish() {
    const p = game.player;
    if (p.power === 'shooter') {
      // Already a shooter — score bonus only.
      game.score += 200;
      Audio.collect();
      return;
    }
    setPlayerPower('shooter');
    game.score += 500;
    Audio.powerUp();
  }

  // ------ projectiles (fishbones) ------------------------------------------
  function spawnFishbone() {
    const p = game.player;
    const dirX = p.facing === 'right' ? 1 : -1;
    game.projectiles.push({
      // 12×8 sprite, spawned at the cat's "mouth" (about chest height).
      x: p.x + (dirX === 1 ? p.w + 2 : -14),
      y: p.y + Math.floor(p.h * 0.35),
      w: 12, h: 8,
      vx: dirX * FISHBONE_VX,
      vy: 1.5,                   // slight downward toss to make an arc
      bounces: 0,
      animTimer: 0,
      frame: 0,
      alive: true,
    });
  }

  function updateProjectiles(dt) {
    for (const pr of game.projectiles) {
      if (!pr.alive) continue;

      pr.animTimer += dt;
      pr.frame = Math.floor(pr.animTimer * 14) % 2;

      // Gravity + horizontal motion; ground collisions bounce, wall
      // collisions kill the bone.
      pr.vy += FISHBONE_GRAV;
      if (pr.vy > MAX_FALL) pr.vy = MAX_FALL;

      const hitX = moveX(pr, pr.vx);
      if (hitX) { pr.alive = false; continue; }

      pr.onGround = false;
      moveY(pr, pr.vy);
      if (pr.onGround && pr.vy === 0) {
        // Bounce — gives the projectile a slightly silly "skipping" feel.
        pr.vy = FISHBONE_BOUNCE_VY;
        pr.bounces++;
        if (pr.bounces > 4) pr.alive = false;
      }

      // Despawn if it leaves the world or scrolls way off-camera.
      if (pr.y > WORLD_H + 64) pr.alive = false;
      const cam = game.cameraX;
      if (pr.x + pr.w < cam - 80 || pr.x > cam + VIEW_W + 80) pr.alive = false;

      // Enemy collision — fishbones one-shot enemies and disappear.
      for (const e of game.enemies) {
        if (!e.alive || e.stomped) continue;
        if (rectOverlap({ x: pr.x, y: pr.y, w: pr.w, h: pr.h },
                        { x: e.x,  y: e.y,  w: e.w,  h: e.h })) {
          e.stomped = true;
          e.stompTimer = 0;
          e.y = e.y + e.h - 6;
          e.h = 6;
          pr.alive = false;
          game.score += 200;
          shake(0.10, 2);
          Audio.stomp();
          break;
        }
      }
    }
    if (game.projectiles.length > 24) {
      game.projectiles = game.projectiles.filter(p => p.alive);
    }
  }

  // ------ items / camera / win check ----------------------------------------
  function updateItems(dt) {
    for (const item of game.items) item.bob += dt * 3;
    if (game.flash > 0) game.flash = Math.max(0, game.flash - dt);
    if (game.shakeT > 0) {
      game.shakeT = Math.max(0, game.shakeT - dt);
      if (game.shakeT === 0) game.shakeAmp = 0;
    }
    if (game.player && game.player.powerXfade > 0) {
      game.player.powerXfade = Math.max(0, game.player.powerXfade - dt);
    }
  }

  // Camera follows the cat with a small look-ahead bias: it leads the
  // facing direction by up to LOOK_AHEAD_PX, easing toward that lead so
  // the player has a wider view of what's coming. Eased rather than
  // snapped — a hard re-centre on every facing flip would feel jittery.
  const LOOK_AHEAD_PX = 80;
  const LOOK_AHEAD_EASE = 4.0;        // higher = snappier
  let cameraLead = 0;                 // currently-applied lead, eased toward target
  function updateCamera(dt) {
    const p = game.player;
    // Target lead points the way the cat is facing while moving. While
    // standing still, decay toward 0 so the camera doesn't stay biased.
    const moving = Math.abs(p.vx) > 0.5;
    const desiredLead = moving ? (p.facing === 'right' ? LOOK_AHEAD_PX : -LOOK_AHEAD_PX) : 0;
    cameraLead += (desiredLead - cameraLead) * Math.min(1, LOOK_AHEAD_EASE * dt);
    const target = p.x + p.w / 2 - VIEW_W / 2 + cameraLead;
    game.cameraX = Math.max(0, Math.min(WORLD_W - VIEW_W, target));
  }

  // ---- goal: settle-then-win ----
  // Touching the bed kicks off a brief 'settling' beat — the cat curls up,
  // sleep-Z particles puff out, music keeps playing for the moment — before
  // the win panel takes over. SETTLE_DUR controls the length of that beat.
  const SETTLE_DUR = 1.2;            // seconds spent in the 'settling' mode
  const SETTLE_Z_INTERVAL = 0.32;    // seconds between Z-particle spawns

  function checkGoal() {
    if (!game.goal) return;
    const p = game.player;
    // The goal sprite is 48×32; treat the bed proper as the lower 24px so
    // the cat has to actually reach the cushion.
    const gr = { x: game.goal.x, y: game.goal.y + 12, w: 48, h: 24 };
    if (rectOverlap({ x: p.x, y: p.y, w: p.w, h: p.h }, gr)) {
      // Enter the cosmetic settle phase. Keep music playing — the win
      // chime fires when the settle resolves.
      game.mode = 'settling';
      game.settleT = 0;
      game.settleZAt = 0;
      // Anchor the cat onto the bed visually so it doesn't drift.
      p.vx = 0;
      p.vy = 0;
      p.pounding = false;
      p.x = game.goal.x + 24 - p.w / 2;     // centre on the cushion
      p.state = 'idle';
    }
  }

  // Sleep Z — small drifting puff for the settle animation.
  function spawnSleepZ() {
    const p = game.player;
    if (!p) return;
    game.particles.push({
      kind: 'z',
      x: p.x + p.w * 0.55,
      y: p.y - 4,
      vx: 0.45,
      vy: -0.6,
      age: 0,
      life: 0.9,
      alive: true,
    });
  }

  function updateSettling(dt) {
    game.settleT += dt;
    // Spawn a Z roughly every SETTLE_Z_INTERVAL seconds.
    if (game.settleT - game.settleZAt > SETTLE_Z_INTERVAL) {
      spawnSleepZ();
      game.settleZAt = game.settleT;
    }
    // Settle is purely cosmetic — particles drift and decay regardless.
    updateParticles(dt);
    if (game.settleT >= SETTLE_DUR) finalizeWin();
  }

  function finalizeWin() {
    game.mode = 'win';
    game.score += game.timer * 5;
    Audio.win();
    Audio.musicStop();
    // Clear the mid-run snapshot — the run is over, the next start should
    // be from the level-select / fresh state, not mid-play.
    clearSnapshot();

    // Persist progress: best-score-on-this-level, unlock-next-level.
    if (game.score > (progress.bestScores[currentLevel] || 0)) {
      progress.bestScores[currentLevel] = game.score;
    }
    const nextLevel = currentLevel + 1;
    if (nextLevel < LEVEL_COUNT && progress.unlocked < nextLevel + 1) {
      progress.unlocked = nextLevel + 1;
    }
    persistProgress();

    // True trilogy completion: only show the leaderboard prompt on the
    // FINAL level. Earlier levels just hand off to "level complete →
    // press Space for next".
    if (currentLevel === LEVEL_COUNT - 1 && qualifiesForLeaderboard(game.score)) {
      setTimeout(showLbEntry, 800);
    }
  }

  function update(dt) {
    if (game.mode === 'playing') {
      // stage timer
      game.levelTime += dt;
      const remaining = TIMER_START - Math.floor(game.levelTime);
      game.timer = Math.max(0, remaining);
      if (game.timer <= 0) {
        gameOver();
        return;
      }

      // Panic-mode music speedup at the last 30 seconds (one-shot).
      if (game.timer < 30 && !game.tempoBoosted) {
        Audio.musicTempo(1.4);
        game.tempoBoosted = true;
      }

      updatePlayer(dt);
      updateEnemies(dt);
      updatePowerUps(dt);
      updateProjectiles(dt);
      updateCollisions(dt);
      updateItems(dt);
      updateParticles(dt);
      updateTileBumps(dt);
      updateCamera(dt);
      checkGoal();

      // Respawn fade-out (after a pit teleport) decays during play.
      if (game.respawnFadeT > 0) {
        game.respawnFadeT = Math.max(0, game.respawnFadeT - dt);
      }

      // Periodic snapshot for the mid-run resume feature.
      snapshotTimer += dt;
      if (snapshotTimer >= SNAPSHOT_INTERVAL) {
        saveSnapshot();
        snapshotTimer = 0;
      }
    } else if (game.mode === 'dying') {
      updateDying(dt);
    } else if (game.mode === 'settling') {
      updateSettling(dt);
    }
  }

  // ------ rendering ----------------------------------------------------------

  function drawSky() {
    // Pounce's sky is a cozy autumn sunset — deep dusk-purple at the top,
    // sliding through sunset orange to a peach horizon. Sets the "the cat
    // is heading home for a nap" mood that the cozy-bed goal pays off.
    const grad = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    grad.addColorStop(0,    '#3d2b5e');   // dusk indigo
    grad.addColorStop(0.45, '#c66e4a');   // sunset orange
    grad.addColorStop(0.78, '#f29b67');   // golden hour
    grad.addColorStop(1,    '#ffd9a8');   // peach horizon
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // A faint round sun low on the horizon adds a focal point; doesn't move
    // with the camera (parallax = 0) so it stays put as the cat runs.
    ctx.fillStyle = 'rgba(255, 220, 160, 0.55)';
    ctx.beginPath();
    ctx.arc(640, 360, 70, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 240, 200, 0.8)';
    ctx.beginPath();
    ctx.arc(640, 360, 48, 0, Math.PI * 2);
    ctx.fill();
  }

  // Two parallax layers: clouds (slow), then hills (faster). Cloud y values
  // bias toward the upper-third so they don't overlap the sun on the horizon.
  const CLOUDS = [
    { x: 80,   y: 30  },
    { x: 380,  y: 60  },
    { x: 700,  y: 22  },
    { x: 1050, y: 72  },
    { x: 1380, y: 40  },
    { x: 1720, y: 80  },
    { x: 2050, y: 35  },
    { x: 2400, y: 70  },
  ];

  function drawClouds() {
    const cloud = Sprites.cloud;
    for (const cdef of CLOUDS) {
      const sx = cdef.x - game.cameraX * 0.3;
      // wrap to keep clouds drawn even when scrolled past
      const wrap = WORLD_W;
      let drawX = sx;
      while (drawX < -cloud.width) drawX += wrap * 0.3 + VIEW_W;
      ctx.drawImage(cloud, Math.floor(drawX), cdef.y);
    }
  }

  function drawHills() {
    // Two layers, both silhouettes against the sunset gradient. The far
    // layer is a dusky purple so it reads as distant; the near layer is a
    // warmer evening teal-green.
    const offset = -game.cameraX * 0.5;
    ctx.fillStyle = '#5e3f6b';     // far hills — dusky purple silhouette
    for (let i = -1; i < 6; i++) {
      const baseX = i * 720 + (-game.cameraX * 0.35);
      ctx.beginPath();
      ctx.arc(baseX + 360, 470, 300, Math.PI, 0);
      ctx.fill();
    }
    ctx.fillStyle = '#5a705a';     // mid hills — evening teal-green
    for (let i = -1; i < 8; i++) {
      const baseX = i * 600 + offset;
      ctx.beginPath();
      ctx.arc(baseX + 200, 410, 180, Math.PI, 0);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(baseX + 450, 430, 230, Math.PI, 0);
      ctx.fill();
    }
    ctx.fillStyle = '#3f5440';     // close foreground hills — darker
    for (let i = -1; i < 6; i++) {
      const baseX = i * 720 + (-game.cameraX * 0.7);
      ctx.beginPath();
      ctx.arc(baseX + 360, 470, 280, Math.PI, 0);
      ctx.fill();
    }
  }

  function drawTiles() {
    const camX = Math.floor(game.cameraX);
    const startCol = Math.max(0, Math.floor(camX / TILE));
    const endCol = Math.min(W - 1, Math.ceil((camX + VIEW_W) / TILE));
    // Slow bobble between the two box-idle frames so unused boxes feel alive.
    const boxFrame = Math.floor(performance.now() / 400) % 2;
    for (let y = 0; y < H; y++) {
      for (let x = startCol; x <= endCol; x++) {
        const c = tiles[y][x];
        if (c === '.') continue;
        const sx = x * TILE - camX;
        // Box tiles can be mid-bump animation — translate up a few px.
        const bumpDy = (c === 'Q' || c === '@') ? tileBumpOffset(x, y) : 0;
        const sy = y * TILE + bumpDy;
        if (c === '#') ctx.drawImage(Sprites.grass, sx, sy);
        else if (c === '=') ctx.drawImage(Sprites.dirt, sx, sy);
        else if (c === '-') ctx.drawImage(Sprites.platform, sx, sy);
        else if (c === 'Q') ctx.drawImage(boxFrame === 0 ? Sprites.box.idle0 : Sprites.box.idle1, sx, sy);
        else if (c === '@') ctx.drawImage(Sprites.box.used, sx, sy);
      }
    }
  }

  function drawGoal() {
    if (!game.goal) return;
    const camX = Math.floor(game.cameraX);
    ctx.drawImage(Sprites.bed, game.goal.x - camX, game.goal.y);
  }

  function drawItems() {
    const camX = Math.floor(game.cameraX);
    for (const item of game.items) {
      if (!item.alive) continue;
      const sprite = item.type === 'F' ? Sprites.fish : Sprites.yarn;
      const bobY = Math.sin(item.bob) * 2;
      const dx = item.x - camX + (TILE - sprite.width) / 2;
      const dy = item.y + bobY + (TILE - sprite.height) / 2;
      ctx.drawImage(sprite, Math.floor(dx), Math.floor(dy));
    }
  }

  function drawPowerUps() {
    const camX = Math.floor(game.cameraX);
    for (const item of game.powerUps) {
      if (!item.alive) continue;
      const sprite = item.kind === 'fish' ? Sprites.magicFish : Sprites.catFoodCan;
      ctx.drawImage(sprite, Math.floor(item.x - camX), Math.floor(item.y));
    }
  }

  function drawProjectiles() {
    const camX = Math.floor(game.cameraX);
    for (const pr of game.projectiles) {
      if (!pr.alive) continue;
      const sprite = pr.frame === 0 ? Sprites.fishbone.f0 : Sprites.fishbone.f1;
      // Flip horizontally if travelling left so the skull leads.
      if (pr.vx < 0) {
        ctx.save();
        ctx.translate(Math.floor(pr.x - camX) + pr.w, Math.floor(pr.y));
        ctx.scale(-1, 1);
        ctx.drawImage(sprite, 0, 0);
        ctx.restore();
      } else {
        ctx.drawImage(sprite, Math.floor(pr.x - camX), Math.floor(pr.y));
      }
    }
  }

  // Map glyph → sprite set in Sprites.* — keeps drawEnemies short and
  // makes it trivial to swap art later (just change the mapping).
  const ENEMY_SPRITE = {
    B: Sprites.dog,    // dog
    D: Sprites.child,  // crawling child
    W: Sprites.wasp,   // wasp
  };

  function drawEnemies() {
    const camX = Math.floor(game.cameraX);
    for (const e of game.enemies) {
      if (!e.alive) continue;
      const set = ENEMY_SPRITE[e.type] || ENEMY_SPRITE.B;
      const sprite = e.stomped
        ? set.squashed
        : (e.animFrame === 0 ? set.walk0 : set.walk1);
      ctx.drawImage(sprite, Math.floor(e.x - camX), Math.floor(e.y));
    }
  }

  function drawPlayer() {
    const p = game.player;
    // Hide the cat during pit-dying (it has fallen below the world and there
    // is nothing to render).
    if (game.mode === 'dying' && game.dyingKind === 'pit') return;
    // Skip the invuln-blink during the final-death tumble so the cat stays
    // continuously visible while it spins out.
    const isDying = game.mode === 'dying' && game.dyingKind === 'final';
    if (!isDying && p.invuln > 0 && Math.floor(p.invuln * 12) % 2 === 0) return;
    // Pick the sprite set via POWER[*].sizeKey so the 'shooter' power state
    // (which has no dedicated sprite set) shares the 'big' sprites — same
    // dimensions, same look, plus the magic-fish HUD pip telling the
    // player they can shoot.
    const dims = POWER[p.power];
    const set = Sprites.cats[selectedCat][dims.sizeKey];
    let sprite;
    if (isDying)                  sprite = set.hurt;
    else if (p.state === 'jump')  sprite = set.jump;
    else if (p.state === 'fall')  sprite = set.fall;
    else if (p.state === 'run')   sprite = p.animFrame === 0 ? set.run0 : set.run1;
    else                          sprite = set.idle;
    // Centre the sprite horizontally on the hitbox; align the bottom of the
    // sprite (where the cat's paws are) with the bottom of the hitbox.
    // (`dims` was resolved up above when we chose the sprite set.)
    const offX = (dims.spriteW - p.w) / 2;
    const offY = dims.spriteH - p.h;
    // Subtle vertical bob during run — sells "actually running" without a
    // side-view sprite cycle. Two-pixel amplitude, frequency synced to the
    // run animation so the body lifts on each step.
    const bobY = (p.state === 'run' && p.onGround)
      ? Math.round(Math.abs(Math.sin(p.animTimer * 16)) * -2)
      : 0;
    const sx = Math.floor(p.x - game.cameraX - offX);
    const sy = Math.floor(p.y - offY + bobY);
    // Pulse scale briefly when transitioning between sizes.
    if (p.powerXfade > 0) {
      ctx.save();
      const pulse = 1 + Math.sin(p.powerXfade * Math.PI * 2.5) * 0.05;
      ctx.translate(sx + dims.spriteW / 2, sy + dims.spriteH / 2);
      ctx.scale(pulse, pulse);
      ctx.translate(-dims.spriteW / 2, -dims.spriteH / 2);
      ctx.drawImage(sprite, 0, 0);
      ctx.restore();
    } else {
      ctx.drawImage(sprite, sx, sy);
    }
  }

  // ------ HUD + screen overlays ---------------------------------------------
  function drawHUD() {
    // top bar
    ctx.fillStyle = 'rgba(20, 20, 30, 0.55)';
    ctx.fillRect(0, 0, VIEW_W, 36);
    ctx.fillStyle = '#ffd166';
    ctx.font = 'bold 16px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    // lives — small cat-head icons (one per remaining life)
    ctx.fillStyle = '#fff';
    ctx.fillText('LIVES', 12, 18);
    for (let i = 0; i < game.lives; i++) {
      ctx.drawImage(Sprites.catHead, 80 + i * 18, 10);
    }

    ctx.fillText(
      `TREATS  ${game.collected}/${game.totalCollectibles}`,
      230,
      18
    );
    // Session-best — track and surface a small "BEST" pip next to SCORE so
    // the player can see if this run is on track to beat the previous one.
    // The pip flips to a brighter highlight colour while `score > prev best`.
    if (game.score > sessionBest) sessionBest = game.score;
    const beatingBest = game.score > 0 && game.score >= sessionBest;
    ctx.fillStyle = '#fff';
    ctx.fillText(`SCORE  ${game.score}`, 410, 18);
    ctx.font = 'bold 12px ui-monospace, Menlo, monospace';
    ctx.fillStyle = beatingBest ? '#ffd166' : 'rgba(255,255,255,0.55)';
    ctx.fillText(`BEST  ${sessionBest}`, 560, 18);
    ctx.font = 'bold 16px ui-monospace, Menlo, monospace';
    ctx.fillStyle = game.timer < 30 ? '#ff8b8b' : '#fff';
    ctx.fillText(`TIME  ${game.timer}`, 660, 18);

    // Shooter indicator — a tiny magic-fish icon below the lives row when
    // the cat is in the shooter state, with the X-key reminder.
    if (game.player && game.player.power === 'shooter') {
      ctx.drawImage(Sprites.magicFish, 12, 40);
      ctx.fillStyle = '#84e36b';
      ctx.font = 'bold 12px ui-monospace, Menlo, monospace';
      ctx.fillText('X = SHOOT', 40, 47);
    }
  }

  function drawCenteredText(lines, options = {}) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let y = options.startY != null ? options.startY : VIEW_H / 2 - lines.length * 22;
    for (const line of lines) {
      ctx.font = line.font || '18px ui-monospace, monospace';
      ctx.fillStyle = line.color || '#ffffff';
      if (line.shadow) {
        ctx.fillStyle = '#000000';
        ctx.fillText(line.text, VIEW_W / 2 + 2, y + 2);
        ctx.fillStyle = line.color || '#ffffff';
      }
      ctx.fillText(line.text, VIEW_W / 2, y);
      y += line.gap || 32;
    }
    ctx.restore();
  }

  // ---- Cat picker geometry (intro screen) ----
  // Four swatches drawn in a row, centred horizontally.
  const SWATCH_W = 90;
  const SWATCH_H = 90;
  const SWATCH_GAP = 14;
  const SWATCH_Y = 130;
  function swatchX(i) {
    const total = Sprites.catNames.length * SWATCH_W +
                  (Sprites.catNames.length - 1) * SWATCH_GAP;
    const startX = (VIEW_W - total) / 2;
    return startX + i * (SWATCH_W + SWATCH_GAP);
  }

  // ---- Level chips geometry (intro screen) ----
  const CHIP_W = 132;
  const CHIP_H = 50;
  const CHIP_GAP = 14;
  const CHIP_Y = 268;
  function chipX(i) {
    const total = LEVEL_COUNT * CHIP_W + (LEVEL_COUNT - 1) * CHIP_GAP;
    const startX = (VIEW_W - total) / 2;
    return startX + i * (CHIP_W + CHIP_GAP);
  }
  function levelLabel(i) {
    return (window.LEVELS && window.LEVELS[i] && window.LEVELS[i].label) || ('LEVEL ' + (i + 1));
  }
  function levelUnlocked(i) {
    return i < progress.unlocked;
  }

  // ---- Difficulty chips geometry (intro screen) ----
  const DCHIP_W = 100;
  const DCHIP_H = 32;
  const DCHIP_GAP = 14;
  const DCHIP_Y = 348;
  function dchipX(i) {
    const total = DIFFICULTY_ORDER.length * DCHIP_W + (DIFFICULTY_ORDER.length - 1) * DCHIP_GAP;
    const startX = (VIEW_W - total) / 2;
    return startX + i * (DCHIP_W + DCHIP_GAP);
  }

  // Pixel padlock — small icon used on locked level chips. Drawn directly
  // with rect primitives so we don't need a sprite import. (cx, cy) is the
  // centre of the lock body.
  function drawPadlock(cx, cy) {
    ctx.save();
    // Shackle (the U-curve at the top): two vertical bars + a top bar.
    ctx.strokeStyle = '#8a8294';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 4, cy - 1);
    ctx.lineTo(cx - 4, cy - 6);
    ctx.lineTo(cx + 4, cy - 6);
    ctx.lineTo(cx + 4, cy - 1);
    ctx.stroke();
    // Body block.
    ctx.fillStyle = '#6a6573';
    ctx.fillRect(cx - 6, cy - 1, 12, 9);
    // Keyhole highlight.
    ctx.fillStyle = '#33303a';
    ctx.fillRect(cx - 1, cy + 2, 2, 4);
    ctx.restore();
  }

  function drawIntro() {
    ctx.fillStyle = 'rgba(15, 20, 38, 0.88)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Tagline only — the bezel above already brands the page POUNCE.
    ctx.font = '13px ui-monospace, monospace';
    ctx.fillStyle = '#dfe6f0';
    ctx.fillText('Help your cat reach the cozy bed across three levels.', VIEW_W / 2, 60);

    // "Pick your cat" prompt — small caption only, no per-cat name labels
    // (the swatches read clearly on their own).
    ctx.font = 'bold 12px ui-monospace, monospace';
    ctx.fillStyle = '#84e36b';
    ctx.fillText('PICK YOUR CAT', VIEW_W / 2, 100);

    // Cat swatches
    for (let i = 0; i < Sprites.catNames.length; i++) {
      const name = Sprites.catNames[i];
      const palette = Sprites.catPalettes[name];
      const x = swatchX(i);
      const selected = name === selectedCat;

      ctx.fillStyle = selected ? 'rgba(255, 209, 102, 0.18)' : 'rgba(0, 0, 0, 0.35)';
      ctx.fillRect(x, SWATCH_Y, SWATCH_W, SWATCH_H);

      ctx.lineWidth = selected ? 3 : 1.5;
      ctx.strokeStyle = selected ? '#ffd166' : 'rgba(255, 255, 255, 0.25)';
      ctx.strokeRect(
        x + ctx.lineWidth / 2,
        SWATCH_Y + ctx.lineWidth / 2,
        SWATCH_W - ctx.lineWidth,
        SWATCH_H - ctx.lineWidth
      );

      Sprites.drawCat(
        ctx,
        x + SWATCH_W / 2,
        SWATCH_Y + SWATCH_H / 2 + 8,
        2.7,
        palette,
        { pose: 'front' }
      );
    }

    // ----- Level chips -----
    ctx.font = 'bold 12px ui-monospace, monospace';
    ctx.fillStyle = '#84e36b';
    ctx.fillText('PICK A LEVEL', VIEW_W / 2, CHIP_Y - 16);

    for (let i = 0; i < LEVEL_COUNT; i++) {
      const x = chipX(i);
      const unlocked = levelUnlocked(i);
      const selected = i === currentLevel;
      const best = (progress.bestScores && progress.bestScores[i]) || 0;

      // background
      ctx.fillStyle = !unlocked
        ? 'rgba(0, 0, 0, 0.5)'
        : (selected ? 'rgba(255, 209, 102, 0.22)' : 'rgba(0, 0, 0, 0.35)');
      ctx.fillRect(x, CHIP_Y, CHIP_W, CHIP_H);

      // border
      ctx.lineWidth = selected ? 3 : 1.5;
      ctx.strokeStyle = !unlocked
        ? 'rgba(120, 120, 130, 0.35)'
        : (selected ? '#ffd166' : 'rgba(255, 255, 255, 0.25)');
      ctx.strokeRect(
        x + ctx.lineWidth / 2,
        CHIP_Y + ctx.lineWidth / 2,
        CHIP_W - ctx.lineWidth,
        CHIP_H - ctx.lineWidth
      );

      // label
      ctx.font = 'bold 11px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = !unlocked ? '#6a6573' : (selected ? '#ffd166' : '#dfe6f0');
      ctx.fillText('LEVEL ' + (i + 1), x + CHIP_W / 2, CHIP_Y + 14);
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillStyle = !unlocked ? '#6a6573' : (selected ? '#fff8e8' : '#9aa6bf');
      ctx.fillText(levelLabel(i), x + CHIP_W / 2, CHIP_Y + 30);

      // best-score line, or padlock for locked, or nothing for first-play
      if (!unlocked) {
        drawPadlock(x + CHIP_W / 2, CHIP_Y + 42);
      } else if (best > 0) {
        ctx.font = '10px ui-monospace, monospace';
        ctx.fillStyle = '#84e36b';
        ctx.fillText('BEST  ' + best, x + CHIP_W / 2, CHIP_Y + 44);
      }
    }

    // ----- Difficulty chips ----- single label only, no descriptive blurb
    for (let i = 0; i < DIFFICULTY_ORDER.length; i++) {
      const key = DIFFICULTY_ORDER[i];
      const cfg = DIFFICULTY[key];
      const x = dchipX(i);
      const selected = key === difficulty;

      ctx.fillStyle = selected ? 'rgba(132, 227, 107, 0.22)' : 'rgba(0, 0, 0, 0.35)';
      ctx.fillRect(x, DCHIP_Y, DCHIP_W, DCHIP_H);

      ctx.lineWidth = selected ? 3 : 1.5;
      ctx.strokeStyle = selected ? '#84e36b' : 'rgba(255, 255, 255, 0.25)';
      ctx.strokeRect(
        x + ctx.lineWidth / 2,
        DCHIP_Y + ctx.lineWidth / 2,
        DCHIP_W - ctx.lineWidth,
        DCHIP_H - ctx.lineWidth
      );

      ctx.font = 'bold 11px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = selected ? '#84e36b' : '#dfe6f0';
      ctx.fillText(cfg.label, x + DCHIP_W / 2, DCHIP_Y + DCHIP_H / 2);
    }

    // Bottom prompt — switches between "start fresh" and "resume" depending
    // on whether there's a snapshot waiting from a previous session.
    ctx.font = 'bold 13px ui-monospace, monospace';
    ctx.textAlign = 'center';
    if (pendingSnapshot) {
      ctx.fillStyle = '#84e36b';
      ctx.fillText('SPACE = RESUME  ·  R = FRESH START', VIEW_W / 2, 420);
    } else {
      ctx.fillStyle = '#fff';
      ctx.fillText('PRESS SPACE TO START', VIEW_W / 2, 420);
    }

    ctx.restore();
  }

  // Convert a mouse event to canvas-internal coordinates, accounting for any
  // CSS scaling on the canvas element.
  function eventToCanvas(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    return { x, y };
  }

  // Hit-test a swatch on the intro screen. Returns the cat name or null.
  function hitTestSwatch(x, y) {
    if (y < SWATCH_Y || y > SWATCH_Y + SWATCH_H) return null;
    for (let i = 0; i < Sprites.catNames.length; i++) {
      const sx = swatchX(i);
      if (x >= sx && x <= sx + SWATCH_W) return Sprites.catNames[i];
    }
    return null;
  }
  // Hit-test a level chip on the intro screen. Returns 0..LEVEL_COUNT-1 or -1.
  function hitTestChip(x, y) {
    if (y < CHIP_Y || y > CHIP_Y + CHIP_H) return -1;
    for (let i = 0; i < LEVEL_COUNT; i++) {
      const sx = chipX(i);
      if (x >= sx && x <= sx + CHIP_W) return i;
    }
    return -1;
  }
  // Hit-test a difficulty chip. Returns difficulty key (string) or null.
  function hitTestDifficulty(x, y) {
    if (y < DCHIP_Y || y > DCHIP_Y + DCHIP_H) return null;
    for (let i = 0; i < DIFFICULTY_ORDER.length; i++) {
      const sx = dchipX(i);
      if (x >= sx && x <= sx + DCHIP_W) return DIFFICULTY_ORDER[i];
    }
    return null;
  }

  canvas.addEventListener('click', (e) => {
    if (game.mode !== 'intro') return;
    const { x, y } = eventToCanvas(e);
    const name = hitTestSwatch(x, y);
    if (name) {
      selectedCat = name;
      persistCat();
      return;
    }
    const lv = hitTestChip(x, y);
    if (lv >= 0 && levelUnlocked(lv)) {
      currentLevel = lv;
      persistCurrentLevel();
      return;
    }
    const diff = hitTestDifficulty(x, y);
    if (diff) {
      difficulty = diff;
      persistDifficulty();
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    if (game.mode !== 'intro') { canvas.style.cursor = 'crosshair'; return; }
    const { x, y } = eventToCanvas(e);
    if (hitTestSwatch(x, y)) { canvas.style.cursor = 'pointer'; return; }
    const lv = hitTestChip(x, y);
    if (lv >= 0 && levelUnlocked(lv)) { canvas.style.cursor = 'pointer'; return; }
    canvas.style.cursor = hitTestDifficulty(x, y) ? 'pointer' : 'crosshair';
  });

  function drawPaused() {
    ctx.fillStyle = 'rgba(15, 12, 28, 0.92)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Title
    ctx.font = 'bold 36px ui-monospace, monospace';
    ctx.fillStyle = '#000';
    ctx.fillText('PAUSED', VIEW_W / 2 + 2, 70);
    ctx.fillStyle = '#ffd166';
    ctx.fillText('PAUSED', VIEW_W / 2, 68);

    // Active cat preview (uses current power state so big/shooter shows up
    // proudly rather than reverting to the small idle). Resolve via
    // POWER[*].sizeKey so 'shooter' falls back to the 'big' sprite set
    // — there is no dedicated 'shooter' bake.
    if (game.player) {
      const dims = POWER[game.player.power] || POWER.small;
      const set = Sprites.cats[selectedCat] && Sprites.cats[selectedCat][dims.sizeKey];
      if (set && set.idle) {
        const sprite = set.idle;
        ctx.drawImage(sprite, VIEW_W / 2 - sprite.width / 2, 100);
      }
    }

    // Controls block — two columns of action / keys.
    ctx.font = 'bold 13px ui-monospace, monospace';
    const rows = [
      ['MOVE',     'A / D  or  ← / →'],
      ['SPRINT',   'Shift  (faster + bigger jumps)'],
      ['JUMP',     'W  ↑  Space'],
      ['POUNCE',   'S  ↓   (in mid-air)'],
      ['SHOOT',    'X     (when powered)'],
      ['PAUSE',    'P'],
      ['RESTART',  'R  ·  Enter'],
      ['MUSIC',    'M     (' + (musicEnabled ? 'on' : 'off') + ')'],
      ['SOUND FX', 'N     (' + (sfxEnabled   ? 'on' : 'off') + ')'],
    ];
    const blockTop = 200;
    const lineH = 22;
    const labelX = VIEW_W / 2 - 20;
    const valueX = VIEW_W / 2 + 20;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#84e36b';
    rows.forEach((r, i) => ctx.fillText(r[0], labelX, blockTop + i * lineH));
    ctx.textAlign = 'left';
    ctx.fillStyle = '#dfe6f0';
    rows.forEach((r, i) => ctx.fillText(r[1], valueX, blockTop + i * lineH));

    // Bottom prompt
    ctx.textAlign = 'center';
    ctx.font = 'bold 16px ui-monospace, monospace';
    ctx.fillStyle = '#fff';
    ctx.fillText('Press P to resume', VIEW_W / 2, VIEW_H - 32);

    ctx.restore();
  }

  function drawDead() {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    drawCenteredText(
      [
        { text: 'GAME OVER',
          font: 'bold 40px ui-monospace, monospace',
          color: '#ff8b8b', shadow: true, gap: 50 },
        { text: `Score: ${game.score}`, color: '#fff', gap: 32 },
        { text: `Treats: ${game.collected} / ${game.totalCollectibles}`,
          color: '#fff', gap: 60 },
        { text: 'Press R or ENTER to try again',
          font: 'bold 18px ui-monospace, monospace', color: '#84e36b' },
      ],
      { startY: 140 }
    );
  }

  function drawWin() {
    ctx.fillStyle = 'rgba(15, 40, 60, 0.85)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    const isFinal = currentLevel === LEVEL_COUNT - 1;
    const titleText = isFinal ? 'TRILOGY COMPLETE!' : 'LEVEL COMPLETE!';
    const flavor = isFinal
      ? 'The cat made it home. Time to nap forever.'
      : `Cleared ${(window.LEVELS && window.LEVELS[currentLevel] && window.LEVELS[currentLevel].label) || 'this level'}!`;
    const action = isFinal
      ? 'Press R or ENTER to play again'
      : 'Press SPACE / ENTER for the next level';

    drawCenteredText(
      [
        { text: titleText,
          font: 'bold 36px ui-monospace, monospace',
          color: '#84e36b', shadow: true, gap: 46 },
        { text: flavor, color: '#fff', gap: 36 },
        { text: `Treats     ${game.collected} / ${game.totalCollectibles}`,
          color: '#fff', gap: 26 },
        { text: `Time bonus  ${game.timer * 5}`, color: '#fff', gap: 26 },
        { text: `Score      ${game.score}`,
          font: 'bold 20px ui-monospace, monospace',
          color: '#ffd166', gap: 50 },
        { text: action,
          font: 'bold 18px ui-monospace, monospace', color: '#fff' },
      ],
      { startY: 100 }
    );
  }

  function drawFlash() {
    if (game.flash <= 0) return;
    ctx.fillStyle = `rgba(255, 255, 255, ${game.flash * 4})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  function render() {
    // Camera shake is applied as a translate ONLY around the world layers.
    // The HUD and overlays draw on top in screen space so they stay rock-
    // steady — shaking the score readout looks like a bug, not a feature.
    let shx = 0, shy = 0;
    if (game.shakeT > 0 && game.shakeAmp > 0) {
      shx = (Math.random() - 0.5) * 2 * game.shakeAmp;
      shy = (Math.random() - 0.5) * 2 * game.shakeAmp;
    }

    ctx.save();
    if (shx || shy) ctx.translate(shx, shy);
    drawSky();
    drawClouds();
    drawHills();
    drawTiles();
    drawGoal();
    drawItems();
    drawPowerUps();
    drawProjectiles();
    drawEnemies();
    drawParticles();
    drawPlayer();
    drawFlash();
    ctx.restore();

    // Death-and-respawn fades. Drawn over the world but UNDER the HUD so
    // the score / lives counter stay legible while the world goes dark.
    if (game.mode === 'dying') {
      let alpha = 0;
      if (game.dyingKind === 'final') {
        // Linear fade up to 70% over the full tumble.
        alpha = Math.min(0.7, (game.dyingT / 1.6) * 0.7);
      } else {
        // Pit: fade fast to mostly-black before the teleport.
        alpha = Math.min(1, game.dyingT / 0.35);
      }
      ctx.fillStyle = `rgba(8, 6, 16, ${alpha})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);

      // "OOF!" / death text on the final tumble.
      if (game.dyingKind === 'final' && game.dyingT > 0.4) {
        const titleA = Math.min(1, (game.dyingT - 0.4) / 0.4);
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 48px ui-monospace, monospace';
        ctx.fillStyle = `rgba(0, 0, 0, ${titleA})`;
        ctx.fillText('YOU DIED', VIEW_W / 2 + 3, VIEW_H / 2 + 3);
        ctx.fillStyle = `rgba(255, 107, 107, ${titleA})`;
        ctx.fillText('YOU DIED', VIEW_W / 2, VIEW_H / 2);
        ctx.restore();
      }
    }
    if (game.respawnFadeT > 0) {
      // Fade-out from black after a pit respawn.
      const a = game.respawnFadeT / 0.35;
      ctx.fillStyle = `rgba(8, 6, 16, ${a})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }

    drawHUD();

    if (game.mode === 'intro') drawIntro();
    else if (game.mode === 'paused') drawPaused();
    else if (game.mode === 'dead') drawDead();
    else if (game.mode === 'win') drawWin();
  }

  // ------ main loop ----------------------------------------------------------
  let lastTime = 0;
  // ------ gamepad polling ----------------------------------------------------
  // Map standard-layout gamepad axes/buttons into the same `keys` map the
  // keyboard + touch controls write to. Polled once per frame.
  //
  //   left stick X / D-pad  →  arrowleft / arrowright
  //   left stick Y / D-pad  →  arrowdown   (for down-pounce)
  //   button 0 (A / Cross)  →  ' '         (jump)
  //   button 2 (X / Square) →  'x'         (shoot fishbone)
  //   button 1 (B / Circle) →  'arrowdown' (alt pounce)
  //   start (button 9)      →  'enter'     (restart / advance level)
  //   select (button 8)     →  'p'         (pause)
  //
  // We track which keys the gamepad set last frame, and only ever clear
  // those — that way a held keyboard key doesn't get accidentally cleared.
  const GP_DEAD = 0.3;             // analog dead-zone
  const gpHeld = Object.create(null);
  function pollGamepad() {
    const gps = (typeof navigator.getGamepads === 'function')
      ? navigator.getGamepads() : [];
    let gp = null;
    for (const g of gps) { if (g) { gp = g; break; } }
    if (!gp) {
      // No gamepad connected — clear anything we'd previously set.
      for (const k in gpHeld) { if (gpHeld[k]) { keys[k] = false; gpHeld[k] = false; } }
      return;
    }
    Audio.resume();                // first gamepad input unlocks audio
    const desired = Object.create(null);
    const ax = gp.axes[0] || 0;
    const ay = gp.axes[1] || 0;
    const dpadL = !!(gp.buttons[14] && gp.buttons[14].pressed);
    const dpadR = !!(gp.buttons[15] && gp.buttons[15].pressed);
    const dpadU = !!(gp.buttons[12] && gp.buttons[12].pressed);
    const dpadD = !!(gp.buttons[13] && gp.buttons[13].pressed);
    if (ax < -GP_DEAD || dpadL) desired['arrowleft']  = true;
    if (ax >  GP_DEAD || dpadR) desired['arrowright'] = true;
    if (ay >  GP_DEAD || dpadD) desired['arrowdown']  = true;
    if (ay < -GP_DEAD || dpadU) desired['arrowup']    = true;
    if (gp.buttons[0] && gp.buttons[0].pressed) desired[' '] = true;       // A → jump
    if (gp.buttons[2] && gp.buttons[2].pressed) desired['x'] = true;       // X → shoot
    if (gp.buttons[1] && gp.buttons[1].pressed) desired['arrowdown'] = true; // B → pounce
    if (gp.buttons[7] && gp.buttons[7].pressed) desired['gamepadsprint'] = true; // RT → sprint
    if (gp.buttons[9] && gp.buttons[9].pressed) desired['enter'] = true;   // start
    if (gp.buttons[8] && gp.buttons[8].pressed) desired['p']     = true;   // select

    // Set new presses.
    for (const k in desired) {
      if (!gpHeld[k]) keys[k] = true;
      gpHeld[k] = true;
    }
    // Clear keys the gamepad let go of.
    for (const k in gpHeld) {
      if (gpHeld[k] && !desired[k]) {
        keys[k] = false;
        gpHeld[k] = false;
      }
    }
  }

  function frame(now) {
    if (!lastTime) lastTime = now;
    // Clamp dt to 50 ms so backgrounded tabs don't simulate huge time steps
    // (which would tunnel the player through tiles). Multiply by the
    // game-speed multiplier last so the slider scales the entire
    // simulation but input polling and rendering still run at native
    // wall-clock framerate.
    const dt = Math.min(0.05, (now - lastTime) / 1000) * gameSpeed;
    lastTime = now;
    pollGamepad();
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  loadLevel();
  requestAnimationFrame(frame);
})();
