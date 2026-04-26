/* sprites.js — procedural sprites for the cat platformer.
 *
 * Environment / enemies / collectibles use chunky pixel art drawn with
 * fillRect at 1 px = 1 px on small offscreen canvases. The main game canvas
 * has image-smoothing disabled so they stay crisp.
 *
 * The cat itself is drawn with vector primitives (ellipses, triangles, paths)
 * — the same drawing code used in the Cat-Ski companion project, with its
 * four palettes (black, tabby, calico, orange). This gives a more expressive
 * character against the pixel-art world. A small mismatch in styles is
 * intentional: it makes the cat read as the protagonist.
 *
 * No external images are loaded. To swap in real sprite sheets later, just
 * replace the canvases stored on the global `Sprites` object with
 * HTMLImageElements of the same dimensions.
 */
(function (global) {
  'use strict';

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  // Mirror a canvas horizontally (used to build "facing left" variants).
  function flipH(src) {
    const c = makeCanvas(src.width, src.height);
    const ctx = c.getContext('2d');
    ctx.translate(src.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(src, 0, 0);
    return c;
  }

  // ---------------------------------------------------------------------------
  //  Cat — vector drawing ported from the Cat-Ski project.
  //
  //  Four palettes available: black, tabby, calico, orange. The drawCat()
  //  function draws a seated/upright cat at (cx, cy) with the given scale,
  //  honouring options like { airborne, lean, crashed, pose }.
  //
  //  For this game we pre-bake each palette × state into a small canvas and
  //  blit those at runtime — the actual drawing is identical across both
  //  projects but rasterising once means we don't pay the vector cost every
  //  frame.
  // ---------------------------------------------------------------------------

  // Each palette gives a base fur colour, a darker accent for shadow/markings,
  // a belly/chest light, eye colour, and a "patch" colour used only by the
  // calico for irregular spots. `stripes: true` enables tabby tail rings,
  // forehead M, and mackerel side stripes.
  const CAT_PALETTES = {
    black:  { base:'#1a1a1e', accent:'#000000', belly:'#2a2a32', eye:'#f7d94a', patch:null,      nose:'#3a2028', stripes:false },
    tabby:  { base:'#9a7446', accent:'#5c3d1e', belly:'#d6b889', eye:'#6ed26b', patch:null,      nose:'#c06a50', stripes:true  },
    calico: { base:'#f5f5f0', accent:'#2a2a30', belly:'#ffffff', eye:'#2a8fb8', patch:'#e08a2a', nose:'#d89a82', stripes:false },
    orange: { base:'#e67a2e', accent:'#b85616', belly:'#f5c28a', eye:'#6ed26b', patch:null,      nose:'#c06a50', stripes:true  },
  };
  const CAT_NAMES = ['black', 'tabby', 'calico', 'orange'];
  const CAT_LABELS = { black: 'SHADOW', tabby: 'WHISKERS', calico: 'PATCHES', orange: 'GINGER' };

  /**
   * Draw a cat into context `g` at (cx, cy) with the given scale, palette
   * `p`, and options. Vector primitives, no images.
   *
   * Options:
   *   pose      'front' | 'skier'   default 'front' (skier shows goggles)
   *   lean      -1..1                horizontal lean for run animation
   *   tucked    bool                 squat (front paws hidden)
   *   airborne  bool                 puffs the tail and lifts it
   *   crashed   bool                 belly-up X-eyed pose for hurt state
   */
  function drawCat(g, cx, cy, scale, p, opts = {}) {
    const lean     = opts.lean || 0;
    const tucked   = !!opts.tucked;
    const crashed  = !!opts.crashed;
    const airborne = !!opts.airborne;
    const pose     = opts.pose || 'front';

    g.save();
    g.translate(cx, cy);
    g.scale(scale, scale);

    const ellipse = (x, y, rx, ry, fill, stroke, lw) => {
      g.beginPath();
      g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      if (fill)   { g.fillStyle = fill; g.fill(); }
      if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw || 0.7; g.stroke(); }
    };
    const tri = (ax, ay, bx, by, x3, y3, fill) => {
      g.beginPath();
      g.moveTo(ax, ay); g.lineTo(bx, by); g.lineTo(x3, y3); g.closePath();
      g.fillStyle = fill; g.fill();
    };

    // ---- crashed pose (used during invincibility / hurt) ----
    if (crashed) {
      ellipse(0, 3, 7, 4.5, p.belly, p.accent);
      ellipse(-6, 1, 2, 1.6, p.base, p.accent);
      ellipse( 6, 1, 2, 1.6, p.base, p.accent);
      ellipse(-5, 5, 1.8, 1.4, p.base, p.accent);
      ellipse( 5, 5, 1.8, 1.4, p.base, p.accent);
      ellipse(0, -4, 5, 4.2, p.base, p.accent);
      tri(-4, -5, -3, -8, -1.5, -5, p.accent);
      tri( 4, -5,  3, -8,  1.5, -5, p.accent);
      g.strokeStyle = '#000'; g.lineWidth = 0.9;
      g.beginPath();
      g.moveTo(-2.8, -5); g.lineTo(-1.4, -3.5);
      g.moveTo(-1.4, -5); g.lineTo(-2.8, -3.5);
      g.moveTo( 1.4, -5); g.lineTo( 2.8, -3.5);
      g.moveTo( 2.8, -5); g.lineTo( 1.4, -3.5); g.stroke();
      g.fillStyle = '#ff6b8a';
      g.fillRect(-0.6, -2.2, 1.6, 1.3);
      g.fillStyle = '#ffcc00';
      [[-7,-9],[6,-10],[2,-12]].forEach(([x,y]) => {
        g.beginPath(); g.arc(x, y, 0.7, 0, Math.PI*2); g.fill();
      });
      g.restore();
      return;
    }

    // ============== seated pose (idle / run / jump / fall) ==============
    const tailDir = -Math.sign(lean) || 1;
    const bodyTilt = lean * 0.10;

    const bodyW = 5.5;
    const bodyH = 5.2;
    const bodyY = 3.5;
    const headR = 4.6;
    const headRy = 4.2;
    const headY = -3.2 + (tucked ? 0.8 : 0);

    // ---- TAIL ----
    g.save();
    g.rotate(bodyTilt);
    const tailFluff = airborne ? -3.5 : 0;
    g.strokeStyle = p.accent;
    g.lineWidth = 3.6;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(0, bodyY + 1);
    g.quadraticCurveTo(
      tailDir * 5, bodyY + 4 + tailFluff * 0.4,
      tailDir * 8, bodyY + 0 + tailFluff
    );
    g.stroke();
    g.strokeStyle = p.base;
    g.lineWidth = 2.6;
    g.stroke();
    if (p.stripes) {
      g.strokeStyle = p.accent;
      g.lineWidth = 0.8;
      [0.35, 0.6, 0.85].forEach(t => {
        const tx = tailDir * (5 * t * 1.6);
        const ty = bodyY + 4 * t * (1 - t) * 4 + tailFluff * t;
        g.beginPath();
        g.moveTo(tx - 1.3, ty - 0.5);
        g.lineTo(tx + 1.3, ty + 0.5);
        g.stroke();
      });
    }
    g.restore();

    // ---- BODY ----
    g.save();
    g.rotate(bodyTilt);
    ellipse(0, bodyY - 1.5, bodyW * 0.78, bodyH * 0.55, p.accent);
    ellipse(0, bodyY - 1.5, bodyW * 0.78 - 0.6, bodyH * 0.55 - 0.5, p.base);
    ellipse(0, bodyY + 1.2, bodyW, bodyH * 0.7, p.accent);
    ellipse(0, bodyY + 1.2, bodyW - 0.6, bodyH * 0.7 - 0.5, p.base);
    ellipse(0, bodyY + 0.8, bodyW * 0.45, bodyH * 0.7, p.belly);

    // body markings clipped to body silhouette
    g.save();
    g.beginPath();
    g.ellipse(0, bodyY - 1.5, bodyW * 0.78, bodyH * 0.55, 0, 0, Math.PI*2);
    g.ellipse(0, bodyY + 1.2, bodyW, bodyH * 0.7, 0, 0, Math.PI*2);
    g.clip('evenodd');

    if (p.stripes) {
      g.strokeStyle = p.accent;
      g.lineWidth = 0.8;
      g.beginPath();
      [-2, 0, 2].forEach(yo => {
        g.moveTo(-bodyW, bodyY + yo);
        g.quadraticCurveTo(-bodyW * 0.5, bodyY + yo + 0.6, -bodyW * 0.15, bodyY + yo);
        g.moveTo(bodyW, bodyY + yo);
        g.quadraticCurveTo(bodyW * 0.5, bodyY + yo + 0.6, bodyW * 0.15, bodyY + yo);
      });
      g.stroke();
    }
    if (p.patch) {
      g.fillStyle = p.patch;
      g.beginPath(); g.ellipse(-2.3, bodyY + 0.4, 2, 1.6, 0.2, 0, Math.PI*2); g.fill();
      g.beginPath(); g.ellipse( 2.6, bodyY + 2,   1.8, 1.4, -0.3, 0, Math.PI*2); g.fill();
      g.fillStyle = p.accent;
      g.beginPath(); g.ellipse( 2.4, bodyY - 1.5, 1.4, 1, 0, 0, Math.PI*2); g.fill();
      g.beginPath(); g.ellipse(-3, bodyY + 2.5,   1.1, 0.9, 0, 0, Math.PI*2); g.fill();
    }
    g.restore();

    // front paws
    if (!tucked) {
      g.fillStyle = p.accent;
      g.fillRect(-3.2, bodyY + 4.2, 1.8, 0.6);
      g.fillRect( 1.4, bodyY + 4.2, 1.8, 0.6);
      ellipse(-2.3, bodyY + 5.2, 1.5, 1.2, p.base, p.accent, 0.5);
      ellipse( 2.3, bodyY + 5.2, 1.5, 1.2, p.base, p.accent, 0.5);
      g.strokeStyle = p.accent;
      g.lineWidth = 0.4;
      g.beginPath();
      g.moveTo(-2.3, bodyY + 5.7); g.lineTo(-2.3, bodyY + 6.2);
      g.moveTo(-2.9, bodyY + 5.6); g.lineTo(-2.9, bodyY + 6.0);
      g.moveTo(-1.7, bodyY + 5.6); g.lineTo(-1.7, bodyY + 6.0);
      g.moveTo( 2.3, bodyY + 5.7); g.lineTo( 2.3, bodyY + 6.2);
      g.moveTo( 1.7, bodyY + 5.6); g.lineTo( 1.7, bodyY + 6.0);
      g.moveTo( 2.9, bodyY + 5.6); g.lineTo( 2.9, bodyY + 6.0);
      g.stroke();
    }
    g.restore();

    // ---- HEAD ----
    const earOut = p.accent;
    const earIn  = '#f0a0a6';
    tri(-headR + 0.5, headY - 1.5, -3, headY - 7.2, -1, headY - 2.5, earOut);
    tri(-3.8, headY - 2.5, -3, headY - 5.8, -1.8, headY - 2.5, earIn);
    tri( headR - 0.5, headY - 1.5,  3, headY - 7.2,  1, headY - 2.5, earOut);
    tri( 3.8, headY - 2.5,  3, headY - 5.8,  1.8, headY - 2.5, earIn);

    ellipse(0, headY, headR, headRy, p.accent);
    ellipse(0, headY, headR - 0.6, headRy - 0.6, p.base);
    ellipse(0, headY + 2.5, 2.6, 1.5, p.belly);

    // head markings clipped to head shape
    g.save();
    g.beginPath();
    g.ellipse(0, headY, headR - 0.4, headRy - 0.4, 0, 0, Math.PI*2);
    g.clip();
    if (p.stripes) {
      g.strokeStyle = p.accent;
      g.lineWidth = 0.7;
      g.beginPath();
      g.moveTo(-1.8, headY - 1.8); g.lineTo(-1.2, headY + 0.2);
      g.moveTo( 0,   headY - 2.2); g.lineTo( 0,   headY + 0.2);
      g.moveTo( 1.8, headY - 1.8); g.lineTo( 1.2, headY + 0.2);
      g.stroke();
      g.beginPath();
      g.moveTo(-headR, headY + 1); g.quadraticCurveTo(-2.5, headY + 1.5, -1.5, headY + 1.2);
      g.moveTo( headR, headY + 1); g.quadraticCurveTo( 2.5, headY + 1.5,  1.5, headY + 1.2);
      g.stroke();
    }
    if (p.patch) {
      g.fillStyle = p.patch;
      g.beginPath(); g.ellipse(-2, headY - 0.5, 2.4, 2.2, 0.15, 0, Math.PI*2); g.fill();
      g.fillStyle = p.accent;
      g.beginPath(); g.ellipse( 2.4, headY - 1.2, 1.6, 1.5, 0, 0, Math.PI*2); g.fill();
    }
    g.restore();

    // eyes (front-pose: realistic almond eyes with slit pupil)
    const eyeY = headY - 0.2;
    if (pose === 'skier') {
      g.fillStyle = '#0b1320';
      g.fillRect(-headR + 0.3, eyeY - 0.6, headR * 2 - 0.6, 1.8);
      g.fillStyle = '#0b1320';
      g.beginPath(); g.arc(-2.1, eyeY + 0.3, 1.7, 0, Math.PI*2); g.fill();
      g.beginPath(); g.arc( 2.1, eyeY + 0.3, 1.7, 0, Math.PI*2); g.fill();
      g.fillStyle = p.eye;
      g.beginPath(); g.arc(-2.1, eyeY + 0.3, 1.15, 0, Math.PI*2); g.fill();
      g.beginPath(); g.arc( 2.1, eyeY + 0.3, 1.15, 0, Math.PI*2); g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath(); g.arc(-2.5, eyeY - 0.1, 0.45, 0, Math.PI*2); g.fill();
      g.beginPath(); g.arc( 1.7, eyeY - 0.1, 0.45, 0, Math.PI*2); g.fill();
    } else {
      g.fillStyle = '#ffffff';
      g.beginPath(); g.ellipse(-2.1, eyeY + 0.3, 1.3, 1.5, 0, 0, Math.PI*2); g.fill();
      g.beginPath(); g.ellipse( 2.1, eyeY + 0.3, 1.3, 1.5, 0, 0, Math.PI*2); g.fill();
      g.fillStyle = p.eye;
      g.beginPath(); g.ellipse(-2.1, eyeY + 0.3, 1.1, 1.35, 0, 0, Math.PI*2); g.fill();
      g.beginPath(); g.ellipse( 2.1, eyeY + 0.3, 1.1, 1.35, 0, 0, Math.PI*2); g.fill();
      g.fillStyle = '#000';
      g.beginPath(); g.ellipse(-2.1, eyeY + 0.3, 0.28, 1.2, 0, 0, Math.PI*2); g.fill();
      g.beginPath(); g.ellipse( 2.1, eyeY + 0.3, 0.28, 1.2, 0, 0, Math.PI*2); g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath(); g.arc(-1.7, eyeY - 0.2, 0.32, 0, Math.PI*2); g.fill();
      g.beginPath(); g.arc( 2.5, eyeY - 0.2, 0.32, 0, Math.PI*2); g.fill();
      g.strokeStyle = p.accent;
      g.lineWidth = 0.4;
      g.beginPath(); g.ellipse(-2.1, eyeY + 0.3, 1.3, 1.5, 0, 0, Math.PI*2); g.stroke();
      g.beginPath(); g.ellipse( 2.1, eyeY + 0.3, 1.3, 1.5, 0, 0, Math.PI*2); g.stroke();
    }

    g.fillStyle = p.nose;
    g.beginPath();
    g.moveTo(-0.8, headY + 2.1);
    g.lineTo( 0.8, headY + 2.1);
    g.lineTo( 0,   headY + 3.0);
    g.closePath();
    g.fill();

    g.strokeStyle = p.accent;
    g.lineWidth = 0.55;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(0, headY + 3.0);
    g.lineTo(0, headY + 3.5);
    g.moveTo(0, headY + 3.5);
    g.quadraticCurveTo(-0.7, headY + 3.9, -1.4, headY + 3.6);
    g.moveTo(0, headY + 3.5);
    g.quadraticCurveTo( 0.7, headY + 3.9,  1.4, headY + 3.6);
    g.stroke();

    g.strokeStyle = 'rgba(20,20,20,0.55)';
    g.lineWidth = 0.35;
    g.beginPath();
    g.moveTo(-1.3, headY + 2.6); g.quadraticCurveTo(-4, headY + 2.0, -6.5, headY + 1.6);
    g.moveTo(-1.3, headY + 2.9); g.quadraticCurveTo(-4, headY + 2.9, -6.7, headY + 2.9);
    g.moveTo(-1.3, headY + 3.2); g.quadraticCurveTo(-4, headY + 3.6, -6.4, headY + 4.0);
    g.moveTo( 1.3, headY + 2.6); g.quadraticCurveTo( 4, headY + 2.0,  6.5, headY + 1.6);
    g.moveTo( 1.3, headY + 2.9); g.quadraticCurveTo( 4, headY + 2.9,  6.7, headY + 2.9);
    g.moveTo( 1.3, headY + 3.2); g.quadraticCurveTo( 4, headY + 3.6,  6.4, headY + 4.0);
    g.stroke();

    g.restore();
  }

  // Cat sprite layout. 56 × 48 canvas, cat origin at (28, 30) with scale 1.7.
  // Hitbox in game.js stays at 20 × 22; the sprite is drawn with offset
  // (-18, -26) from the hitbox top-left so the cat's paws sit on the ground.
  const CAT_SPRITE_W = 56;
  const CAT_SPRITE_H = 48;
  const CAT_SCALE = 1.7;
  const CAT_OX = 28;
  const CAT_OY = 30;

  function bakeCat(palette, opts) {
    const c = makeCanvas(CAT_SPRITE_W, CAT_SPRITE_H);
    const g = c.getContext('2d');
    drawCat(g, CAT_OX, CAT_OY, CAT_SCALE, palette, opts);
    return c;
  }

  // For each palette, bake a sprite per state. The cat is symmetrical so we
  // don't keep separate left/right variants — same sprite in both directions.
  function buildCatSet(palette) {
    return {
      idle: bakeCat(palette, {}),
      run0: bakeCat(palette, { lean: -0.18 }),
      run1: bakeCat(palette, { lean:  0.18 }),
      jump: bakeCat(palette, { airborne: true, tucked: true }),
      fall: bakeCat(palette, { airborne: true, lean: 0.05 }),
      hurt: bakeCat(palette, { crashed: true }),
    };
  }

  function buildAllCats() {
    const cats = {};
    for (const name of CAT_NAMES) cats[name] = buildCatSet(CAT_PALETTES[name]);
    return cats;
  }

  // ---------------------------------------------------------------------------
  //  Bug enemy (purple beetle) — small, walks on the ground.
  // ---------------------------------------------------------------------------

  function drawBug(frame) {
    const c = makeCanvas(20, 14);
    const ctx = c.getContext('2d');

    const SHELL = '#5a3a8c';
    const HIGHLIGHT = '#8e60d6';
    const DARK = '#3a2562';

    // shell
    ctx.fillStyle = SHELL;
    ctx.fillRect(2, 4, 16, 8);
    ctx.fillRect(3, 3, 14, 1);
    ctx.fillRect(3, 12, 14, 1);

    // shell highlight stripe
    ctx.fillStyle = HIGHLIGHT;
    ctx.fillRect(4, 5, 12, 2);
    ctx.fillRect(8, 7, 4, 1);

    // segment line
    ctx.fillStyle = DARK;
    ctx.fillRect(9, 4, 2, 8);

    // eyes
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(5, 6, 3, 3);
    ctx.fillRect(12, 6, 3, 3);
    ctx.fillStyle = '#000000';
    ctx.fillRect(6, 7, 1, 2);
    ctx.fillRect(13, 7, 1, 2);

    // antennae
    ctx.fillStyle = DARK;
    ctx.fillRect(6, 1, 1, 3);
    ctx.fillRect(13, 1, 1, 3);
    ctx.fillRect(5, 0, 1, 1);
    ctx.fillRect(14, 0, 1, 1);

    // legs (animate)
    ctx.fillStyle = DARK;
    if (frame === 0) {
      ctx.fillRect(3, 12, 2, 2);
      ctx.fillRect(9, 12, 2, 2);
      ctx.fillRect(15, 12, 2, 2);
    } else {
      ctx.fillRect(5, 12, 2, 2);
      ctx.fillRect(11, 12, 2, 2);
      ctx.fillRect(13, 12, 2, 2);
    }

    return c;
  }

  function drawBugSquashed() {
    const c = makeCanvas(20, 8);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#5a3a8c';
    ctx.fillRect(2, 4, 16, 4);
    ctx.fillStyle = '#3a2562';
    ctx.fillRect(2, 7, 16, 1);
    ctx.fillStyle = '#8e60d6';
    ctx.fillRect(4, 5, 12, 1);
    return c;
  }

  // ---------------------------------------------------------------------------
  //  Dust bunny — fluffy grey blob.
  // ---------------------------------------------------------------------------

  function drawDust(frame) {
    const c = makeCanvas(20, 18);
    const ctx = c.getContext('2d');

    const FLUFF = '#9da3b3';
    const LIGHT = '#c5cad7';
    const DARK = '#6b7280';

    // body
    ctx.fillStyle = FLUFF;
    ctx.fillRect(3, 5, 14, 11);
    ctx.fillRect(4, 4, 12, 1);
    ctx.fillRect(4, 16, 12, 1);
    ctx.fillRect(2, 7, 1, 7);
    ctx.fillRect(17, 7, 1, 7);

    // tufts on top
    ctx.fillRect(6, 3, 2, 2);
    ctx.fillRect(10, 2, 2, 3);
    ctx.fillRect(13, 3, 2, 2);

    // bottom shadow
    ctx.fillStyle = DARK;
    ctx.fillRect(4, 16, 12, 1);

    // highlights
    ctx.fillStyle = LIGHT;
    ctx.fillRect(5, 6, 3, 2);
    ctx.fillRect(12, 7, 3, 2);

    // eyes
    ctx.fillStyle = '#000000';
    ctx.fillRect(7, 9, 2, 2);
    ctx.fillRect(11, 9, 2, 2);

    // mouth — animates between closed and open
    if (frame === 0) {
      ctx.fillRect(9, 13, 2, 1);
    } else {
      ctx.fillRect(9, 13, 2, 2);
    }

    return c;
  }

  function drawDustSquashed() {
    const c = makeCanvas(20, 8);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#9da3b3';
    ctx.fillRect(2, 3, 16, 5);
    ctx.fillStyle = '#c5cad7';
    ctx.fillRect(4, 4, 4, 1);
    ctx.fillRect(11, 4, 4, 1);
    ctx.fillStyle = '#6b7280';
    ctx.fillRect(2, 7, 16, 1);
    return c;
  }

  // ---------------------------------------------------------------------------
  //  Collectibles — yarn ball, fish treat.
  // ---------------------------------------------------------------------------

  function drawYarn() {
    const c = makeCanvas(14, 14);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#d76e91';
    ctx.fillRect(2, 1, 10, 12);
    ctx.fillRect(1, 3, 1, 8);
    ctx.fillRect(12, 3, 1, 8);
    ctx.fillRect(3, 0, 8, 1);
    ctx.fillRect(3, 13, 8, 1);

    // yarn lines
    ctx.fillStyle = '#9c4868';
    ctx.fillRect(3, 4, 7, 1);
    ctx.fillRect(2, 7, 9, 1);
    ctx.fillRect(4, 10, 6, 1);
    ctx.fillRect(8, 2, 1, 4);
    ctx.fillRect(9, 6, 1, 4);
    ctx.fillRect(5, 9, 1, 3);

    // highlight + dangling thread
    ctx.fillStyle = '#ffb3c8';
    ctx.fillRect(3, 2, 2, 2);
    ctx.fillStyle = '#9c4868';
    ctx.fillRect(11, 4, 2, 1);
    ctx.fillRect(13, 4, 1, 3);
    return c;
  }

  function drawFish() {
    const c = makeCanvas(16, 12);
    const ctx = c.getContext('2d');
    // body
    ctx.fillStyle = '#5cd4f0';
    ctx.fillRect(2, 3, 9, 6);
    ctx.fillRect(3, 2, 7, 1);
    ctx.fillRect(3, 9, 7, 1);
    ctx.fillRect(4, 1, 5, 1);
    ctx.fillRect(4, 10, 5, 1);
    // tail
    ctx.fillRect(11, 2, 2, 8);
    ctx.fillRect(13, 1, 2, 10);
    // belly
    ctx.fillStyle = '#a8ecf8';
    ctx.fillRect(3, 5, 6, 3);
    // eye
    ctx.fillStyle = '#000000';
    ctx.fillRect(4, 4, 1, 1);
    // shine
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(7, 3, 2, 1);
    return c;
  }

  // ---------------------------------------------------------------------------
  //  Tiles — 32×32. Grass on top, dirt below, wooden floating platform.
  // ---------------------------------------------------------------------------

  function drawGrass() {
    const c = makeCanvas(32, 32);
    const ctx = c.getContext('2d');
    // dirt base
    ctx.fillStyle = '#8b5e3c';
    ctx.fillRect(0, 0, 32, 32);
    // grass band
    ctx.fillStyle = '#5cb85c';
    ctx.fillRect(0, 0, 32, 8);
    ctx.fillStyle = '#7dd87d';
    ctx.fillRect(0, 0, 32, 3);
    // grass blades poking up
    ctx.fillStyle = '#5cb85c';
    ctx.fillRect(2, 0, 1, 4);
    ctx.fillRect(7, 0, 2, 5);
    ctx.fillRect(13, 0, 1, 3);
    ctx.fillRect(19, 0, 2, 6);
    ctx.fillRect(25, 0, 1, 4);
    ctx.fillRect(29, 0, 2, 5);
    // dirt freckles
    ctx.fillStyle = '#6b4423';
    ctx.fillRect(4, 12, 2, 2);
    ctx.fillRect(14, 18, 2, 2);
    ctx.fillRect(22, 22, 2, 2);
    ctx.fillRect(8, 26, 2, 2);
    ctx.fillStyle = '#a26d3f';
    ctx.fillRect(10, 16, 1, 1);
    ctx.fillRect(26, 10, 1, 1);
    ctx.fillRect(20, 28, 1, 1);
    return c;
  }

  function drawDirt() {
    const c = makeCanvas(32, 32);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#8b5e3c';
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = '#6b4423';
    ctx.fillRect(4, 4, 2, 2);
    ctx.fillRect(14, 8, 2, 2);
    ctx.fillRect(22, 12, 2, 2);
    ctx.fillRect(8, 18, 2, 2);
    ctx.fillRect(20, 22, 2, 2);
    ctx.fillRect(28, 28, 2, 2);
    ctx.fillRect(2, 14, 2, 2);
    ctx.fillStyle = '#a26d3f';
    ctx.fillRect(10, 14, 1, 1);
    ctx.fillRect(26, 6, 1, 1);
    ctx.fillRect(2, 24, 1, 1);
    ctx.fillRect(18, 4, 1, 1);
    return c;
  }

  function drawPlatform() {
    const c = makeCanvas(32, 32);
    const ctx = c.getContext('2d');
    // wood top
    ctx.fillStyle = '#c8884e';
    ctx.fillRect(0, 0, 32, 16);
    ctx.fillStyle = '#a26d3f';
    ctx.fillRect(0, 12, 32, 4);
    ctx.fillStyle = '#7d4f25';
    ctx.fillRect(0, 16, 32, 16);
    // wood grain
    ctx.fillStyle = '#a26d3f';
    ctx.fillRect(2, 4, 8, 1);
    ctx.fillRect(14, 8, 6, 1);
    ctx.fillRect(22, 4, 8, 1);
    // bottom rim highlight
    ctx.fillStyle = '#5b3618';
    ctx.fillRect(0, 30, 32, 2);
    // edge nails
    ctx.fillStyle = '#3a2410';
    ctx.fillRect(2, 19, 1, 1);
    ctx.fillRect(29, 19, 1, 1);
    return c;
  }

  // ---------------------------------------------------------------------------
  //  Goal — cozy bed with a "BED" sign post.
  // ---------------------------------------------------------------------------

  function drawBed() {
    const c = makeCanvas(48, 32);
    const ctx = c.getContext('2d');
    // signpost behind bed
    ctx.fillStyle = '#92400e';
    ctx.fillRect(23, 0, 2, 16);
    ctx.fillStyle = '#fff8e8';
    ctx.fillRect(18, 0, 12, 10);
    ctx.fillStyle = '#92400e';
    ctx.fillRect(18, 0, 12, 1);
    ctx.fillRect(18, 9, 12, 1);
    ctx.fillRect(18, 0, 1, 10);
    ctx.fillRect(29, 0, 1, 10);
    // a sleeping "Z" on the sign
    ctx.fillStyle = '#16161d';
    ctx.fillRect(21, 2, 6, 1);
    ctx.fillRect(26, 3, 1, 1);
    ctx.fillRect(25, 4, 1, 1);
    ctx.fillRect(24, 5, 1, 1);
    ctx.fillRect(23, 6, 1, 1);
    ctx.fillRect(22, 7, 1, 1);
    ctx.fillRect(21, 7, 6, 1);

    // bed frame (purple)
    ctx.fillStyle = '#8b5cf6';
    ctx.fillRect(0, 18, 48, 14);
    ctx.fillStyle = '#6d3fcf';
    ctx.fillRect(0, 30, 48, 2);
    ctx.fillStyle = '#a584f7';
    ctx.fillRect(0, 18, 48, 2);

    // cushion (yellow)
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(4, 12, 40, 10);
    ctx.fillStyle = '#fcd97c';
    ctx.fillRect(4, 12, 40, 2);
    ctx.fillStyle = '#d49414';
    ctx.fillRect(4, 20, 40, 2);

    // a couple of paw prints on the cushion
    ctx.fillStyle = '#92400e';
    ctx.fillRect(10, 16, 2, 2);
    ctx.fillRect(13, 15, 1, 1);
    ctx.fillRect(13, 18, 1, 1);
    ctx.fillRect(35, 16, 2, 2);
    ctx.fillRect(38, 15, 1, 1);
    ctx.fillRect(38, 18, 1, 1);

    return c;
  }

  // ---------------------------------------------------------------------------
  //  Background — clouds, drawn once at multiple alphas.
  // ---------------------------------------------------------------------------

  function drawCloud() {
    const c = makeCanvas(64, 22);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(8, 8, 48, 12);
    ctx.fillRect(16, 4, 32, 4);
    ctx.fillRect(22, 1, 22, 3);
    ctx.fillRect(4, 12, 4, 6);
    ctx.fillRect(56, 12, 4, 6);
    ctx.fillRect(0, 14, 4, 4);
    ctx.fillRect(60, 14, 4, 4);
    // soft underside
    ctx.fillStyle = '#dde6f0';
    ctx.fillRect(8, 18, 48, 2);
    ctx.fillRect(16, 20, 32, 1);
    return c;
  }

  // ---------------------------------------------------------------------------
  //  Bake all sprites into a single namespace.
  // ---------------------------------------------------------------------------

  global.Sprites = {
    // Per-palette pre-baked cat sprites: Sprites.cats[name][state].
    cats: buildAllCats(),
    catNames: CAT_NAMES,
    catLabels: CAT_LABELS,
    catPalettes: CAT_PALETTES,
    // Live drawCat for the title-screen swatches (drawn at preview scale).
    drawCat: drawCat,
    catSpriteSize: { w: CAT_SPRITE_W, h: CAT_SPRITE_H, scale: CAT_SCALE },

    bug: { walk0: drawBug(0), walk1: drawBug(1), squashed: drawBugSquashed() },
    dust: { walk0: drawDust(0), walk1: drawDust(1), squashed: drawDustSquashed() },
    yarn: drawYarn(),
    fish: drawFish(),
    grass: drawGrass(),
    dirt: drawDirt(),
    platform: drawPlatform(),
    bed: drawBed(),
    cloud: drawCloud(),
  };
})(window);
