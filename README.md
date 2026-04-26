# Whiskers' Adventure

A small browser-playable 2D side-scrolling platformer where you control a cat named Whiskers
collecting fish treats and yarn balls on the way to a cozy bed. Built from scratch with vanilla
HTML / CSS / JavaScript and the Canvas 2D API — no external libraries, no copyrighted assets.

## Quick start

There is no build step. Any way of serving the folder over HTTP works:

    cd cat-platformer
    python3 -m http.server 8000
    # open http://localhost:8000/

Or, on most modern browsers, you can simply double-click `index.html` to open it directly
(file:// works too because nothing is loaded across origins).

## Controls

| Action | Keys                       |
| ------ | -------------------------- |
| Move   | A / D or Left / Right      |
| Jump   | W, Up Arrow, or Space      |
| Pause  | P                          |
| Restart (after game over / win) | Enter or R |

On the title screen, the four cat swatches let you pick which cat to play as
(SHADOW, WHISKERS, PATCHES, or GINGER). Use Left / Right (or A / D) to cycle, or
click a swatch to select directly. Press Space, W, Up, or Enter to start.

The browser blocks audio until the first keypress, so the title screen also
unlocks the Web Audio context. Your cat choice is saved between sessions in
`localStorage` under the key `whiskers_cat`.

## File structure

    cat-platformer/
    ├── index.html        Entry point — loads the canvas and JS files
    ├── style.css         Page chrome and pixel-perfect canvas styling
    ├── README.md         This file
    └── js/
        ├── sprites.js    Procedural pixel-art sprites generated at load time
        ├── audio.js      Tiny Web Audio API SFX (jump, stomp, collect, ...)
        ├── level.js      ASCII tilemap describing the level
        └── game.js       Engine: physics, collisions, camera, rendering, HUD, states

## How the level data works

`js/level.js` exposes the level as an array of equal-length strings, one per tile row.
Each character is a tile:

    .   empty (sky)
    #   ground top (grass)
    =   underground (dirt)
    -   floating wooden platform
    P   player start
    G   goal (the cozy bed)
    F   fish treat   (collectible, +10 points)
    Y   yarn ball    (collectible, +50 points)
    B   bug enemy    (small, walks back and forth)
    D   dust bunny   (slower patroller)

The grid is `LEVEL_WIDTH × LEVEL_HEIGHT` tiles where each tile is 32 × 32 pixels. To make a
new level, just edit the strings — each row gets auto-padded to the longest row's width.

## How the engine works (highlights)

* **Physics.** A standard fixed-gravity model. Each frame the player accumulates horizontal
  velocity from input (with linear acceleration and friction), and `vy += GRAVITY` pulls them
  down. Jump sets `vy = -JUMP_VEL`. While the jump key is held during ascent, gravity is
  reduced — this gives a *variable-height jump* (tap = small hop, hold = full jump).
* **Coyote time and jump buffering.** Two small timers (~0.1 s each) make platforming forgiving:
  you can still jump for a few frames after walking off a ledge, and pressing jump just before
  landing still triggers a jump on contact.
* **Collisions.** Resolved per-axis: the player moves horizontally first, then any tile
  overlaps push them back; then the same on the vertical axis (which also sets `onGround`).
  This is the classic "axis-aligned tilemap collision" technique and avoids corner sticking.
* **Stomp vs hurt.** When the player overlaps an enemy, we check whether the player is
  *falling* (`vy > 0`) and whether their feet are near the enemy's top. If so, the enemy is
  squashed and the player gets a small upward bounce. Otherwise the player gets hit, takes
  knockback, loses a life, and is briefly invulnerable.
* **Camera.** Centred on the player horizontally and clamped to the level bounds. Two layers
  of parallax (clouds at 0.3×, hills at 0.5×) sell the depth.

## Asset / license note

Everything here is original or generated procedurally:

* **Cat sprites** — drawn with vector primitives (ellipses, triangles, paths) via the
  `drawCat` function in `js/sprites.js`. The drawing code and the four palettes (black,
  tabby, calico, orange) are a direct port from my own Cat-Ski companion project — both
  written from scratch by me, no external imagery. Each palette × state is pre-baked into
  a 56×48 canvas at startup so we blit pixels instead of re-rendering vectors every frame.
* **Environment / enemies / collectibles** — every other sprite (bug, dust bunny, yarn
  ball, fish treat, cozy bed, grass, dirt, wood platform, cloud) is pixel-art drawn
  with `fillRect` calls in `js/sprites.js`.
* **Sound effects** — synthesised at runtime from `OscillatorNode`s in `js/audio.js`. No
  audio files are loaded.
* **Music** — none.
* **Fonts** — only the user agent's default monospace stack.

No Nintendo (or other third-party) art, names, music, level layouts, or enemy designs were
used. The level was hand-authored to teach controls similarly to a classic 8-bit first stage
(flat tutorial → small jump → enemy → bigger gap with a stepping platform → raised section →
goal) but the layout, geometry, and enemies are original.

You can freely modify, redistribute, and reuse everything in this folder under the MIT
License if you want a formal one — otherwise consider it CC0/public domain.

## Swapping in better art and sound

The code is structured so this is straightforward:

* To use external sprite images, replace the canvases produced in `js/sprites.js` with
  `Image` objects (load them, then assign to the same `Sprites.*` keys used in `game.js`).
  The rest of the engine doesn't care whether `drawImage` is given a procedurally generated
  canvas or a loaded PNG.
* To swap sound effects, replace the functions in `js/audio.js` (`Audio.jump`, `Audio.collect`,
  etc.) with calls to `new Audio('path/to/file.wav').play()` or `AudioBufferSource` playback.
  All gameplay code only calls the named functions, so the rest is untouched.
* To author new levels, edit the strings in `js/level.js`. Add new tile characters by
  extending the legend and the small `loadLevel` switch in `js/game.js`.
