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
  const ASCEND_GRAV = 0.275; // softer gravity while ascending + jump held -> variable height
  const MOVE_ACC = 0.6;
  const FRICTION = 0.85;
  const MAX_RUN = 3.6;
  const JUMP_VEL = 10;
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
    btn.textContent = musicEnabled ? '♪ MUSIC ON' : '♪ MUSIC OFF';
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
    btn.textContent = sfxEnabled ? '◎ FX ON' : '◎ FX OFF';
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

  const TIMER_START = 200; // seconds — stage timer
  const START_LIVES = 3;

  // ------ canvas + state -----------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // Make the canvas focusable so that key events feel anchored to it,
  // and so the page doesn't scroll when arrow keys are pressed.
  canvas.tabIndex = 0;
  canvas.addEventListener('mousedown', () => canvas.focus());

  const W = window.LEVEL_WIDTH;
  const H = window.LEVEL_HEIGHT;
  const WORLD_W = W * TILE;
  const WORLD_H = H * TILE;

  // Mutable level grid (array of arrays of single chars). Built fresh in
  // loadLevel() so restart works.
  let tiles = null;

  const game = {
    mode: 'intro',          // intro | playing | paused | dying | dead | win
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
    flash: 0,               // brief screen flash on stomp (cosmetic)
    shakeT: 0,              // remaining shake duration in seconds
    shakeAmp: 0,            // shake amplitude in pixels
    dyingT: 0,              // time spent in 'dying' mode
    dyingKind: null,        // 'final' (game over) | 'pit' (lose-a-life respawn)
    respawnFadeT: 0,        // black-fade-out timer after respawning at start
    deathTimer: 0,
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
    const e = {
      type,
      x: px,
      y: py,
      w: dims.w,
      h: dims.h,
      vx: dims.vx,
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
    tiles = window.LEVEL.map((row) => row.split(''));

    game.enemies = [];
    game.items = [];
    game.powerUps = [];
    game.projectiles = [];
    game.particles = [];
    game.totalCollectibles = 0;
    game.goal = null;

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
    game.cameraX = 0;
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

    // Audio toggles short-circuit BEFORE any mode-specific routing so they
    // work instantly in any mode, including the intro screen and game-over.
    if (k === 'm') { toggleMusic(); return; }
    if (k === 'n') { toggleSfx();   return; }

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
      // Any "start" key launches the run.
      if (
        k === ' ' || k === 'enter' || k === 'w' || k === 'arrowup' ||
        k === 's' || k === 'arrowdown'
      ) {
        game.mode = 'playing';
        tryStartMusic();
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

  function leftKey()  { return !!(keys['a'] || keys['arrowleft']); }
  function rightKey() { return !!(keys['d'] || keys['arrowright']); }
  function jumpKey()  { return !!(keys['w'] || keys['arrowup'] || keys[' ']); }
  function shootKey() { return !!(keys['x'] || keys['j']); }
  function downKey()  { return !!(keys['s'] || keys['arrowdown']); }

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
    const downPressed = downKey() && !p.prevDown;
    p.prevDown = downKey();
    if (downPressed && !p.onGround && !p.pounding && p.poundLockout === 0) {
      p.pounding = true;
      p.vy = POUND_VY;
      p.vx = 0;
      Audio.pound();
    }

    // --- horizontal input + acceleration ---
    // Pounce locks horizontal control until the cat lands.
    if (!p.pounding) {
      if (leftKey()) {
        p.vx -= MOVE_ACC;
        p.facing = 'left';
      }
      if (rightKey()) {
        p.vx += MOVE_ACC;
        p.facing = 'right';
      }
      if (!leftKey() && !rightKey()) {
        p.vx *= FRICTION;
        if (Math.abs(p.vx) < 0.1) p.vx = 0;
      }
      if (p.vx > MAX_RUN) p.vx = MAX_RUN;
      if (p.vx < -MAX_RUN) p.vx = -MAX_RUN;
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
      p.vy = -JUMP_VEL;
      p.onGround = false;
      p.coyote = 0;
      p.jumpBuffer = 0;
      Audio.jump();
    }

    // --- gravity (variable jump: lighter while ascending + jump held) ---
    if (p.pounding) {
      // Pounce holds the slam speed; standard gravity would slow it.
      p.vy = Math.max(p.vy, POUND_VY);
    } else {
      const ascending = p.vy < 0 && jumpKey();
      p.vy += ascending ? ASCEND_GRAV : GRAVITY;
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

  function drawParticles() {
    const camX = Math.floor(game.cameraX);
    for (const par of game.particles) {
      if (!par.alive) continue;
      const t = par.age / par.life;
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
    game.lives--;
    Audio.hurt();
    if (game.lives <= 0) {
      gameOver();
      return;
    }
    // Knockback away from facing direction.
    p.vy = -7;
    p.vx = p.facing === 'right' ? -3 : 3;
    p.invuln = 1.5;
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

  function updateCamera() {
    const p = game.player;
    const target = p.x + p.w / 2 - VIEW_W / 2;
    game.cameraX = Math.max(0, Math.min(WORLD_W - VIEW_W, target));
  }

  function checkGoal() {
    if (!game.goal) return;
    const p = game.player;
    // The goal sprite is 48×32; treat the bed proper as the lower 24px so
    // the cat has to actually reach the cushion.
    const gr = { x: game.goal.x, y: game.goal.y + 12, w: 48, h: 24 };
    if (rectOverlap({ x: p.x, y: p.y, w: p.w, h: p.h }, gr)) {
      game.mode = 'win';
      game.score += game.timer * 5;
      Audio.win();
      Audio.musicStop();
      if (qualifiesForLeaderboard(game.score)) {
        setTimeout(showLbEntry, 800);
      }
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
      updateCamera();
      checkGoal();

      // Respawn fade-out (after a pit teleport) decays during play.
      if (game.respawnFadeT > 0) {
        game.respawnFadeT = Math.max(0, game.respawnFadeT - dt);
      }
    } else if (game.mode === 'dying') {
      updateDying(dt);
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
        const sy = y * TILE;
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
    ctx.fillText(`SCORE  ${game.score}`, 460, 18);
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
  const SWATCH_W = 100;
  const SWATCH_H = 100;
  const SWATCH_GAP = 18;
  const SWATCH_Y = 240;
  function swatchX(i) {
    const total = Sprites.catNames.length * SWATCH_W +
                  (Sprites.catNames.length - 1) * SWATCH_GAP;
    const startX = (VIEW_W - total) / 2;
    return startX + i * (SWATCH_W + SWATCH_GAP);
  }

  function drawIntro() {
    ctx.fillStyle = 'rgba(15, 20, 38, 0.85)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // Title
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 32px ui-monospace, monospace';
    ctx.fillStyle = '#000';
    ctx.fillText("POUNCE", VIEW_W / 2 + 2, 56);
    ctx.fillStyle = '#ffd166';
    ctx.fillText("POUNCE", VIEW_W / 2, 54);

    ctx.font = '15px ui-monospace, monospace';
    ctx.fillStyle = '#dfe6f0';
    ctx.fillText('Help your cat reach the cozy bed.', VIEW_W / 2, 92);
    ctx.fillText('Pounce bugs, dodge dust bunnies, collect treats.', VIEW_W / 2, 114);

    // "Pick your cat" prompt
    ctx.font = 'bold 16px ui-monospace, monospace';
    ctx.fillStyle = '#84e36b';
    ctx.fillText('PICK YOUR CAT', VIEW_W / 2, 168);
    ctx.font = '12px ui-monospace, monospace';
    ctx.fillStyle = '#9aa6bf';
    ctx.fillText('← / → to choose · click to select · SPACE to start', VIEW_W / 2, 192);

    // Swatches
    for (let i = 0; i < Sprites.catNames.length; i++) {
      const name = Sprites.catNames[i];
      const palette = Sprites.catPalettes[name];
      const x = swatchX(i);
      const selected = name === selectedCat;

      // background
      ctx.fillStyle = selected ? 'rgba(255, 209, 102, 0.18)' : 'rgba(0, 0, 0, 0.35)';
      ctx.fillRect(x, SWATCH_Y, SWATCH_W, SWATCH_H);

      // border
      ctx.lineWidth = selected ? 3 : 1.5;
      ctx.strokeStyle = selected ? '#ffd166' : 'rgba(255, 255, 255, 0.25)';
      ctx.strokeRect(
        x + ctx.lineWidth / 2,
        SWATCH_Y + ctx.lineWidth / 2,
        SWATCH_W - ctx.lineWidth,
        SWATCH_H - ctx.lineWidth
      );

      // cat preview, drawn live so it animates with the lean if we want later
      Sprites.drawCat(
        ctx,
        x + SWATCH_W / 2,
        SWATCH_Y + SWATCH_H / 2 + 14,
        3.0,
        palette,
        { pose: 'front' }
      );

      // name label
      ctx.font = 'bold 12px ui-monospace, monospace';
      ctx.fillStyle = selected ? '#ffd166' : '#dfe6f0';
      ctx.textAlign = 'center';
      ctx.fillText(Sprites.catLabels[name], x + SWATCH_W / 2, SWATCH_Y + SWATCH_H - 8);
    }

    // Bottom prompt
    ctx.font = 'bold 18px ui-monospace, monospace';
    ctx.fillStyle = '#fff';
    ctx.fillText('Press SPACE / W / Up to start', VIEW_W / 2, 384);

    ctx.font = '12px ui-monospace, monospace';
    ctx.fillStyle = '#84e36b';
    ctx.fillText('A/D or arrows to move · W/↑/Space to jump · S/↓ to down-pounce · X to shoot · P pause · M music · N FX',
                 VIEW_W / 2, 432);
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

  canvas.addEventListener('click', (e) => {
    if (game.mode !== 'intro') return;
    const { x, y } = eventToCanvas(e);
    const name = hitTestSwatch(x, y);
    if (name) {
      selectedCat = name;
      persistCat();
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    if (game.mode !== 'intro') { canvas.style.cursor = 'crosshair'; return; }
    const { x, y } = eventToCanvas(e);
    canvas.style.cursor = hitTestSwatch(x, y) ? 'pointer' : 'crosshair';
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
    drawCenteredText(
      [
        { text: 'LEVEL COMPLETE!',
          font: 'bold 40px ui-monospace, monospace',
          color: '#84e36b', shadow: true, gap: 50 },
        { text: 'The cat found a cozy spot to nap.',
          color: '#fff', gap: 40 },
        { text: `Treats     ${game.collected} / ${game.totalCollectibles}`,
          color: '#fff', gap: 28 },
        { text: `Time bonus  ${game.timer * 5}`, color: '#fff', gap: 28 },
        { text: `Final score ${game.score}`,
          font: 'bold 20px ui-monospace, monospace',
          color: '#ffd166', gap: 60 },
        { text: 'Press R or ENTER to play again',
          font: 'bold 18px ui-monospace, monospace', color: '#fff' },
      ],
      { startY: 110 }
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
  function frame(now) {
    if (!lastTime) lastTime = now;
    // Clamp dt to 50 ms so backgrounded tabs don't simulate huge time steps
    // (which would tunnel the player through tiles).
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  loadLevel();
  requestAnimationFrame(frame);
})();
