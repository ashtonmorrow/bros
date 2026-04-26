/* level.js — level data for Whiskers' Adventure.
 *
 * The level is laid out using a programmatic builder rather than a hand-typed
 * ASCII grid. The builder is a thin wrapper around a 2D char array; each
 * function (`ground`, `plat`, etc.) writes one feature into the grid. The
 * final grid is exported as `LEVEL` (an array of length-W strings) for
 * compatibility with `game.js`, which iterates by row/col.
 *
 * --------------------------------------------------------------------------
 * DESIGN PRINCIPLES
 * --------------------------------------------------------------------------
 *
 * The level follows the four-act structure popularised by Nintendo / Koichi
 * Hayashida (kishōtenketsu): introduction → development → twist → conclusion.
 * It also borrows from the six common 2D-platformer patterns documented by
 * Smith, Padget, & Vargas-Iglesias: Guidance, Foreshadowing, Safe Zone,
 * Layering, Branching, Pace Breaking.
 *
 *   ACT 1 — INTRODUCTION (cols 0–49, ~50 tiles)
 *     Flat tutorial ground with a treat trail (Guidance) so the player walks
 *     right; one trivial pit; one short pit; one slow enemy with a low-risk
 *     high path (Branching) carrying a bonus collectible.
 *
 *   ACT 2 — DEVELOPMENT (cols 50–114, ~65 tiles)
 *     Same beats as Act 1, but ramps up: wider pits, stacked platforms
 *     (Layering — three heights), a second enemy type, and a small mid-air
 *     stepping platform that previews the bigger pit-jumps coming in Act 3
 *     (Foreshadowing).
 *
 *   ACT 3 — TWIST (cols 115–184, ~70 tiles)
 *     Climax. Long pit with two stepping mid-air platforms (the hardest
 *     traversal in the level), a high "sky route" with bonus yarn the player
 *     has to climb up to, and a tower of stairs (verticality showcase).
 *
 *   ACT 4 — CONCLUSION (cols 185–239, ~55 tiles)
 *     Pace-breaker — a wide, enemy-free recovery stretch (Safe Zone) so the
 *     player can breathe after the climax — then one last gauntlet, then a
 *     goal staircase that ends with the cozy bed at the top, in clear sight
 *     from the start of the section (Guidance).
 *
 * The cat's running jump can clear ~5 horizontal tiles flat (or 6 with full
 * variable-jump hold), and reach ~5 tiles vertically. Pits are sized to stay
 * inside those bounds, with mid-air stepping platforms in any gap > 5 wide.
 *
 * --------------------------------------------------------------------------
 * TILE LEGEND
 * --------------------------------------------------------------------------
 *
 *   '.'  empty (sky)
 *   '#'  ground top (grass)
 *   '='  underground (dirt)
 *   '-'  floating wooden platform
 *   'P'  player start
 *   'G'  goal (cozy bed)
 *   'F'  fish treat   (+10)
 *   'Y'  yarn ball    (+50)
 *   'B'  bug enemy    (small fast patroller)
 *   'D'  dust bunny   (slow patroller)
 *
 * Adding new entity / tile types: extend the legend, then add a case to the
 * `loadLevel` switch in `js/game.js`.
 */
(function (global) {
  'use strict';

  const W = 240;
  const H = 15;

  // ----- builder helpers -----
  const grid = [];
  for (let y = 0; y < H; y++) grid.push(new Array(W).fill('.'));

  function set(c, r, ch) {
    if (c >= 0 && c < W && r >= 0 && r < H) grid[r][c] = ch;
  }
  /** A solid ground section: grass on row 12, dirt rows 13–14. */
  function ground(c, len) {
    for (let i = 0; i < len; i++) {
      set(c + i, 12, '#');
      set(c + i, 13, '=');
      set(c + i, 14, '=');
    }
  }
  /** A floating wooden platform at the given row. */
  function plat(c, r, len) {
    for (let i = 0; i < len; i++) set(c + i, r, '-');
  }
  /** Drop an entity glyph at one tile. */
  function ent(c, r, ch) { set(c, r, ch); }


  /* ------------------------------------------------------------------------
   *  ACT 1 — INTRODUCTION  (cols 0–49)
   * ------------------------------------------------------------------------ */

  // Tutorial flat. No enemies. Treats laid out in a curve to teach "go right".
  ground(0, 16);
  ent(1, 11, 'P');
  ent(8,  11, 'F');
  ent(11, 11, 'F');
  ent(13, 11, 'F');

  // Pit #1 — 3 wide, easy first jump (cols 16–18).
  ground(19, 11);
  ent(24, 11, 'F');

  // Pit #2 — 3 wide (cols 30–32). Repeat the lesson.
  ground(33, 17);
  ent(40, 11, 'B');                  // first enemy — slow, on a long flat
  // Branching: optional high path with a bonus yarn ball.
  plat(38, 7, 5);
  ent(40, 6, 'Y');
  ent(45, 11, 'F');


  /* ------------------------------------------------------------------------
   *  ACT 2 — DEVELOPMENT  (cols 50–114)
   * ------------------------------------------------------------------------ */

  // Pit #3 — 4 wide (cols 50–53).
  ground(54, 12);
  ent(58, 11, 'D');                  // dust bunny — slower, easier to stomp
  ent(63, 11, 'F');

  // Pit #4 — 4 wide (cols 66–69).
  // Layering showcase: ground + mid platform + high platform with yarn ball.
  ground(70, 17);
  ent(73, 11, 'F');
  ent(83, 11, 'F');
  plat(74, 8, 5);                    // mid ledge
  ent(76, 7, 'F');
  plat(76, 5, 4);                    // top ledge
  ent(77, 4, 'Y');
  ent(80, 11, 'B');

  // Pit #5 — 5 wide (cols 87–91).
  ground(92, 11);
  ent(95, 11, 'D');
  ent(100, 11, 'B');

  // Pit #6 — 5 wide (cols 103–107) with a single mid-air stepping stone
  // (Foreshadowing — Act 3 has wider pits with multiple steppers).
  plat(104, 9, 3);
  ent(105, 8, 'F');

  // Stair-up section — climbing teaching beat (cols 108–120).
  // Each step is at a unique col range — non-overlapping in x — so the player
  // never ends up overlapping a step they're not standing on.
  ground(108, 7);
  plat(115, 11, 2);                  // step 1: cols 115–116, row 11 (1 up)
  plat(117, 10, 2);                  // step 2: cols 117–118, row 10 (2 up)
  plat(119, 9, 5);                   // step 3 / landing: cols 119–123, row 9 (3 up)


  /* ------------------------------------------------------------------------
   *  ACT 3 — TWIST  (cols 115–184)
   * ------------------------------------------------------------------------ */

  // Disconnected platform sequence — the player has to make 3 jumps in a row
  // with no ground below; the only safety net is the platforms themselves.
  // The stair top (cols 119–123) serves as the entry to this sequence.
  ent(120, 8, 'F');                  // bonus collectible on stair top
  plat(126, 8, 4);                   // cols 126–129, row 8 (1 up from stair top)
  ent(127, 7, 'F');
  plat(132, 7, 4);                   // cols 132–135, row 7 (1 up again)
  ent(133, 6, 'Y');                  // peak yarn — the climb's reward

  // Sky-route end: drops back to ground at col 135.
  ground(135, 14);
  ent(140, 11, 'F');
  ent(143, 11, 'B');
  ent(146, 11, 'D');                 // 3 enemies in a row — apply skills

  // The level's hardest pit — 7 wide (cols 149–155) with TWO stepping
  // platforms at different heights so the player has to plan a path.
  plat(150, 9, 2);
  plat(153, 7, 2);
  ent(153, 6, 'F');

  // Tower / staircase up (cols 156–170). Vertical showcase. Each step is at
  // a unique col range so they don't trap the player inside a tile.
  ground(156, 6);
  plat(162, 10, 3);                  // cols 162–164, row 10
  plat(165, 9, 3);                   // cols 165–167, row 9
  plat(168, 7, 3);                   // cols 168–170, row 7  (2-row jump)
  ent(169, 6, 'Y');                  // peak yarn — reward for the climb
  // Drop-off past col 170 — player falls down to ground level.

  // Drop-zone ground (cols 170–184).
  ground(170, 15);
  ent(174, 11, 'F');
  ent(178, 11, 'B');
  ent(182, 11, 'F');


  /* ------------------------------------------------------------------------
   *  ACT 4 — CONCLUSION  (cols 185–239)
   * ------------------------------------------------------------------------ */

  // Pace-breaker: wide, enemy-free flat (Safe Zone). Lots of treats — payoff
  // for surviving Act 3, and visual "calm before the goal".
  ground(185, 18);
  ent(190, 11, 'F');
  ent(194, 11, 'F');
  ent(198, 11, 'F');
  ent(201, 11, 'F');

  // Final pit — 4 wide (cols 203–206). Deliberately easy after the lull.
  ground(207, 14);
  ent(210, 11, 'D');                 // single enemy back-to-final
  ent(214, 11, 'F');
  // Bonus: a high yarn ball above the final stretch.
  plat(215, 7, 4);
  ent(216, 6, 'Y');

  // Goal staircase. The bed is visible from col ~218 onward — the player
  // sees the destination well before they have to climb to it. Steps are
  // non-overlapping so the cat can stand on each one without clipping.
  ground(221, 19);
  plat(225, 11, 3);                  // step 1: cols 225–227, row 11
  plat(228, 10, 3);                  // step 2: cols 228–230, row 10
  plat(231, 9, 3);                   // step 3: cols 231–233, row 9
  plat(234, 8, 6);                   // top:    cols 234–239, row 8 (bed sits here)
  ent(235, 7, 'Y');                  // bonus yarn just before the bed
  ent(237, 7, 'G');                  // GOAL


  // ----- finalise -----
  // Convert each row from a char array to a string.
  const LEVEL = grid.map(row => row.join(''));

  global.LEVEL = LEVEL;
  global.LEVEL_WIDTH = W;
  global.LEVEL_HEIGHT = H;
})(window);
