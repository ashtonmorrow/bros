# CLAUDE.md — project context for Pounce

This file is the standing context for any Claude session that works on this
project. It captures the writing voice and the high-level structure decisions
so future sessions don't re-derive them. Edit it as the project evolves.

Sister project: [cat-ski](https://github.com/ashtonmorrow/cat-ski) — same
author, same voice, same deploy pattern. When in doubt, match cat-ski.

## Project

**Name**: Pounce
**Tagline**: A free browser side-scroller. Play as a cat trying to reach the cozy bed.
**Production URL**: https://pounce.mike-lee.me/
**Source**: https://github.com/ashtonmorrow/bros
**Hosting**: Vercel, auto-deployed from `main`
**Stack**: vanilla HTML / CSS / JavaScript, HTML5 Canvas, Web Audio API. No build
step. No framework. Sprites are either pixel-art (`fillRect`) or vector (the
four cat palettes shared with cat-ski).

## Writing voice — required for all collateral

Match cat-ski. The voice is plain, concrete, and quietly confident.

**Tone**
- Plain prose. No marketing-ese, no hyperbole, no "amazing / stunning / blazing-fast."
- Active voice. Third person ("the cat," "the player," "the level") not first person.
- Short paragraphs — 2-4 sentences. One idea per paragraph.
- No emoji. No exclamation points except where the game itself uses them
  ("LEVEL COMPLETE!" is fine; "Check it out!" is not).

**Specificity**
- Use real numbers. "approximately 50 KB," "960 tiles wide," "0.5 px / frame²."
  Vague claims read as filler.
- When you describe a design choice, say *why*. Pair the constraint with the
  benefit: "Single file because that's what the original used; the practical
  payoff is sub-minute deploys."
- Link inline to anything a reader might want to verify (Wikipedia, schema.org,
  related projects). Use real anchor text, not "click here."

**Structure**
- Headlines describe the section, they're not jokes. "How the game is built,"
  not "How the sausage gets made."
- Use tables for structured technical info (component → implementation,
  control → action, etc.).
- Avoid bullet lists in body prose. Use them only when the items truly are a
  list and not a sentence.

**Things to avoid**
- "Genuinely," "honestly," "straightforward," "simply," "just."
- "AI-powered," "vibe coding," and other category buzzwords — except where
  describing the project's *actual* relationship to those terms.
- Restating the previous paragraph in different words. Move forward.

## File conventions

- `README.md` — GitHub-style project readme. Practical: install, run, file
  structure, license, deploy.
- `readme.html` — long-form article version, hosted as a page on the site.
  Same structure as cat-ski's readme.html: about, how to play, how it's built,
  design criteria per element, working with Claude as a collaborator,
  how-you-can-build-this-yourself, further resources.
- `index.html` — the game itself. Includes JSON-LD `VideoGame` schema, OG /
  Twitter cards, favicon links, manifest link.
- `manifest.json` — PWA manifest (when added).
- `sw.js` — service worker (when added).
- `llms.txt` — AI-discovery summary at the project root, mirroring cat-ski's
  format (title, description, pages list, about, optional links).

## Schema conventions

Every public-facing HTML page ships JSON-LD structured data. Match cat-ski's
shapes:

- `index.html` — `@type: VideoGame` with name, description, url, image,
  inLanguage, applicationCategory, gamePlatform, genre, isAccessibleForFree,
  playMode, free Offer, author + publisher (Mike Lee), datePublished,
  softwareVersion.
- `readme.html` — `@type: TechArticle` with headline, description, image,
  datePublished, dateModified, inLanguage, isAccessibleForFree,
  proficiencyLevel, about[] of key topics, author + publisher,
  mainEntityOfPage pointing at the canonical URL.

Author block, used in both:
```json
{ "@type": "Person", "name": "Mike Lee",
  "alternateName": "Whisker Leaks",
  "url": "https://www.linkedin.com/in/mikelee89/" }
```

## High-level architecture

- `js/sprites.js` — procedural sprites. Pixel-art for the world; vector cats
  (four palettes from cat-ski: black, tabby, calico, orange).
- `js/audio.js` — Web Audio synthesised SFX. No audio files.
- `js/level.js` — ASCII tilemap built programmatically. Comments describe the
  kishōtenketsu structure (intro / development / twist / conclusion) and which
  of the six 2D level patterns each section uses.
- `js/game.js` — engine, physics, collisions, camera, HUD, screen states.

## Phase plan (current state)

The full Phase-1-through-Tier-3 plan plus a polish round and a UI cleanup
pass have all shipped. The build is a complete trilogy with deep QoL.

1. **Phase 1 — done.** Kishōtenketsu pacing, non-overlapping staircases,
   four-cat picker.
2. **Phase 2 — done.** Pounce rename, README + readme.html, JSON-LD
   schema, left-edge wall, cat-shaped HUD lives icon, bezel chrome,
   responsive canvas sizing, favicon set.
3. **Phase 3 — done.** Cat-food power-up boxes (`Q` tile; small → big →
   shooter state machine, Mario-style), magic fish in big-state boxes
   granting fishbone projectile, three obstacle animals (dog, crawling
   child, wasp), cozy autumn-sunset palette pass.
4. **Polish round — done.** Music loop, step-puff dust particles + body
   bob for run animation, hidden sky-routes per level, denser collectible
   trails over every pit.
5. **Phase 4 — done.** Music + SFX on/off toggles, global top-3
   leaderboard via Supabase + localStorage cache, redrawn dog sprite,
   down-pounce ability.
6. **Site infrastructure — done.** PWA manifest + service worker,
   robots.txt, sitemap.xml, placeholder preview.png OG card, cross-links
   in bezel to sister projects.
7. **Tier-1 QoL — done.** Screen shake, volume sliders, full pause overlay
   with controls + cat preview, mobile touch controls, death transition +
   pit-respawn fade.
8. **Multi-level — done.** Three levels in `LEVELS[]`, level-select on
   the title screen with per-level best-score chips, padlock icon for
   locked levels, between-level progression.
9. **Tier-3 QoL — done.** Difficulty modes (Easy/Normal/Hard with lives,
   timer, and enemy-speed knobs), gamepad support (any standard layout),
   high-contrast mode, mid-run save state (auto-snapshot to localStorage
   every 2 s, resumable from the title screen).
10. **Tier-2 polish — done.** Box-bonk pop animation on Q boxes,
    goal-reach settle (cat curls onto the bed with sleep-Z particles
    before the win panel), session-best HUD pip, eased camera look-ahead,
    in-world tutorial hints in the early stretch of level 1.
11. **UI cleanup — done.** Single canvas brand (bezel only), trophy +
    "TOP 3" anchor on the leaderboard strip, padlock icons replacing
    "LOCKED" text, removed cat-name labels and difficulty blurbs,
    icon-only audio toggles, compacted controls hint, no duplicate help.
12. **Level expansion — done.** L1 expanded to 960 tiles (4 movements +
    goal staircase), L2 and L3 each at 720 tiles, all three audited for
    physics-clearable pits.

## Open work

- **Real preview.png.** The placeholder is a sunset-gradient with the
  cat silhouette and a wordmark. A real screenshot of the game in
  motion would read better as an OG card.
- **Supabase `pounce_scores` table.** The leaderboard runs locally
  without it; create the table (`id` int8 identity, `created_at`
  timestamptz, `name` varchar, `score` int8) with RLS allowing anon
  SELECT and INSERT to enable cross-device global scoring.
