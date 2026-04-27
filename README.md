# Pounce

A free browser side-scrolling cat platformer. Pick from four cat palettes
and bound through three hand-built levels (960 / 720 / 720 tiles wide) on
the way to a cozy bed. Cat-food boxes power you up, magic fish unlock a
fishbone projectile, dogs and crawling kids can be stomped, wasps have to
be shot or down-pounced. Vanilla HTML / CSS / JavaScript with Canvas + Web
Audio. No build step.

Production URL: https://pounce.mike-lee.me/

Sister projects (all on the same stack): [cat-ski](https://ski.mike-lee.me/),
[pear](https://pear.mike-lee.me/), [go](https://go.mike-lee.me/) — see
[mike-lee.me](https://mike-lee.me/) for the home page.

## Quick start

There is no build step. Any way of serving the folder over HTTP works:

    cd pounce
    python3 -m http.server 8000
    # then open http://localhost:8000/

The game is also playable from the filesystem (`open index.html`) because
nothing is loaded across origins. The PWA service worker only registers
under http(s) so file:// loads skip it.

## Controls

| Action      | Keys                                       |
| ----------- | ------------------------------------------ |
| Move        | A / D or ← / →                             |
| Jump        | W, ↑, or Space                             |
| Down-pounce | S or ↓ (in mid-air only)                   |
| Shoot       | X (only when in shooter state)             |
| Pause       | P                                          |
| Restart     | R, Enter, or Space (after game-over / win) |
| Music       | M (also a button below the game frame)     |
| Sound FX    | N (also a button below the game frame)     |
| High contrast | C (also a button below the game frame)   |

Title-screen-only shortcuts: 1 / 2 / 3 jump to a specific level (if
unlocked), L cycles through unlocked levels, E / H switch difficulty, R
discards the saved mid-run snapshot. Gamepads (any standard layout) are
auto-detected — A jumps, X shoots, B pounces, Start advances, Select
pauses.

## Mechanics in brief

- **Power state.** The cat starts `small`. Bonking a `?`-style box pops a
  cat-food can; eating it grows the cat to `big` (absorbs one hit before
  dying). Bonking another box while big pops a magic fish; eating it grants
  the `shooter` state. Hits revert the cat to small Mario-style.
- **Fishbone projectile.** In shooter state, X fires a 12×8 spinning
  fishbone in the facing direction. Cooldown ~0.32 s. Bounces off the floor
  up to four times. One-shots any enemy on contact.
- **Down-pounce.** While in mid-air, pressing S or ↓ slams the cat straight
  down at 14 px/frame (faster than max-fall). Locks horizontal control.
  Lands instant kills on any enemy — including wasps, which are otherwise
  immune to stomping. +200 points (vs +100 for a regular stomp).
- **Enemies.** Dogs walk and patrol, can be stomped or shot or pounced.
  Crawling kids are shorter and slower (low-arc jump clears them). Wasps
  fly in a sine wave and can't be stomped — only shot or pounced.
- **Difficulty.** Easy (5 lives, 280 s, 0.75× enemy speed), Normal (3
  lives, 200 s, 1×), Hard (1 life, 150 s, 1.3×). Picked on the title
  screen and persisted in `localStorage`.
- **Mid-run save.** Every couple seconds during play, a small snapshot of
  the run (level, score, lives, position, popped boxes, stomped enemies)
  is auto-saved to `localStorage`. Closing the tab and coming back lets
  you resume from the title screen. Cleared on win or after 30 days.
- **Leaderboard.** Top-three global high scores via Supabase, with a
  localStorage cache so the strip paints instantly. Submitting prompt
  fires only on the final level (HOMEWARD BOUND).

## File structure

    pounce/
    ├── index.html        Entry point — canvas + script loads
    ├── readme.html       Long-form article version of this README
    ├── privacy.html      Privacy policy (lists every localStorage key)
    ├── style.css         Page chrome
    ├── manifest.json     PWA manifest
    ├── sw.js             Service worker (offline cache + install)
    ├── robots.txt        SEO — allow all + sitemap pointer
    ├── sitemap.xml       SEO — /, /readme.html, /privacy.html
    ├── llms.txt          AI-discovery summary
    ├── preview.png       OG / Twitter card image (1200×630)
    ├── README.md         This file
    ├── CLAUDE.md         Project context for Claude (writing voice, conventions)
    ├── favicon*.png/.ico, apple-touch-icon.png, icon-{192,512}.png
    └── js/
        ├── sprites.js    Pixel-art tiles + four vector cats
        ├── audio.js      Web Audio synthesised SFX + music loop
        ├── level.js      ASCII tilemaps built programmatically (3 levels)
        └── game.js       Engine: physics, collisions, camera, HUD, states

## How the levels work

`js/level.js` is a builder, not a hand-typed grid. Each level function
(`buildLevel1` / `buildLevel2` / `buildLevel3`) creates a fresh builder,
calls `ground` / `plat` / `ent` / `treatArc` to write features into a
W × 15 char array, and exports the result. The three grids land in
`window.LEVELS`.

Tile legend:

    .   empty (sky)
    #   ground top (grass)
    =   underground (dirt)
    -   floating wooden platform
    Q   power-up box (cat food → big, or magic fish if already big)
    @   used / popped box (cosmetic, set by game.js when a Q is bonked)
    P   player start
    G   goal (cozy bed)
    F   fish treat   (+10)
    Y   yarn ball    (+50)
    B   dog          (walking patroller, stompable)
    D   crawling child (short, slow patroller, stompable)
    W   wasp         (flying, can't be stomped — shoot or down-pounce)

Each level follows the four-act kishōtenketsu framework (intro →
development → twist → conclusion) and uses the six 2D-platformer level
patterns documented in the file: Guidance, Foreshadowing, Safe Zone,
Layering, Branching, Pace Breaking. See `js/level.js` for the
section-by-section breakdown.

## How the engine works

| Component         | Implementation                                                |
| ----------------- | ------------------------------------------------------------- |
| Rendering         | HTML5 Canvas, 800 × 480, image-rendering: pixelated           |
| Game loop         | Vanilla JS, requestAnimationFrame, dt clamped to 50 ms        |
| Physics           | Per-axis tilemap collision; gravity 0.5 px / frame²           |
| Variable jump     | Reduced gravity (0.275) while ascending + jump held           |
| Forgiveness       | 0.10 s coyote time + 0.10 s jump buffer                       |
| Down-pounce       | vy snaps to 14, vx locked to 0; insta-kill on impact          |
| Camera            | Follows the cat with eased look-ahead in the facing direction |
| Cat sprites       | Vector primitives, four palettes shared with cat-ski; small / big size sets |
| Other sprites     | Procedural pixel art (`fillRect`)                             |
| Audio             | Web Audio API; OscillatorNode tones routed through master SFX + music gain nodes for instant on/off |
| Music             | Square-wave melody + triangle bass over I–V–vi–IV in C, 132 BPM, 4-bar loop |
| Input             | Keyboard, touch buttons (auto-shown on coarse pointers), and Gamepad API (any standard layout) |
| Leaderboard       | Supabase REST (anon-keyed, RLS) + localStorage cache          |
| State persistence | `localStorage` for cat pick, music/SFX prefs, volumes, last level, unlock progress, leaderboard cache, last submitted name, difficulty, high-contrast toggle, and mid-run snapshot |
| Hosting           | Vercel, deployed from GitHub on push                          |
| PWA               | manifest.json + sw.js (network-first HTML, cache-first assets) |

## Asset / license note

Everything in this folder is original or generated procedurally:

- **Cat sprites** drawn with vector primitives in `js/sprites.js`. Code and
  the four palettes (black, tabby, calico, orange) are shared with cat-ski,
  same author.
- **World sprites** — every other sprite (dog, child, wasp, yarn, fish,
  power-up box, cat-food can, magic fish, fishbone projectile, bed, grass,
  dirt, platform, cloud) is pixel-art drawn with `fillRect`.
- **Sound effects** synthesised at runtime from `OscillatorNode`s in
  `js/audio.js`. No audio files are loaded.
- **Music** synthesised in `js/audio.js` (see table above).
- **Fonts** — Google Fonts: `Press Start 2P` for the bezel chrome, `VT323`
  for the controls hint. Otherwise the user agent's default monospace.

No third-party game art, names, music, level layouts, or enemy designs
were used.

You can freely modify, redistribute, and reuse everything in this folder
under the MIT License if you want a formal one — otherwise consider it
CC0/public domain.

## Setting up the global leaderboard

The code points at the same Supabase project as cat-ski with a different
table name. To wire it up, create a `pounce_scores` table in your Supabase
project with the schema:

    id          int8 primary key generated by default as identity
    created_at  timestamptz default now()
    name        varchar
    score       int8

Enable Row Level Security and add two policies for the `anon` role: a
`select` policy (`true`) for fetching the top-3, and an `insert` policy
(`true`) for submitting. Until the table exists, the leaderboard runs
purely off `localStorage` — works fine for one device, just no cross-device
sync.
