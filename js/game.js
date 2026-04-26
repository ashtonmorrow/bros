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

  const PLAYER_W = 20;
  const PLAYER_H = 22;
  // Cat sprite is 56×48 (vector cat baked into a canvas) — much bigger than
  // the hitbox; we draw it offset so the cat's paws sit on the hitbox bottom.
  const PLAYER_SPRITE_W = 56;
  const PLAYER_SPRITE_H = 48;
  const SPRITE_OFFSET_X = (PLAYER_SPRITE_W - PLAYER_W) / 2;   // 18
  const SPRITE_OFFSET_Y = PLAYER_SPRITE_H - PLAYER_H;         // 26 (paws to feet)

  // Which cat palette is selected. Persisted across sessions in localStorage.
  // Defaults to 'tabby' (Whiskers, the original).
  const CAT_STORAGE_KEY = 'whiskers_cat';
  let selectedCat = 'tabby';
  try {
    const saved = localStorage.getItem(CAT_STORAGE_KEY);
    if (saved && Sprites.cats[saved]) selectedCat = saved;
  } catch (e) { /* localStorage may be disabled — that's fine */ }
  function persistCat() {
    try { localStorage.setItem(CAT_STORAGE_KEY, selectedCat); } catch (e) {}
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
    flash: 0,               // brief screen flash on stomp (cosmetic)
    deathTimer: 0,
  };

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
    return c === '#' || c === '=' || c === '-';
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
      w: PLAYER_W,
      h: PLAYER_H,
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
    };
  }

  function makeEnemy(type, px, py) {
    const tall = type === 'D' ? 18 : 14;
    const wide = type === 'D' ? 20 : 20;
    return {
      type,
      x: px,
      y: py,
      w: wide,
      h: tall,
      vx: type === 'D' ? -0.55 : -0.85, // dust bunnies are slower
      vy: 0,
      alive: true,
      stomped: false,
      stompTimer: 0,
      animTimer: 0,
      animFrame: 0,
    };
  }

  // ------ level loading ------------------------------------------------------
  function loadLevel() {
    tiles = window.LEVEL.map((row) => row.split(''));

    game.enemies = [];
    game.items = [];
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
        } else if (c === 'B' || c === 'D') {
          const enemyH = c === 'D' ? 18 : 14;
          const enemyW = 20;
          const ex = wx + (TILE - enemyW) / 2;
          const ey = (y + 1) * TILE - enemyH;
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
    game.deathTimer = 0;
    loadLevel();
    game.mode = 'playing';
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
    setKey(e, true);
    Audio.resume();

    const k = e.key.toLowerCase();

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
        return;
      }
      // Other keys (e.g. modifiers) — ignore on the title screen.
      return;
    }

    if (game.mode === 'playing' && k === 'p') game.mode = 'paused';
    else if (game.mode === 'paused' && k === 'p') game.mode = 'playing';
    else if (
      (game.mode === 'dead' || game.mode === 'win') &&
      (k === 'enter' || k === 'r' || k === ' ')
    ) {
      restart();
    }
  });
  document.addEventListener('keyup', (e) => setKey(e, false));

  // Stop browser-default scroll when the canvas has focus and arrow keys are pressed.
  canvas.focus();

  function leftKey() { return !!(keys['a'] || keys['arrowleft']); }
  function rightKey() { return !!(keys['d'] || keys['arrowright']); }
  function jumpKey() { return !!(keys['w'] || keys['arrowup'] || keys[' ']); }

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

    // --- horizontal input + acceleration ---
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

    // --- coyote time + jump buffer ---
    if (p.onGround) p.coyote = COYOTE_TIME;
    else p.coyote = Math.max(0, p.coyote - dt);

    const jumpPressed = jumpKey() && !p.prevJump;
    if (jumpPressed) p.jumpBuffer = JUMP_BUFFER;
    else p.jumpBuffer = Math.max(0, p.jumpBuffer - dt);
    p.prevJump = jumpKey();

    if (p.coyote > 0 && p.jumpBuffer > 0) {
      p.vy = -JUMP_VEL;
      p.onGround = false;
      p.coyote = 0;
      p.jumpBuffer = 0;
      Audio.jump();
    }

    // --- gravity (variable jump: lighter while ascending + jump held) ---
    const ascending = p.vy < 0 && jumpKey();
    p.vy += ascending ? ASCEND_GRAV : GRAVITY;
    if (p.vy > MAX_FALL) p.vy = MAX_FALL;

    // --- collision ---
    p.onGround = false;
    moveX(p, p.vx);
    moveY(p, p.vy);

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

    if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - dt);
  }

  // ------ enemies ------------------------------------------------------------
  function updateEnemies(dt) {
    for (const e of game.enemies) {
      if (!e.alive) continue;

      if (e.stomped) {
        e.stompTimer += dt;
        if (e.stompTimer > 0.45) e.alive = false;
        continue;
      }

      e.animTimer += dt;
      e.animFrame = Math.floor(e.animTimer * 4) % 2;

      // gravity for enemies — they're affected too so they sit on platforms.
      e.vy += GRAVITY;
      if (e.vy > MAX_FALL) e.vy = MAX_FALL;

      // Move horizontally and bounce off walls.
      const beforeX = e.x;
      moveX(e, e.vx);
      if (e.x === beforeX) e.vx = -e.vx; // wall hit reset by moveX

      // Move vertically and snag to ground.
      e.onGround = false;
      moveY(e, e.vy);

      // Edge detection: if there's no ground in front, reverse direction.
      if (e.onGround) {
        const aheadX = e.vx > 0 ? e.x + e.w + 1 : e.x - 1;
        const aheadCol = Math.floor(aheadX / TILE);
        const groundRow = Math.floor((e.y + e.h) / TILE);
        if (!isSolidAt(aheadCol, groundRow)) {
          e.vx = -e.vx;
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
        Audio.stomp();
      } else {
        hurtPlayer();
      }
    }
  }

  function hurtPlayer() {
    const p = game.player;
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

  function pitDeath() {
    game.lives--;
    if (game.lives <= 0) {
      gameOver();
    } else {
      Audio.hurt();
      respawnPlayer();
    }
  }

  function gameOver() {
    game.mode = 'dead';
    game.deathTimer = 0;
    Audio.death();
  }

  // ------ items / camera / win check ----------------------------------------
  function updateItems(dt) {
    for (const item of game.items) item.bob += dt * 3;
    if (game.flash > 0) game.flash = Math.max(0, game.flash - dt);
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

      updatePlayer(dt);
      updateEnemies(dt);
      updateCollisions(dt);
      updateItems(dt);
      updateCamera();
      checkGoal();
    }
  }

  // ------ rendering ----------------------------------------------------------

  function drawSky() {
    const grad = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    grad.addColorStop(0, '#74c0fc');
    grad.addColorStop(0.55, '#a4d6f5');
    grad.addColorStop(1, '#dff2fb');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  // Two parallax layers: clouds (slow), then hills (faster).
  const CLOUDS = [
    { x: 80,   y: 50  },
    { x: 380,  y: 80  },
    { x: 700,  y: 40  },
    { x: 1050, y: 90  },
    { x: 1380, y: 60  },
    { x: 1720, y: 100 },
    { x: 2050, y: 55  },
    { x: 2400, y: 90  },
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
    const offset = -game.cameraX * 0.5;
    ctx.fillStyle = '#7eaa54';
    for (let i = -1; i < 8; i++) {
      const baseX = i * 600 + offset;
      ctx.beginPath();
      ctx.arc(baseX + 200, 400, 180, Math.PI, 0);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(baseX + 450, 420, 230, Math.PI, 0);
      ctx.fill();
    }
    ctx.fillStyle = '#5a8b3e';
    for (let i = -1; i < 6; i++) {
      const baseX = i * 720 + (-game.cameraX * 0.7);
      ctx.beginPath();
      ctx.arc(baseX + 360, 460, 280, Math.PI, 0);
      ctx.fill();
    }
  }

  function drawTiles() {
    const camX = Math.floor(game.cameraX);
    const startCol = Math.max(0, Math.floor(camX / TILE));
    const endCol = Math.min(W - 1, Math.ceil((camX + VIEW_W) / TILE));
    for (let y = 0; y < H; y++) {
      for (let x = startCol; x <= endCol; x++) {
        const c = tiles[y][x];
        if (c === '.') continue;
        const sx = x * TILE - camX;
        const sy = y * TILE;
        if (c === '#') ctx.drawImage(Sprites.grass, sx, sy);
        else if (c === '=') ctx.drawImage(Sprites.dirt, sx, sy);
        else if (c === '-') ctx.drawImage(Sprites.platform, sx, sy);
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

  function drawEnemies() {
    const camX = Math.floor(game.cameraX);
    for (const e of game.enemies) {
      if (!e.alive) continue;
      let sprite;
      if (e.stomped) {
        sprite = e.type === 'B' ? Sprites.bug.squashed : Sprites.dust.squashed;
      } else {
        const set = e.type === 'B' ? Sprites.bug : Sprites.dust;
        sprite = e.animFrame === 0 ? set.walk0 : set.walk1;
      }
      ctx.drawImage(sprite, Math.floor(e.x - camX), Math.floor(e.y));
    }
  }

  function drawPlayer() {
    const p = game.player;
    if (p.invuln > 0 && Math.floor(p.invuln * 12) % 2 === 0) return; // blink
    const set = Sprites.cats[selectedCat];
    let sprite;
    if (p.state === 'jump') sprite = set.jump;
    else if (p.state === 'fall') sprite = set.fall;
    else if (p.state === 'run') sprite = p.animFrame === 0 ? set.run0 : set.run1;
    else sprite = set.idle;
    // sprite is 56×48 with the cat paws near the bottom; align paws with feet.
    const sx = Math.floor(p.x - game.cameraX - SPRITE_OFFSET_X);
    const sy = Math.floor(p.y - SPRITE_OFFSET_Y);
    ctx.drawImage(sprite, sx, sy);
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

    // lives — use small fish icons
    ctx.fillStyle = '#fff';
    ctx.fillText('LIVES', 12, 18);
    for (let i = 0; i < game.lives; i++) {
      ctx.drawImage(Sprites.fish, 80 + i * 20, 11);
    }

    ctx.fillText(
      `TREATS  ${game.collected}/${game.totalCollectibles}`,
      230,
      18
    );
    ctx.fillText(`SCORE  ${game.score}`, 460, 18);
    ctx.fillStyle = game.timer < 30 ? '#ff8b8b' : '#fff';
    ctx.fillText(`TIME  ${game.timer}`, 660, 18);
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
    ctx.fillText("WHISKERS' ADVENTURE", VIEW_W / 2 + 2, 56);
    ctx.fillStyle = '#ffd166';
    ctx.fillText("WHISKERS' ADVENTURE", VIEW_W / 2, 54);

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
    ctx.fillText('In game: A/D or arrows to move · W/↑/Space to jump · P to pause',
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
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    drawCenteredText(
      [
        { text: 'PAUSED',
          font: 'bold 36px ui-monospace, monospace',
          color: '#fff', gap: 40 },
        { text: 'Press P to resume', color: '#bbb' },
      ],
      { startY: VIEW_H / 2 - 20 }
    );
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
        { text: 'Whiskers found a cozy spot to nap.',
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
    drawSky();
    drawClouds();
    drawHills();
    drawTiles();
    drawGoal();
    drawItems();
    drawEnemies();
    drawPlayer();
    drawFlash();
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
