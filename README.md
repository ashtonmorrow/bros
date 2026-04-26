# Pounce

A free browser side-scroller. Play as a cat — pick from four palettes —
bounding through a hand-built tile level on the way to a cozy bed. Stomp bugs,
collect treats and yarn balls, reach the goal. Vanilla HTML / Canvas / Web
Audio. No build step. Sister project of
[cat-ski](https://github.com/ashtonmorrow/cat-ski).

Production URL (planned): https://pounce.mike-lee.me/

## Quick start

There is no build step. Any way of serving the folder over HTTP works:

    cd pounce
    python3 -m http.server 8000
    # then open http://localhost:8000/

The game is also playable directly from the filesystem (`open index.html`)
because nothing is loaded across origins.

## Controls

| Action  | Keys                            |
| ------- | ------------------------------- |
| Move    | A / D or Left / Right           |
| Jump    | W, Up Arrow, or Space           |
| Pause   | P                               |
| Restart | R or Enter (after game over / win) |

On the title screen, four cat swatches let you pick which cat to play as
(SHADOW, WHISKERS, PATCHES, GINGER). Use Left / Right or A / D to cycle, click
a swatch to select directly, or press Space / W / Up / Enter to start with the
current selection. The choice persists in `localStorage` under the key
`pounce_cat`.

## File structure

    pounce/
    ├── index.html        Entry point — canvas + script loads
    ├── readme.html       Long-form article version of this README
    ├── style.css         Page chrome
    ├── README.md         This file
    ├── CLAUDE.md         Project context for Claude (writing voice, conventions)
    └── js/
        ├── sprites.js    Pixel-art tiles + four vector cats
        ├── audio.js      Web Audio synthesised SFX
        ├── level.js      ASCII tilemap built programmatically
        └── game.js       Engine: physics, collisions, camera, HUD, states

## How the level works

`js/level.js` is a builder, not a hand-typed grid. Each function (`ground`,
`plat`, `ent`) writes one feature into a 240 × 15 char array, which is then
exported as `LEVEL` (an array of length-240 strings) for `game.js` to consume.

Tile legend:

    .   empty (sky)
    #   ground top (grass)
    =   underground (dirt)
    -   floating wooden platform
    P   player start
    G   goal (cozy bed)
    F   fish treat   (+10)
    Y   yarn ball    (+50)
    B   bug enemy    (small fast patroller)
    D   dust bunny   (slow patroller)

The level is structured around the four-act kishōtenketsu framework
(intro → development → twist → conclusion) and annotated section-by-section
with the six 2D-platformer level patterns it uses (Guidance, Foreshadowing,
Safe Zone, Layering, Branching, Pace Breaking). See `js/level.js` for the
full breakdown.

## How the engine works

| Component        | Implementation                                        |
| ---------------- | ----------------------------------------------------- |
| Rendering        | HTML5 Canvas, 800 × 480, image-rendering: pixelated   |
| Game loop        | Vanilla JS, requestAnimationFrame                     |
| Physics          | Per-axis tilemap collision; gravity 0.5 px / frame²   |
| Variable jump    | Reduced gravity (0.275) while ascending + jump held   |
| Forgiveness      | 0.10 s coyote time + 0.10 s jump buffer               |
| Cat sprites      | Vector primitives, four palettes from the cat-ski drawCat |
| Other sprites    | Procedural pixel art (`fillRect`)                     |
| Audio            | Web Audio API; OscillatorNode tones, no audio files   |
| State persistence| `localStorage` for selected cat                       |
| Hosting          | Vercel, deployed from the GitHub repo on push         |

The cat is symmetric (front-facing), so it doesn't flip when you change
direction. That tradeoff is intentional: the vector geometry doesn't survive
a horizontal flip cleanly (markings and patches mirror), and a chibi
forward-facing cat reads correctly to the player without it.

## Asset / license note

Everything in this folder is original or generated procedurally:

- **Cat sprites** — drawn with vector primitives in `js/sprites.js`. Code and
  the four palettes (black, tabby, calico, orange) are shared with cat-ski,
  which is the same author. No external imagery.
- **World sprites** — every other sprite (bugs, dust bunnies, yarn ball, fish
  treat, bed, grass, dirt, platform, cloud) is pixel-art drawn with `fillRect`
  calls.
- **Sound effects** — synthesised at runtime from `OscillatorNode`s in
  `js/audio.js`. No audio files are loaded.
- **Music** — none.
- **Fonts** — only the user agent's default monospace stack.

No third-party game art, names, music, level layouts, or enemy designs were
used. The level was hand-authored to teach controls similarly to a classic
8-bit first stage but the layout, geometry, and enemies are original.

You can freely modify, redistribute, and reuse everything in this folder
under the MIT License if you want a formal one — otherwise consider it
CC0/public domain.

## Roadmap

The current build is the platforming foundation. Planned next:

- **Power-up boxes.** Red `?`-style blocks that pop a can of cat food when hit
  from below. Most cans buff (extra hit absorbed before death); some debuff
  (shrink the cat). Rare boxes contain a fish that gives the cat a projectile.
- **Projectile combat.** When powered, the cat can throw fishbones to kill
  enemies at range. Cooldown between shots.
- **New enemies.** Replace the bug / dust bunny placeholders with three real
  obstacle animals: dog (walking), small child (crawling, low-arc jump
  required to clear), and wasp (flying, can't be stomped — must be shot).
- **Branding pass.** Palette + tile re-art to match a Pounce visual identity
  rather than the placeholder green-grass-and-blue-sky we have now.
- **PWA.** `manifest.json` + `sw.js` so the game is installable for offline
  play, like cat-ski.

Sister project: [cat-ski](https://github.com/ashtonmorrow/cat-ski) — same
author, same stack, same writing voice. See `CLAUDE.md` for the project's
voice and convention notes.
