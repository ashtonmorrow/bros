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

  // Cat sprite layout. Two sizes baked per palette:
  //
  //   small — scale 1.7, 56 × 48 canvas. Default state. Paws sit on the
  //           hitbox bottom (20 × 22) so existing collision math stays put.
  //   big   — scale 2.2, 72 × 64 canvas. After eating cat food. Hitbox grows
  //           to 22 × 28 so the cat's actual silhouette covers the new size.
  //
  // The cat is symmetric (front-pose) so left/right share one sprite.
  const CAT_SIZES = {
    small: { w: 56, h: 48, scale: 1.7, ox: 28, oy: 30, hitW: 20, hitH: 22 },
    big:   { w: 72, h: 64, scale: 2.2, ox: 36, oy: 40, hitW: 22, hitH: 28 },
  };
  // Backwards-compat — game.js still reads catSpriteSize for default offsets.
  const CAT_SPRITE_W = CAT_SIZES.small.w;
  const CAT_SPRITE_H = CAT_SIZES.small.h;
  const CAT_SCALE    = CAT_SIZES.small.scale;

  function bakeCat(palette, sizeKey, opts) {
    const sz = CAT_SIZES[sizeKey];
    const c = makeCanvas(sz.w, sz.h);
    const g = c.getContext('2d');
    drawCat(g, sz.ox, sz.oy, sz.scale, palette, opts);
    return c;
  }

  // Per-palette × per-size: bake every state once at startup.
  function buildCatSet(palette) {
    const set = { small: {}, big: {} };
    for (const sz of ['small', 'big']) {
      set[sz].idle = bakeCat(palette, sz, {});
      set[sz].run0 = bakeCat(palette, sz, { lean: -0.18 });
      set[sz].run1 = bakeCat(palette, sz, { lean:  0.18 });
      set[sz].jump = bakeCat(palette, sz, { airborne: true, tucked: true });
      set[sz].fall = bakeCat(palette, sz, { airborne: true, lean: 0.05 });
      set[sz].hurt = bakeCat(palette, sz, { crashed: true });
    }
    return set;
  }

  function buildAllCats() {
    const cats = {};
    for (const name of CAT_NAMES) cats[name] = buildCatSet(CAT_PALETTES[name]);
    return cats;
  }

  // ---------------------------------------------------------------------------
  //  Bug enemy (purple beetle) — small, walks on the ground.
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  //  Dog — walking patroller. Two-tone tan + dark-brown coat (a beagle / mutt
  //  silhouette), long muzzle that protrudes past the body line, drooping
  //  ear with pink inside, a curled-up tail at the back, a black nose and
  //  hanging tongue, plus a red-and-gold collar so it reads as a pet rather
  //  than a feral animal. Four visible legs animate in a 2-frame walk
  //  cycle (front-left + back-right swap with front-right + back-left).
  //  26 × 20 — slightly bigger than the placeholder bug it replaces.
  // ---------------------------------------------------------------------------

  function drawDog(frame) {
    const c = makeCanvas(26, 20);
    const ctx = c.getContext('2d');
    const TAN       = '#c08a52';
    const TAN_LIGHT = '#dcae7a';
    const DARK      = '#5a3a1a';
    const DARK2     = '#3a2410';
    const PINK      = '#e7708a';
    const TONGUE    = '#cc4860';
    const BLACK     = '#1a1014';

    // ---- curled tail (drawn first so the body covers the root) ----
    ctx.fillStyle = TAN;
    ctx.fillRect(0, 7, 2, 3);
    ctx.fillRect(1, 5, 3, 2);
    ctx.fillRect(3, 5, 2, 4);
    ctx.fillRect(2, 8, 2, 1);
    // dark tip
    ctx.fillStyle = DARK;
    ctx.fillRect(0, 6, 1, 2);

    // ---- body (long horizontal oval) ----
    ctx.fillStyle = TAN;
    ctx.fillRect(3, 9, 16, 6);
    ctx.fillRect(4, 8, 14, 1);
    ctx.fillRect(4, 15, 14, 1);
    // big dark patch on the back — gives the dog real markings
    ctx.fillStyle = DARK;
    ctx.fillRect(7, 9, 6, 2);
    ctx.fillRect(8, 8, 4, 1);
    // small spot near the haunch
    ctx.fillRect(15, 11, 2, 2);
    // belly underline (lighter)
    ctx.fillStyle = TAN_LIGHT;
    ctx.fillRect(5, 13, 12, 2);

    // ---- head (right side, slightly above body line) ----
    ctx.fillStyle = TAN;
    ctx.fillRect(17, 6, 7, 8);
    ctx.fillRect(18, 5, 5, 1);
    // long muzzle that sticks out past the body
    ctx.fillRect(22, 10, 4, 3);
    // muzzle lighter underneath (suggests the soft snout fur)
    ctx.fillStyle = TAN_LIGHT;
    ctx.fillRect(22, 11, 3, 2);

    // ---- drooping ear (dark patch matching the body) ----
    ctx.fillStyle = DARK;
    ctx.fillRect(16, 5, 3, 6);
    ctx.fillRect(15, 6, 1, 4);
    ctx.fillRect(17, 11, 1, 1);
    // pink ear interior
    ctx.fillStyle = PINK;
    ctx.fillRect(17, 7, 1, 3);

    // ---- eye + brow ----
    ctx.fillStyle = BLACK;
    ctx.fillRect(20, 8, 1, 2);
    ctx.fillStyle = '#fff';
    ctx.fillRect(20, 8, 1, 1);     // eye glint
    // nose
    ctx.fillStyle = BLACK;
    ctx.fillRect(25, 11, 1, 1);
    ctx.fillRect(24, 10, 2, 1);
    // mouth + tongue (hangs out a bit, very dog-like)
    ctx.fillRect(22, 13, 2, 1);
    ctx.fillStyle = TONGUE;
    ctx.fillRect(23, 14, 1, 1);

    // ---- collar (red band with gold tag) ----
    ctx.fillStyle = '#cc2929';
    ctx.fillRect(17, 13, 1, 2);
    ctx.fillRect(16, 13, 1, 1);
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(17, 14, 1, 1);

    // ---- legs (walk-cycle, 4 visible) ----
    ctx.fillStyle = DARK;
    if (frame === 0) {
      // front-left + back-right forward
      ctx.fillRect(4, 16, 2, 4);
      ctx.fillRect(7, 16, 2, 3);
      ctx.fillRect(13, 16, 2, 3);
      ctx.fillRect(16, 16, 2, 4);
    } else {
      // front-right + back-left forward
      ctx.fillRect(5, 16, 2, 3);
      ctx.fillRect(7, 16, 2, 4);
      ctx.fillRect(13, 16, 2, 4);
      ctx.fillRect(16, 16, 2, 3);
    }
    // paw highlights (lighter underside)
    ctx.fillStyle = DARK2;
    ctx.fillRect(4, 19, 2, 1);
    ctx.fillRect(16, 19, 2, 1);

    return c;
  }

  function drawDogSquashed() {
    const c = makeCanvas(26, 8);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#c08a52';
    ctx.fillRect(2, 3, 22, 5);
    ctx.fillStyle = '#5a3a1a';
    ctx.fillRect(2, 7, 22, 1);
    ctx.fillRect(8, 4, 5, 2);       // back-patch flattened
    ctx.fillStyle = '#dcae7a';
    ctx.fillRect(5, 4, 3, 1);
    ctx.fillRect(14, 4, 8, 1);
    // ear flop
    ctx.fillRect(2, 2, 3, 1);
    return c;
  }

  // ---------------------------------------------------------------------------
  //  Small child crawling — short hitbox, slow patrol, in pyjamas. Two-frame
  //  crawl cycle (alternating arm/leg). Stylised on purpose: pyjama onesie
  //  + cap so the silhouette reads as "kid on hands and knees" at 24 × 12.
  // ---------------------------------------------------------------------------

  function drawChild(frame) {
    const c = makeCanvas(24, 12);
    const ctx = c.getContext('2d');
    const SUIT  = '#7cc8ff';     // pyjama blue
    const SUIT2 = '#5a9fdb';
    const SKIN  = '#f6c7a3';
    const DARK  = '#2a3340';
    const HAIR  = '#5a3a1a';

    // body / pyjama back (long horizontal)
    ctx.fillStyle = SUIT;
    ctx.fillRect(3, 5, 14, 5);
    ctx.fillRect(4, 4, 12, 1);
    // pyjama dot pattern
    ctx.fillStyle = SUIT2;
    ctx.fillRect(6, 6, 1, 1);
    ctx.fillRect(10, 7, 1, 1);
    ctx.fillRect(13, 5, 1, 1);
    ctx.fillRect(15, 8, 1, 1);

    // head (right side)
    ctx.fillStyle = SKIN;
    ctx.fillRect(16, 3, 5, 6);
    ctx.fillRect(17, 2, 3, 1);
    // hair tuft + cap
    ctx.fillStyle = HAIR;
    ctx.fillRect(17, 1, 3, 2);
    ctx.fillRect(16, 2, 1, 1);
    ctx.fillRect(20, 2, 1, 1);
    // eye
    ctx.fillStyle = DARK;
    ctx.fillRect(18, 5, 1, 1);
    // cheek dab
    ctx.fillStyle = '#e7708a';
    ctx.fillRect(20, 6, 1, 1);

    // arm (front leg) and leg (back) — alternate
    ctx.fillStyle = SUIT;
    if (frame === 0) {
      ctx.fillRect(4, 9, 3, 3);    // back leg planted
      ctx.fillRect(14, 9, 3, 3);   // front arm forward
      ctx.fillRect(10, 10, 2, 2);  // mid leg lifted
    } else {
      ctx.fillRect(5, 9, 3, 3);
      ctx.fillRect(13, 9, 3, 3);
      ctx.fillRect(8, 10, 2, 2);
    }
    // booties at the limbs
    ctx.fillStyle = '#fff';
    ctx.fillRect(4, 11, 2, 1);
    ctx.fillRect(15, 11, 2, 1);

    return c;
  }

  function drawChildSquashed() {
    const c = makeCanvas(24, 6);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#7cc8ff';
    ctx.fillRect(2, 1, 20, 4);
    ctx.fillStyle = '#5a9fdb';
    ctx.fillRect(2, 4, 20, 1);
    ctx.fillStyle = '#f6c7a3';
    ctx.fillRect(17, 2, 4, 2);
    return c;
  }

  // ---------------------------------------------------------------------------
  //  Wasp — flying, sine-wave patrol. Yellow + black striped body, twin
  //  wings (animated on a 2-frame flap), wraparound eyes. 18 × 12. Cannot
  //  be stomped — must be killed with a fishbone projectile.
  // ---------------------------------------------------------------------------

  function drawWasp(frame) {
    const c = makeCanvas(18, 12);
    const ctx = c.getContext('2d');
    const Y    = '#ffd166';
    const Y2   = '#e89a3a';
    const DARK = '#1a1a1e';
    // wings — translucent grey rectangles, flap by changing height
    const wingH = frame === 0 ? 4 : 6;
    const wingY = frame === 0 ? 1 : 0;
    ctx.fillStyle = 'rgba(220,230,255,0.55)';
    ctx.fillRect(3, wingY, 5, wingH);
    ctx.fillRect(10, wingY, 5, wingH);
    // wing veins
    ctx.fillStyle = 'rgba(120,140,170,0.7)';
    ctx.fillRect(5, wingY + 1, 1, wingH - 2);
    ctx.fillRect(12, wingY + 1, 1, wingH - 2);

    // body — striped abdomen
    ctx.fillStyle = Y;
    ctx.fillRect(3, 5, 12, 5);
    ctx.fillRect(4, 4, 10, 1);
    ctx.fillRect(4, 10, 10, 1);
    // black stripes
    ctx.fillStyle = DARK;
    ctx.fillRect(6, 5, 2, 5);
    ctx.fillRect(10, 5, 2, 5);
    // shading
    ctx.fillStyle = Y2;
    ctx.fillRect(3, 9, 12, 1);

    // head (right end) — round
    ctx.fillStyle = DARK;
    ctx.fillRect(13, 5, 3, 5);
    ctx.fillRect(14, 4, 2, 1);
    ctx.fillRect(14, 10, 2, 1);
    // big compound eye
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(14, 6, 2, 2);
    ctx.fillStyle = DARK;
    ctx.fillRect(15, 7, 1, 1);

    // stinger (left tail end)
    ctx.fillStyle = DARK;
    ctx.fillRect(0, 7, 3, 1);
    ctx.fillRect(2, 6, 1, 3);

    return c;
  }

  function drawWaspKilled() {
    // After being shot the wasp falls — an X-eyed limp version. Same 18×12
    // canvas so swap-in is trivial.
    const c = makeCanvas(18, 12);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(3, 5, 12, 5);
    ctx.fillStyle = '#1a1a1e';
    ctx.fillRect(6, 5, 2, 5);
    ctx.fillRect(10, 5, 2, 5);
    ctx.fillRect(13, 5, 3, 5);
    // X eye
    ctx.fillStyle = '#fff';
    ctx.fillRect(14, 6, 2, 2);
    ctx.fillStyle = '#1a1a1e';
    ctx.fillRect(14, 6, 1, 1);
    ctx.fillRect(15, 7, 1, 1);
    ctx.fillRect(15, 6, 1, 1);
    ctx.fillRect(14, 7, 1, 1);
    // limp wings (down)
    ctx.fillStyle = 'rgba(180,190,210,0.5)';
    ctx.fillRect(3, 10, 5, 2);
    ctx.fillRect(10, 10, 5, 2);
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

  // Tiny cat-head icon for the HUD lives counter — 14×14 pixel art so it
  // matches the rest of the HUD style instead of the vector body sprite.
  function drawCatHead() {
    const c = makeCanvas(14, 14);
    const ctx = c.getContext('2d');
    // ears
    ctx.fillStyle = '#e89a3a';
    ctx.fillRect(2, 2, 2, 3);
    ctx.fillRect(10, 2, 2, 3);
    ctx.fillRect(2, 1, 1, 1);
    ctx.fillRect(11, 1, 1, 1);
    // inner ears
    ctx.fillStyle = '#e7708a';
    ctx.fillRect(3, 3, 1, 1);
    ctx.fillRect(10, 3, 1, 1);
    // head
    ctx.fillStyle = '#e89a3a';
    ctx.fillRect(3, 4, 8, 7);
    ctx.fillRect(2, 5, 1, 5);
    ctx.fillRect(11, 5, 1, 5);
    ctx.fillRect(4, 3, 6, 1);
    ctx.fillRect(4, 11, 6, 1);
    // muzzle
    ctx.fillStyle = '#fff8e8';
    ctx.fillRect(5, 8, 4, 3);
    // eyes
    ctx.fillStyle = '#16161d';
    ctx.fillRect(5, 6, 1, 2);
    ctx.fillRect(8, 6, 1, 2);
    // eye glint
    ctx.fillStyle = '#84e36b';
    ctx.fillRect(5, 6, 1, 1);
    ctx.fillRect(8, 6, 1, 1);
    // nose
    ctx.fillStyle = '#e7708a';
    ctx.fillRect(6, 9, 2, 1);
    return c;
  }

  // ---------------------------------------------------------------------------
  //  Tiles — 32×32. Pounce's palette is a cozy autumn-sunset look: grass
  //  reads as dry-amber meadow rather than bright midday green, dirt is a
  //  warm walnut, and platforms are dark cherry-wood. The whole world should
  //  feel like the cat is heading home for a nap as the day winds down.
  //
  //  Palette:
  //   --grass-blade   #d6b86a   (sunlit grass tip)
  //   --grass-base    #a89045   (warmer mid-grass)
  //   --grass-shadow  #786226   (grass shadow)
  //   --dirt-1        #7a4f2e   (walnut)
  //   --dirt-2        #5a3a1a   (deep walnut)
  //   --dirt-3        #a8703a   (sunlit walnut)
  //   --wood-top      #b07344   (cherry-wood top)
  //   --wood-mid      #7e4d28   (cherry shadow)
  //   --wood-dark     #4a2a13   (dark base)
  // ---------------------------------------------------------------------------

  function drawGrass() {
    const c = makeCanvas(32, 32);
    const ctx = c.getContext('2d');
    // dirt base
    ctx.fillStyle = '#7a4f2e';
    ctx.fillRect(0, 0, 32, 32);
    // grass band
    ctx.fillStyle = '#a89045';
    ctx.fillRect(0, 0, 32, 8);
    // sunlit tip
    ctx.fillStyle = '#d6b86a';
    ctx.fillRect(0, 0, 32, 3);
    // grass blades poking up
    ctx.fillStyle = '#a89045';
    ctx.fillRect(2, 0, 1, 4);
    ctx.fillRect(7, 0, 2, 5);
    ctx.fillRect(13, 0, 1, 3);
    ctx.fillRect(19, 0, 2, 6);
    ctx.fillRect(25, 0, 1, 4);
    ctx.fillRect(29, 0, 2, 5);
    // shadow under the grass band
    ctx.fillStyle = '#786226';
    ctx.fillRect(0, 7, 32, 1);
    // dirt freckles
    ctx.fillStyle = '#5a3a1a';
    ctx.fillRect(4, 12, 2, 2);
    ctx.fillRect(14, 18, 2, 2);
    ctx.fillRect(22, 22, 2, 2);
    ctx.fillRect(8, 26, 2, 2);
    ctx.fillStyle = '#a8703a';
    ctx.fillRect(10, 16, 1, 1);
    ctx.fillRect(26, 10, 1, 1);
    ctx.fillRect(20, 28, 1, 1);
    return c;
  }

  function drawDirt() {
    const c = makeCanvas(32, 32);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#7a4f2e';
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = '#5a3a1a';
    ctx.fillRect(4, 4, 2, 2);
    ctx.fillRect(14, 8, 2, 2);
    ctx.fillRect(22, 12, 2, 2);
    ctx.fillRect(8, 18, 2, 2);
    ctx.fillRect(20, 22, 2, 2);
    ctx.fillRect(28, 28, 2, 2);
    ctx.fillRect(2, 14, 2, 2);
    ctx.fillStyle = '#a8703a';
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
    ctx.fillStyle = '#b07344';
    ctx.fillRect(0, 0, 32, 16);
    ctx.fillStyle = '#7e4d28';
    ctx.fillRect(0, 12, 32, 4);
    ctx.fillStyle = '#4a2a13';
    ctx.fillRect(0, 16, 32, 16);
    // wood grain
    ctx.fillStyle = '#7e4d28';
    ctx.fillRect(2, 4, 8, 1);
    ctx.fillRect(14, 8, 6, 1);
    ctx.fillRect(22, 4, 8, 1);
    // bottom rim highlight
    ctx.fillStyle = '#2a1607';
    ctx.fillRect(0, 30, 32, 2);
    // edge nails
    ctx.fillStyle = '#1a0e04';
    ctx.fillRect(2, 19, 1, 1);
    ctx.fillRect(29, 19, 1, 1);
    return c;
  }

  // ---------------------------------------------------------------------------
  //  Power-up box (tile type 'Q'). Solid red 32×32 block with a small
  //  cat-food-can icon on the front. When the cat hits one from below, it
  //  pops a can and the box turns into the brown "used" variant ('@').
  //  Two-frame "bobble" so an unused box has a tiny idle animation.
  // ---------------------------------------------------------------------------

  function drawBox(frame) {
    const c = makeCanvas(32, 32);
    const ctx = c.getContext('2d');
    // body — bright red
    ctx.fillStyle = '#cc2929';
    ctx.fillRect(0, 0, 32, 32);
    // top + left highlight, bottom + right shadow (give it depth)
    ctx.fillStyle = '#ff5555';
    ctx.fillRect(0, 0, 32, 3);
    ctx.fillRect(0, 0, 3, 32);
    ctx.fillStyle = '#7a1818';
    ctx.fillRect(0, 29, 32, 3);
    ctx.fillRect(29, 0, 3, 32);
    // gold rivets in the corners
    ctx.fillStyle = '#ffd166';
    [[4,4],[26,4],[4,26],[26,26]].forEach(([x,y]) => ctx.fillRect(x, y, 2, 2));
    // small cat-food-can icon on the face. Frame 0/1 bobs by 1px.
    const bob = frame === 1 ? 1 : 0;
    // can outline
    ctx.fillStyle = '#3a2410';
    ctx.fillRect(11, 9 + bob, 10, 14);
    // top + bottom rim
    ctx.fillStyle = '#92400e';
    ctx.fillRect(11, 9 + bob, 10, 2);
    ctx.fillRect(11, 21 + bob, 10, 2);
    // label
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(12, 11 + bob, 8, 10);
    // fish silhouette on the label
    ctx.fillStyle = '#3a2410';
    ctx.fillRect(13, 14 + bob, 5, 3);
    ctx.fillRect(17, 13 + bob, 1, 1);
    ctx.fillRect(17, 17 + bob, 1, 1);
    // label highlight
    ctx.fillStyle = '#fde58a';
    ctx.fillRect(13, 12 + bob, 1, 1);
    return c;
  }

  // The "used" / popped version — same dimensions, brown, no icon, no rivets.
  function drawBoxUsed() {
    const c = makeCanvas(32, 32);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#8b5a2b';
    ctx.fillRect(0, 0, 32, 32);
    // bevel
    ctx.fillStyle = '#a8703a';
    ctx.fillRect(0, 0, 32, 3);
    ctx.fillRect(0, 0, 3, 32);
    ctx.fillStyle = '#5a3a1a';
    ctx.fillRect(0, 29, 32, 3);
    ctx.fillRect(29, 0, 3, 32);
    // dim rivets so it still reads as a block
    ctx.fillStyle = '#5a3a1a';
    [[4,4],[26,4],[4,26],[26,26]].forEach(([x,y]) => ctx.fillRect(x, y, 2, 2));
    return c;
  }

  // The "magic fish" power-up. Pops out of a Q-box when the cat is already
  // big — eating it grants the shooter state (fishbone projectile). Larger
  // and gold-tinted compared with the regular fish *treat* so it reads as
  // "this is special" at a glance.
  function drawMagicFish() {
    const c = makeCanvas(22, 16);
    const ctx = c.getContext('2d');
    // body
    ctx.fillStyle = '#5cd4f0';
    ctx.fillRect(2, 4, 13, 8);
    ctx.fillRect(3, 3, 11, 1);
    ctx.fillRect(3, 12, 11, 1);
    ctx.fillRect(4, 2, 9, 1);
    ctx.fillRect(4, 13, 9, 1);
    // tail (longer / forked)
    ctx.fillRect(15, 4, 2, 8);
    ctx.fillRect(17, 3, 2, 10);
    ctx.fillRect(19, 1, 2, 14);
    // belly
    ctx.fillStyle = '#a8ecf8';
    ctx.fillRect(3, 6, 9, 4);
    // eye
    ctx.fillStyle = '#000';
    ctx.fillRect(5, 5, 1, 2);
    ctx.fillStyle = '#fff';
    ctx.fillRect(5, 5, 1, 1);
    // gold sparkles + stripe (the "magic" tell)
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(8, 4, 1, 1);
    ctx.fillRect(11, 7, 1, 1);
    ctx.fillRect(7, 9, 1, 1);
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(7, 1, 1, 1);
    ctx.fillRect(10, 0, 1, 1);
    ctx.fillRect(13, 1, 1, 1);
    return c;
  }

  // Fishbone projectile — the cat throws these once it has eaten a magic
  // fish. Two frames: ribs alternate between offset positions to fake a
  // spinning motion as the bone arcs through the air. 12×8.
  function drawFishbone(frame) {
    const c = makeCanvas(12, 8);
    const ctx = c.getContext('2d');
    // skull at the head
    ctx.fillStyle = '#fff8e8';
    ctx.fillRect(0, 2, 3, 4);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 3, 1, 1);          // eye socket
    // central spine
    ctx.fillStyle = '#fff8e8';
    ctx.fillRect(2, 3, 9, 2);
    // ribs — alternate between (2,5,8) and (3,6,9) for a tumble effect
    if (frame === 0) {
      ctx.fillRect(2, 1, 1, 6);
      ctx.fillRect(5, 1, 1, 6);
      ctx.fillRect(8, 1, 1, 6);
    } else {
      ctx.fillRect(3, 1, 1, 6);
      ctx.fillRect(6, 1, 1, 6);
      ctx.fillRect(9, 1, 1, 6);
    }
    // tail bone — small chevron at right
    ctx.fillStyle = '#fff8e8';
    ctx.fillRect(11, 2, 1, 4);
    return c;
  }

  // The cat-food can that pops out of a box. Drawn as a free-floating item
  // sprite, 14×16. Same colour scheme as the icon on the box face.
  function drawCatFoodCan() {
    const c = makeCanvas(14, 16);
    const ctx = c.getContext('2d');
    // outline
    ctx.fillStyle = '#3a2410';
    ctx.fillRect(1, 1, 12, 14);
    // top + bottom rim
    ctx.fillStyle = '#92400e';
    ctx.fillRect(2, 2, 10, 2);
    ctx.fillRect(2, 12, 10, 2);
    // label
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(2, 4, 10, 8);
    // fish silhouette
    ctx.fillStyle = '#3a2410';
    ctx.fillRect(3, 7, 6, 2);
    ctx.fillRect(8, 6, 1, 1);
    ctx.fillRect(8, 9, 1, 1);
    // label shine
    ctx.fillStyle = '#fde58a';
    ctx.fillRect(3, 5, 2, 1);
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
    // Sunset cloud — cream lit from below, peach underside.
    ctx.fillStyle = '#fff4d6';
    ctx.fillRect(8, 8, 48, 12);
    ctx.fillRect(16, 4, 32, 4);
    ctx.fillRect(22, 1, 22, 3);
    ctx.fillRect(4, 12, 4, 6);
    ctx.fillRect(56, 12, 4, 6);
    ctx.fillRect(0, 14, 4, 4);
    ctx.fillRect(60, 14, 4, 4);
    // peach underside (catches sunset light)
    ctx.fillStyle = '#f5b87f';
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

    dog:   { walk0: drawDog(0),   walk1: drawDog(1),   squashed: drawDogSquashed() },
    child: { walk0: drawChild(0), walk1: drawChild(1), squashed: drawChildSquashed() },
    wasp:  { walk0: drawWasp(0),  walk1: drawWasp(1),  squashed: drawWaspKilled() },
    yarn: drawYarn(),
    fish: drawFish(),
    catHead: drawCatHead(),
    box:        { idle0: drawBox(0), idle1: drawBox(1), used: drawBoxUsed() },
    catFoodCan: drawCatFoodCan(),
    magicFish:  drawMagicFish(),
    fishbone:   { f0: drawFishbone(0), f1: drawFishbone(1) },
    grass: drawGrass(),
    dirt: drawDirt(),
    platform: drawPlatform(),
    bed: drawBed(),
    cloud: drawCloud(),
  };
})(window);
