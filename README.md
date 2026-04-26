# Pounce

A free browser side-scrolling cat platformer. Pick from four cat palettes
and bound through a 240-tile hand-built level on the way to a cozy bed.
Cat-food boxes power you up, magic fish unlock a fishbone projectile, dogs
and crawling kids can be stomped, wasps have to be shot or down-pounced.
Vanilla HTML / CSS / JavaScript with Canvas + Web Audio. No build step.

Production URL (planned): https://pounce.mike-lee.me/

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

| Action  | Keys                                         |
| ------- | -------------------------------------------- |
| Move    | A / D or Left / Right                        |
| Jump    | W, Up Arrow, or Space                        |
| Down-pounce | S or Down Arrow (in mid-air only)        |
| Shoot fishbone | X (only when in shooter state)        |
| Pause   | P                                            |
| Restart | R, Enter, or Space (after game-over / win)   |
| Mute music | M (also a button in the page chrome)      |

On the title screen, four cat swatches let you pick which cat to play as
(SHADOW, WHISKERS, PATCHES, GINGER). Use Left / Right or A / D to cycle,
click to pick, then Space / W / Up / Enter to start. The choice persists
across sessions in `localStorage` under `pounce_cat`.

## Mechanics in brief

- **Power state.** The cat starts `small`. Bonking a red `?`-style box pops
  a cat-food can; eating it grows the cat to `big` (absorbs one hit before
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
- **Leaderboard.** Top-three global high scores via Supabase, with a
  localStorage cache so the strip paints instantly. On level-complete or
  game-over, scoring high enough prompts for a 5-character name.

## File structure

    pounce/
    ├── index.html        Entry point — canvas + script loads
    ├── readme.html       Long-form article version of this README
    ├── style.css         Page chrome
    ├── manifest.json     PWA manifest
    ├── sw.js             Service worker (offline cache + install)
    ├── robots.txt        SEO — allow all + sitemap pointer
    ├── sitemap.xml       SEO — / and /readme.html
    ├── llms.txt          AI-discovery summary
    ├── preview.png       OG / Twitter card image (1200×630)
    ├── README.md         This file
    ├── CLAUDE.md         Project context for Claude (writing voice, conventions)
    ├── favicon*.png/.ico, apple-touch-icon.png, icon-{192,512}.png
    └── js/
        ├── sprites.js    Pixel-art tiles + four vector cats
        ├── audio.js      Web Audio synthesised SFX + music loop
        ├── level.js      ASCII tilemap built programmatically
        └── game.js       Engine: physics, collisions, camera, HUD, states

## How the level works

`js/level.js` is a builder, not a hand-typed grid. Each function (`ground`,
`plat`, `ent`) writes one feature into a 240 × 15 char array, which is then
exported as `LEVEL` (an array of length-240 strings) for `game.js` to
consume.

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

The level is structured around the four-act kishōtenketsu framework
(intro → development → twist → conclusion) and annotated section-by-section
with the six 2D-platformer level patterns it uses (Guidance, Foreshadowing,
Safe Zone, Layering, Branching, Pace Breaking). See `js/level.js` for the
full breakdown.

## How the engine works

| Component        | Implementation                                               |
| ---------------- | ------------------------------------------------------------ |
| Rendering        | HTML5 Canvas, 800 × 480, image-rendering: pixelated          |
| Game loop        | Vanilla JS, requestAnimationFrame, dt clamped to 50 ms       |
| Physics          | Per-axis tilemap collision; gravity 0.5 px / frame²          |
| Variable jump    | Reduced gravity (0.275) while ascending + jump held          |
| Forgiveness      | 0.10 s coyote time + 0.10 s jump buffer                      |
| Down-pounce      | vy snaps to 14, vx locked to 0; insta-kill on impact         |
| Cat sprites      | Vector primitives, four palettes shared with cat-ski; small / big size sets |
| Other sprites    | Procedural pixel art (`fillRect`)                            |
| Audio            | Web Audio API; OscillatorNode tones + 4-bar music loop        |
| Leaderboard      | Supabase REST (anon-keyed, RLS) + localStorage cache          |
| State persistence| `localStorage` for selected cat, music pref, leaderboard cache, last name |
| Hosting          | Vercel, deployed from GitHub on push                         |
| PWA              | manifest.json + sw.js (network-first HTML, cache-first assets) |

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
- **Music** — synthesised in `js/audio.js` (square-wave melody + triangle
  bass over an I–V–vi–IV progression in C, 132 BPM, 4-bar loop).
- **Fonts** — Google Fonts: `Press Start 2P` for the bezel chrome, `VT323`
  for the controls hint. Otherwise the user agent's default monospace.

No third-party game art, names, music, level layouts, or enemy designs were
used.

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
(`true`) for submitting. Until the table exists, the leaderboard runs purely
off `localStorage` — works fine for one device, just no cross-device sync.

## Roadmap

The current build closes Phase 3 + the polish round. Open ideas:

- **Mobile / touch controls.** Currently desktop-only; add an on-screen
  joystick + jump/pounce/shoot buttons that appear on touch devices, like
  cat-ski does.
- **More levels.** The engine + level builder support arbitrary maps; the
  shipped level is one. World-2-style follow-up is doable.
- **Music variations.** One loop right now; could expand to per-act variants
  that fade between sections.
