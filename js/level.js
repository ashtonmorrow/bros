/* level.js — level data for Pounce.
 *
 * Each level is laid out using a programmatic builder rather than a
 * hand-typed ASCII grid. The builder is a thin wrapper around a 2D char
 * array; each function (`ground`, `plat`, etc.) writes one feature into the
 * grid. Each level's final grid is bundled with metadata into a level
 * object, and the array of all levels is exported as `LEVELS`.
 *
 * --------------------------------------------------------------------------
 * DESIGN PRINCIPLES
 * --------------------------------------------------------------------------
 *
 * Each level follows the four-act structure popularised by Nintendo / Koichi
 * Hayashida (kishōtenketsu): introduction → development → twist → conclusion.
 * It also borrows from the six common 2D-platformer patterns documented by
 * Smith, Padget, & Vargas-Iglesias: Guidance, Foreshadowing, Safe Zone,
 * Layering, Branching, Pace Breaking.
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
 *   'Q'  cat-food box (solid; head-bump from below pops a can; +200 / grow)
 *   '@'  used / popped box (solid; cosmetic — placed by game.js, not by you)
 *   'P'  player start
 *   'G'  goal (cozy bed)
 *   'F'  fish treat   (+10)
 *   'Y'  yarn ball    (+50)
 *   'B'  dog          (walking patroller, larger; stomp from above to kill)
 *   'D'  crawling child(short, slow patroller; stomp to clear)
 *   'W'  wasp         (flying, sine-wave path; CANNOT be stomped — shoot it)
 *
 * Adding new entity / tile types: extend the legend, then add a case to the
 * `loadLevel` switch in `js/game.js`.
 */
(function (global) {
  'use strict';

  const H = 15;

  // Builder factory — gives each level its own fresh grid + helpers so
  // levels don't accidentally write into one another.
  function makeBuilder(width) {
    const grid = [];
    for (let y = 0; y < H; y++) grid.push(new Array(width).fill('.'));

    function set(c, r, ch) {
      if (c >= 0 && c < width && r >= 0 && r < H) grid[r][c] = ch;
    }
    function ground(c, len) {
      for (let i = 0; i < len; i++) {
        set(c + i, 12, '#');
        set(c + i, 13, '=');
        set(c + i, 14, '=');
      }
    }
    function plat(c, r, len) {
      for (let i = 0; i < len; i++) set(c + i, r, '-');
    }
    function ent(c, r, ch) { set(c, r, ch); }

    // Convenience: a treat-arc over a pit at columns [start..end]. The arc
    // peaks at row `peakRow`, with shoulders at `peakRow + 1`.
    function treatArc(start, end, peakRow) {
      peakRow = peakRow == null ? 8 : peakRow;
      ent(start, peakRow + 1, 'F');
      for (let x = start + 1; x < end; x++) ent(x, peakRow, 'F');
      ent(end, peakRow + 1, 'F');
    }

    function finalize() {
      return grid.map(row => row.join(''));
    }

    return { ground, plat, ent, treatArc, finalize, width };
  }


  /* =========================================================================
   *  LEVEL 1 — "MEADOW WALK" (the original sunset level, expanded)
   *
   *  Four movements, ~240 tiles each. Each opens with a calm tutorial-style
   *  beat, escalates into a section-specific twist, and closes with a
   *  recovery + transition into the next movement. The final movement ends
   *  at the goal (cozy bed).
   *
   *  Movement D ("ROOFTOP RUN") was added in a later pass to lengthen the
   *  level toward the user's original "9× longer" brief. It picks up after
   *  movement C's old "final stretch" beat and replaces what used to be the
   *  goal staircase with a longer mid-air sequence over a deep canyon
   *  before the cat reaches the bed.
   * ======================================================================= */

  function buildLevel1() {
    const W = 960;
    const b = makeBuilder(W);
    const { ground, plat, ent, treatArc } = b;

    /* ============================================================
     *  Level 1 is laid out as 14 rhythm groups across 4 movements,
     *  each group authored as setup → challenge → cadence. Group
     *  lengths target 30–55 tiles (4–7 seconds at base run speed,
     *  ~3 seconds at sprint).
     *
     *  Set pieces marked with ★. Branching choices marked with ⇆.
     *  Required gaps stay ≤6 tiles flat (or have a step inside);
     *  sprint-only gaps (8–10 tiles, no step) are reserved for
     *  optional shortcuts and bonus rooms, never required paths.
     * ============================================================ */

    /* ===== Movement A — Tutorial (cols 0-220) =================== */

    // ── Group A1 (cols 0-30): walk + first jump.
    // Setup: empty flat to confirm right=forward. Challenge: a tiny
    // 2-tile pit you can't walk through, can clear at any speed.
    // Cadence: a small flat with a treat-curve leading the eye onward.
    ground(0, 18);
    ent(1, 11, 'P');
    ent(8,  11, 'F');
    ent(11, 11, 'F');
    ent(14, 11, 'F');
    ent(16, 10, 'F');                // first treat that asks "can you jump?"
    treatArc(18, 19, 9);             // 2-tile tutorial pit, treat overhead
    ground(20, 12);
    ent(23, 11, 'F');
    ent(26, 11, 'F');
    ent(29, 11, 'F');

    // ── Group A2 (cols 32-72): first power-up + first enemy.
    // Setup: cadence flat from A1. Challenge: a Q-box right above the
    // approach to a dog patrol — bonk for cat-food, stomp the dog.
    // Cadence: brief flat with a yarn-ball-on-platform reward.
    treatArc(32, 34, 9);             // 3-tile gap (still very gentle)
    ground(35, 16);
    ent(38, 8, 'Q');                 // first power-up box
    ent(41, 11, 'F');
    ent(44, 11, 'B');                // first enemy: dog
    ent(47, 11, 'F');
    plat(49, 7, 4);
    ent(50, 6, 'Y');                 // off-path yarn — small decision
    treatArc(51, 54, 8);             // 4-tile gap, treats arcing over
    ground(55, 18);
    ent(58, 11, 'F');
    ent(60, 11, 'F');
    ent(63, 11, 'B');                // second dog — pattern starts
    ent(67, 11, 'F');
    ent(70, 11, 'F');

    // ── Group A3 (cols 74-130): ★ SPRINT CORRIDOR.
    // Set piece: a long flat with treats curving in a fast line that
    // visually pulls the player into a sprint. Two ways across the
    // gap at the end:
    //   • LOW route — a 6-tile gap (walk-jumpable) with a stepping
    //     platform mid-gap, no reward.
    //   • HIGH route — a row-6 platform reachable only at sprint
    //     speed, with a bonus yarn.
    treatArc(74, 76, 9);
    ground(77, 30);                  // long flat to build sprint
    ent(78, 11, 'F'); ent(80, 11, 'F'); ent(82, 11, 'F');
    ent(84, 11, 'F'); ent(86, 11, 'F'); ent(88, 10, 'F');
    ent(90, 9,  'F'); ent(92, 8,  'F');                    // arc lifts off the ground
    ent(94, 7,  'Y');                                      // yarn at the peak — sprint pays off
    ent(96, 8,  'F'); ent(98, 9,  'F'); ent(100, 10, 'F');
    ent(102, 11, 'F'); ent(104, 11, 'F'); ent(106, 11, 'F');
    // High (sprint-only) route — yarn reward.
    plat(110, 6, 4);
    ent(111, 5, 'Y');
    ent(113, 5, 'F');
    // Low route — 6-tile gap with a mid-air step for non-sprinters.
    plat(110, 9, 2);                 // stepping plat for the low route
    treatArc(107, 112, 8);
    ground(113, 18);                 // landing flat for both routes
    ent(116, 11, 'F'); ent(118, 11, 'F');
    ent(121, 11, 'D');               // first crawling child
    ent(125, 11, 'F'); ent(128, 11, 'F');

    // ── Group A4 (cols 132-200): ★ STAIRCASE WITH WASP.
    // Set piece: a 4-step staircase up to a Q-box that pops a magic
    // fish (shooter state), guarded by a wasp. The wasp can be shot
    // (after eating the fish) or pounced. Ground route below skips
    // the climb entirely but loses the shooter power-up.
    treatArc(132, 134, 9);
    ground(135, 56);                 // staircase + landing flat (one continuous floor)
    ent(138, 11, 'F');
    ent(140, 11, 'B');               // dog patrols at the base
    ent(143, 11, 'D');
    plat(146, 11, 3);
    plat(149, 10, 3);
    plat(152, 9, 3);
    plat(155, 8, 5);                 // top tier — reward platform
    ent(156, 7, 'F');
    ent(158, 5, 'W');                // wasp guarding the prize
    ent(159, 7, 'Q');                // magic-fish box (shooter state)
    ent(161, 7, 'F');
    // Drop back down — landing zone, brief recovery.
    ent(168, 11, 'F'); ent(171, 11, 'F'); ent(174, 11, 'F');
    ent(177, 11, 'F'); ent(180, 11, 'F'); ent(183, 11, 'F');
    ent(186, 11, 'F');

    // ── Group A5 (cols 192-220): cadence — recovery flat + transition.
    treatArc(192, 195, 8);
    ground(196, 26);
    ent(196, 11, 'F'); ent(199, 11, 'F'); ent(202, 11, 'F');
    ent(206, 11, 'F'); ent(209, 11, 'F');
    ent(213, 11, 'F'); ent(216, 11, 'F'); ent(219, 11, 'F');

    /* ===== Movement B — Vertical exploration (cols 222-460) ===== */

    // ── Group B1 (cols 222-280): ★ THREE-DOG STOMP COMBO.
    // Set piece: three dogs spaced exactly so a sustained stomp
    // chain works. Bonus yarn appears on the third stomp's bounce
    // arc — visible from the start of the run as a target.
    treatArc(222, 225, 8);
    ground(226, 42);
    ent(230, 11, 'B');
    ent(238, 11, 'B');
    ent(246, 11, 'B');
    plat(248, 7, 3);
    ent(249, 6, 'Y');                // bounce-arc reward
    ent(254, 11, 'F'); ent(257, 11, 'F'); ent(260, 11, 'F');

    // ── Group B2 (cols 268-330): ★ Q-BOX WALL CLIMB.
    // Set piece: three Q-boxes stacked vertically. Bonk the lowest,
    // it becomes a solid @ tile. Use it to jump and bonk the middle,
    // then the top. Each pop spawns a treat. Ladder leads to a
    // hidden pocket with a yarn ball.
    treatArc(268, 271, 8);
    ground(272, 26);
    ent(275, 11, 'F');
    ent(278, 11, 'D');
    ent(282, 11, 'F');
    // The wall: three Q-boxes stacked, bottom at row 9, then 6, then 3.
    // After bonking, each becomes solid and serves as the next step.
    ent(288, 9, 'Q');
    ent(288, 6, 'Q');
    ent(288, 3, 'Q');
    ent(290, 2, 'Y');                // hidden pocket reward
    ent(290, 4, 'F');
    ent(286, 7, 'F');                // visible "look up here" treat
    ent(294, 11, 'F'); ent(297, 11, 'F');

    // ── Group B3 (cols 300-400): ⇆ BRANCHING PATHS.
    // Decision: ground route below has more enemies and treats; sky
    // rail above is faster but skips the score-payoff. Both rejoin.
    treatArc(300, 303, 8);
    ground(304, 92);                 // long contiguous floor for branching
    // Lower (ground) route — enemy gauntlet + scattered treats.
    ent(308, 11, 'F'); ent(312, 11, 'F'); ent(316, 11, 'F');
    ent(320, 11, 'B'); ent(324, 11, 'D'); ent(328, 11, 'F');
    ent(332, 11, 'B'); ent(336, 11, 'F'); ent(340, 11, 'D');
    ent(344, 11, 'F'); ent(348, 11, 'F'); ent(352, 11, 'B');
    ent(356, 11, 'F'); ent(360, 11, 'F'); ent(364, 11, 'F');
    ent(368, 11, 'D'); ent(372, 11, 'F'); ent(376, 11, 'F');
    ent(380, 11, 'F'); ent(384, 11, 'F'); ent(388, 11, 'F');
    // Upper (sky) route — a row-3 catwalk for fast traversal, no
    // enemies, but only 5 yarns instead of the ground path's enemies.
    plat(312, 3, 80);
    ent(316, 2, 'Y'); ent(330, 2, 'Y'); ent(344, 2, 'Y');
    ent(360, 2, 'Y'); ent(376, 2, 'Y');
    // Climb up to the sky route from the ground flat.
    plat(306, 9, 2);
    plat(310, 6, 2);
    ent(310, 5, 'F');
    // Climb back down after the rail ends.
    plat(394, 6, 2);
    plat(392, 9, 2);

    // ── Group B4 (cols 396-460): ★ WASP TUNNEL.
    // Set piece: a low ceiling forces the cat under three wasps in
    // formation. Shoot or pounce — height is too tight for a normal
    // jump-stomp. Ends Movement B.
    treatArc(396, 399, 8);
    ground(400, 26);
    plat(403, 4, 22);                // long low ceiling
    ent(406, 6, 'W');
    ent(412, 6, 'W');
    ent(418, 6, 'W');
    ent(408, 11, 'B');
    ent(415, 11, 'D');
    ent(421, 11, 'F'); ent(423, 11, 'F');
    ent(425, 11, 'F');
    treatArc(428, 431, 8);
    ground(432, 28);
    ent(436, 11, 'F'); ent(440, 11, 'F'); ent(444, 11, 'F');
    ent(448, 11, 'D'); ent(452, 11, 'F'); ent(455, 11, 'B');
    ent(458, 11, 'F');

    /* ===== Movement C — Twist: speed + sky (cols 460-720) ======= */

    // ── Group C1 (cols 462-540): ★ DOWNHILL DESCENT.
    // Set piece: a stepped descent. Cat drops from a high plateau
    // through three platforms, each one tile down + 4 forward.
    // Treats curve down the slope to encourage the speedy path.
    treatArc(462, 465, 8);
    ground(466, 14);
    plat(471, 8, 4);                 // top plateau
    ent(472, 7, 'Y');
    ent(474, 7, 'F');
    plat(477, 9, 4);
    ent(478, 8, 'F');
    plat(483, 10, 4);
    ent(484, 9, 'F');
    plat(489, 11, 4);
    ent(490, 10, 'F');
    ground(493, 22);                 // landing flat
    ent(496, 11, 'F'); ent(499, 11, 'F'); ent(502, 11, 'F');
    ent(505, 11, 'B');
    ent(509, 11, 'F'); ent(513, 11, 'F');

    // ── Group C2 (cols 518-580): WIDE CANYON CHOICE.
    // ⇆ Two ways across: a 5-tile gap with a mid-air step at row 9
    // (walk-jumpable), or a sprint shortcut over the top via plat row 6.
    treatArc(518, 522, 8);
    plat(520, 9, 2);                 // mid-air step for the safe path
    plat(521, 6, 4);                 // higher shortcut plat (sprint route)
    ent(522, 5, 'F');
    ent(524, 5, 'Y');
    ground(523, 30);
    ent(526, 11, 'F'); ent(529, 11, 'F'); ent(531, 8, 'Q');
    ent(534, 11, 'D'); ent(537, 11, 'F');
    ent(541, 11, 'F'); ent(544, 11, 'F'); ent(547, 11, 'F');

    // ── Group C3 (cols 552-650): MID-AIR FORMATION.
    // Two wasps + one dog under stepping platforms. Sprint-jump
    // across the formation skips most of the threat; walking forces
    // engagement.
    treatArc(552, 555, 8);
    ground(556, 50);
    plat(560, 7, 3);
    ent(561, 6, 'F');
    plat(566, 5, 3);
    ent(566, 4, 'W');                // wasp on its own platform — shoot or pounce
    plat(573, 7, 3);
    ent(574, 6, 'F');
    ent(580, 5, 'W');                // free-flying wasp
    ent(575, 11, 'B');
    ent(579, 11, 'D');
    ent(583, 11, 'F'); ent(586, 11, 'F');
    ent(590, 11, 'B');
    ent(594, 11, 'F'); ent(598, 11, 'F'); ent(602, 11, 'F');

    // ── Group C4 (cols 612-720): pace breaker + recovery.
    // Calm flat, lots of treats, prepares the player for the final
    // approach. Recovery before the conclusion.
    treatArc(606, 611, 8);
    plat(608, 9, 2);                 // stepping plat across the canyon
    ground(612, 64);
    ent(620, 11, 'F'); ent(623, 11, 'F'); ent(626, 11, 'F');
    ent(630, 11, 'F'); ent(633, 11, 'F');
    ent(637, 11, 'D');
    ent(641, 11, 'F'); ent(644, 11, 'F');
    plat(648, 7, 4);
    ent(649, 6, 'F');
    ent(651, 6, 'Y');
    ent(655, 11, 'F'); ent(658, 11, 'F');
    ent(662, 11, 'F'); ent(665, 11, 'F');
    ent(668, 11, 'F'); ent(671, 11, 'F');

    /* ===== Movement D — Conclusion (cols 680-960) =============== */

    // ── Group D1 (cols 680-770): SAFE-ZONE / VICTORY LAP.
    // Long flat, dense with treats. The cat is "running home."
    treatArc(676, 683, 8);
    plat(679, 9, 2);                 // stepping plat
    ground(684, 40);
    ent(688, 11, 'F'); ent(691, 11, 'F'); ent(694, 11, 'F');
    ent(697, 11, 'F'); ent(700, 11, 'F'); ent(703, 11, 'F');
    ent(706, 11, 'F'); ent(709, 11, 'F'); ent(712, 11, 'F');
    ent(715, 11, 'F'); ent(718, 11, 'F'); ent(721, 11, 'F');

    // ── Group D2 (cols 728-800): ★ LAST-CHANCE Q WALL + ENEMY PILE-UP.
    // Set piece: a final cat-food box + magic-fish box, then a tight
    // ground formation of two dogs and a wasp before the goal climb.
    treatArc(724, 731, 8);
    plat(727, 9, 2);                 // stepping plat
    ground(732, 32);
    ent(735, 8, 'Q');                // last cat-food box
    ent(738, 11, 'F');
    ent(741, 8, 'Q');                // last magic-fish box
    ent(744, 11, 'F');
    ent(747, 11, 'B');
    ent(750, 6, 'W');                // wasp overhead
    ent(753, 11, 'D');
    ent(756, 11, 'B');
    ent(759, 11, 'F'); ent(762, 11, 'F');
    treatArc(764, 768, 8);
    ground(769, 26);
    ent(773, 11, 'F'); ent(777, 11, 'F'); ent(781, 11, 'F');
    ent(785, 11, 'F'); ent(789, 11, 'F'); ent(793, 11, 'F');

    // ── Group D3 (cols 800-960): final approach + cozy bed.
    // Long calm runway, then the goal staircase. Bed at the far end.
    treatArc(797, 800, 8);
    ground(801, 159);                // long final ground all the way to world edge
    ent(805, 11, 'F'); ent(809, 11, 'F'); ent(813, 11, 'F');
    ent(817, 11, 'F'); ent(821, 11, 'F'); ent(825, 11, 'F');
    ent(830, 11, 'F'); ent(835, 11, 'F'); ent(840, 11, 'F');
    ent(845, 11, 'F'); ent(850, 11, 'F'); ent(855, 11, 'F');
    plat(900, 11, 3);
    plat(903, 10, 3);
    plat(906, 9, 3);
    plat(909, 8, 6);                 // top tier — wide enough for the bed
    ent(911, 7, 'Y');
    ent(913, 7, 'G');                // GOAL — cozy bed

    return { grid: b.finalize(), width: W, height: H, label: 'MEADOW WALK' };
  }


  /* =========================================================================
   *  LEVEL 2 — "NIGHT GARDEN"
   *
   *  Long, dense, and wasp-heavy. The hidden-sky-route trick gets re-used as
   *  the *required* path through one section. A garden-pond movement (lily
   *  pads and a hedge tunnel) was added in a later pass to bring the level
   *  in line with level 1's substance.
   * ======================================================================= */

  function buildLevel2() {
    const W = 720;
    const b = makeBuilder(W);
    const { ground, plat, ent, treatArc } = b;

    // Tutorial restart — but now the player keeps their cat across levels.
    ground(0, 14);
    ent(1, 11, 'P');
    ent(7, 11, 'F');
    ent(10, 8, 'Q');                 // box first
    ent(11, 11, 'F');
    ent(13, 11, 'F');

    treatArc(14, 17, 8);
    ground(18, 14);
    ent(21, 11, 'F');
    ent(24, 11, 'B');
    ent(28, 6, 'W');
    plat(20, 6, 5);
    ent(22, 5, 'Y');
    ent(31, 11, 'F');

    treatArc(32, 36, 8);
    ground(37, 18);
    ent(40, 8, 'Q');
    ent(43, 11, 'B');
    ent(46, 6, 'W');
    ent(49, 11, 'D');
    ent(52, 11, 'F');
    ent(54, 11, 'F');

    // Wasp swarm — five wasps in a row, the cat needs the projectile
    treatArc(55, 59, 8);
    ground(60, 24);
    plat(62, 4, 22);                 // ceiling forces sub-route
    ent(64, 6, 'W');
    ent(68, 6, 'W');
    ent(72, 6, 'W');
    ent(76, 6, 'W');
    ent(80, 6, 'W');
    ent(67, 11, 'D');
    ent(72, 11, 'B');
    ent(78, 11, 'D');
    ent(83, 11, 'F');

    treatArc(84, 88, 8);
    ground(89, 14);
    ent(93, 8, 'Q');                 // mid-level refresher
    ent(95, 11, 'B');
    ent(98, 6, 'W');
    ent(101, 11, 'F');

    // Stair up to the sky route. Without these, the row-3 plateau is
    // unreachable — the cat's max ~5.5-tile vertical means a single jump
    // from ground (row 12) can't clear nine tiles of climb.
    plat(96,  9, 2);                 // step 1
    plat(99,  6, 2);                 // step 2
    ent(99, 5, 'F');

    // Required sky route — there is no ground in the next stretch, only
    // the row-3 plateau is traversable. Falling = pit death.
    plat(103, 3, 30);
    ent(105, 2, 'Y');
    ent(108, 2, 'Y');
    ent(111, 2, 'Y');
    ent(115, 2, 'Y');
    ent(120, 2, 'F');
    ent(125, 2, 'F');
    ent(130, 2, 'F');

    // Gap below — lots of empty (cols 103–132) so falling = death.

    // Land on this ground
    ground(133, 18);
    ent(136, 11, 'F');
    ent(139, 11, 'B');
    ent(143, 6, 'W');
    ent(146, 11, 'D');
    ent(149, 11, 'F');

    treatArc(150, 154, 8);
    ground(155, 16);
    plat(159, 7, 4);
    ent(160, 6, 'Y');
    ent(163, 11, 'B');
    ent(167, 6, 'W');
    ent(170, 11, 'F');

    treatArc(172, 175, 8);
    ground(176, 14);
    ent(180, 8, 'Q');
    ent(183, 11, 'D');
    ent(186, 11, 'F');

    treatArc(190, 193, 8);
    ground(194, 18);
    ent(197, 11, 'F');
    ent(200, 11, 'B');
    ent(203, 6, 'W');
    ent(206, 11, 'D');
    ent(209, 11, 'F');

    // Tower into goal
    treatArc(213, 216, 8);
    ground(217, 16);
    plat(221, 11, 3);
    plat(224, 10, 3);
    plat(227, 9, 3);
    plat(230, 7, 4);
    ent(231, 6, 'Y');
    ent(233, 6, 'F');

    treatArc(235, 238, 8);
    ground(239, 22);
    ent(243, 8, 'Q');
    ent(245, 11, 'B');
    ent(248, 11, 'D');
    ent(251, 6, 'W');
    ent(254, 11, 'F');
    ent(258, 11, 'F');

    treatArc(263, 266, 8);
    ground(267, 18);
    ent(271, 11, 'F');
    ent(274, 11, 'B');
    ent(278, 11, 'F');
    plat(272, 7, 5);
    ent(273, 6, 'Y');

    // Final approach — 7-tile gap with a mid-air step to keep it forgiving.
    treatArc(287, 291, 8);
    plat(289, 9, 2);                  // mid-air stepping platform
    ground(292, 24);
    ent(295, 11, 'F');
    ent(298, 6, 'W');
    ent(301, 11, 'D');
    ent(304, 11, 'F');
    ent(308, 8, 'Q');
    ent(311, 11, 'F');
    ent(315, 11, 'F');

    /* ---- Movement D: lily-pond + hedge tunnel (cols 320-499) ----
       The cat crosses a moonlit pond by hopping floating lily-pad
       platforms over a wide pit, then threads a low hedge tunnel
       that funnels them under a wasp swarm. */

    // Bridge into D — small flat with a refresher Q.
    treatArc(316, 319, 8);
    ground(320, 18);
    ent(323, 11, 'F');
    ent(325, 8, 'Q');                // refresher box
    ent(328, 11, 'B');
    ent(331, 11, 'F');
    ent(334, 6, 'W');
    ent(337, 11, 'F');

    // The pond — three lily-pad platforms over a wide pit. No safety net.
    treatArc(338, 358, 8);            // big treat arc spanning the pond
    plat(341, 9, 2);                  // pad 1
    ent(341, 8, 'F');
    plat(346, 8, 2);                  // pad 2 (slightly higher)
    ent(346, 7, 'Y');
    plat(351, 9, 2);                  // pad 3
    ent(351, 8, 'F');
    plat(356, 10, 2);                 // pad 4 (lower, lead-in to ground)
    ground(359, 14);
    ent(362, 11, 'F');
    ent(365, 11, 'D');
    ent(368, 11, 'F');
    ent(371, 11, 'F');

    // Hedge tunnel — low ceiling at row 4 with a wasp gauntlet underneath.
    treatArc(373, 377, 8);
    ground(378, 28);
    plat(381, 4, 24);                 // long ceiling
    ent(384, 6, 'W');
    ent(389, 6, 'W');
    ent(394, 6, 'W');
    ent(399, 6, 'W');
    ent(386, 11, 'B');
    ent(391, 11, 'D');
    ent(397, 11, 'B');
    ent(402, 11, 'F');
    ent(404, 11, 'F');

    // Recovery — open garden flat with collectibles.
    treatArc(407, 411, 8);
    ground(412, 22);
    ent(415, 11, 'F');
    ent(418, 11, 'F');
    ent(420, 8, 'Q');                 // mid-tunnel reward
    ent(423, 11, 'D');
    ent(426, 11, 'F');
    ent(429, 6, 'W');
    ent(432, 11, 'F');

    // Twilight stair — vertical ascent toward the goal hill.
    treatArc(435, 438, 8);
    ground(439, 16);
    plat(442, 11, 3);
    plat(445, 10, 3);
    plat(448, 9, 3);
    plat(451, 8, 4);                  // landing tier
    ent(452, 7, 'Y');
    ent(453, 7, 'F');
    ent(454, 7, 'F');

    // One more pit before the home stretch.
    treatArc(456, 460, 8);
    ground(461, 18);
    ent(464, 11, 'F');
    ent(467, 11, 'B');
    ent(470, 6, 'W');
    ent(473, 11, 'D');
    ent(476, 11, 'F');

    /* ---- Goal staircase + bed (now further out) ---- */
    ground(479, 241);                 // long final ground all the way to world edge
    ent(482, 11, 'F');
    ent(485, 11, 'F');
    ent(488, 11, 'F');                // calm runway — almost there
    plat(495, 11, 3);
    plat(498, 10, 3);
    plat(501, 9, 3);
    plat(504, 8, 6);
    ent(506, 7, 'Y');
    ent(508, 7, 'G');                 // GOAL

    return { grid: b.finalize(), width: W, height: H, label: 'NIGHT GARDEN' };
  }


  /* =========================================================================
   *  LEVEL 3 — "HOMEWARD BOUND"
   *
   *  The trilogy's climax — long, hard, and unforgiving. A sprint through
   *  the cat's collected obstacles, capped with a boss-style enemy
   *  pile-up before the final cozy bed.
   * ======================================================================= */

  function buildLevel3() {
    const W = 720;
    const b = makeBuilder(W);
    const { ground, plat, ent, treatArc } = b;

    // No tutorial — the player has earned this.
    ground(0, 16);
    ent(1, 11, 'P');
    ent(6, 11, 'F');
    ent(8, 8, 'Q');
    ent(10, 11, 'F');
    ent(13, 11, 'B');
    ent(15, 6, 'W');

    treatArc(16, 20, 8);
    ground(21, 18);
    ent(24, 8, 'Q');
    ent(26, 11, 'D');
    ent(29, 6, 'W');
    ent(31, 11, 'B');
    ent(34, 11, 'F');
    ent(37, 11, 'F');

    treatArc(39, 43, 8);
    ground(44, 24);
    plat(46, 4, 22);                 // forced low corridor
    ent(48, 6, 'W');
    ent(52, 6, 'W');
    ent(56, 6, 'W');
    ent(60, 6, 'W');
    ent(50, 11, 'D');
    ent(55, 11, 'B');
    ent(61, 11, 'F');
    ent(64, 11, 'B');
    ent(67, 11, 'F');

    // Vertical climb with refreshers
    treatArc(70, 73, 8);
    ground(74, 14);
    plat(78, 11, 3);
    plat(81, 10, 3);
    plat(84, 9, 5);
    ent(85, 8, 'F');
    ent(86, 8, 'Q');                 // mid-air refresher
    ent(87, 8, 'F');

    treatArc(89, 92, 8);
    ground(93, 18);
    ent(96, 11, 'F');
    ent(99, 11, 'D');
    ent(102, 6, 'W');
    ent(105, 11, 'B');
    ent(108, 11, 'F');

    // Hardest pit — 7 wide with two stepping platforms (final-level gauntlet).
    treatArc(112, 118, 8);
    plat(114, 9, 2);
    plat(117, 7, 2);
    ground(119, 14);
    ent(121, 11, 'F');
    ent(124, 11, 'B');
    ent(127, 6, 'W');
    ent(130, 11, 'F');

    treatArc(133, 137, 8);
    ground(138, 20);
    ent(141, 8, 'Q');
    ent(144, 11, 'D');
    ent(147, 11, 'B');
    ent(150, 6, 'W');
    ent(153, 6, 'W');
    ent(156, 11, 'F');

    treatArc(159, 163, 8);
    ground(164, 18);
    ent(167, 11, 'F');
    plat(168, 7, 5);
    ent(169, 6, 'Y');
    ent(172, 11, 'B');
    ent(176, 11, 'F');
    ent(180, 11, 'D');

    treatArc(183, 187, 8);
    ground(188, 22);
    ent(192, 8, 'Q');
    ent(195, 11, 'B');
    ent(199, 6, 'W');
    ent(202, 11, 'D');
    ent(205, 6, 'W');
    ent(208, 11, 'F');

    treatArc(211, 215, 8);
    ground(216, 18);
    ent(219, 11, 'F');
    ent(223, 11, 'B');
    ent(227, 6, 'W');
    ent(230, 11, 'F');
    plat(220, 7, 5);
    ent(221, 6, 'Y');

    treatArc(234, 240, 8);            // 7-tile finale gap with a stepping plat
    plat(237, 9, 2);                  // mid-air step
    ground(241, 22);
    ent(244, 11, 'F');
    ent(247, 11, 'D');
    ent(250, 8, 'Q');
    ent(253, 11, 'B');
    ent(256, 11, 'F');
    ent(260, 11, 'F');

    /* ---- Movement D: boss room + climactic climb (cols 265-499) ----
       The trilogy's climax. A long hostile flat ("the boss room") packs
       every enemy type into one space, then a tough vertical climb
       gates the final stretch, and the cat finally walks to the bed. */

    // Bridge into D — narrow flat with a refresher Q.
    treatArc(263, 268, 8);            // 6-tile gap
    ground(269, 12);
    ent(272, 11, 'F');
    ent(275, 8, 'Q');                 // refresher
    ent(278, 11, 'B');

    // Boss room — one long flat dense with every enemy type. Ceiling
    // forces the cat to engage rather than skip overhead.
    treatArc(281, 285, 8);            // 5-tile gap
    ground(286, 36);                  // long boss-room floor
    plat(290, 4, 30);                 // long ceiling
    ent(292, 6, 'W');
    ent(296, 6, 'W');
    ent(300, 6, 'W');
    ent(304, 6, 'W');
    ent(308, 6, 'W');                 // wasp swarm overhead
    ent(294, 11, 'B');
    ent(297, 11, 'D');
    ent(301, 11, 'B');
    ent(305, 11, 'D');
    ent(309, 11, 'B');                // ground-level patrol gauntlet
    ent(312, 11, 'D');
    ent(316, 11, 'F');
    ent(319, 11, 'F');

    // Cool-down beat — open sky, recovery treats, mid-room Q.
    treatArc(322, 326, 8);
    ground(327, 22);
    ent(330, 11, 'F');
    ent(333, 11, 'F');
    ent(335, 8, 'Q');
    ent(338, 11, 'D');
    ent(341, 11, 'F');
    ent(344, 6, 'W');
    ent(347, 11, 'F');

    // Climactic climb — taller staircase than levels 1-2, with a wasp
    // perched at the top to make the timing matter.
    treatArc(350, 354, 8);
    ground(355, 16);
    plat(358, 11, 3);
    plat(361, 10, 3);
    plat(364, 9, 3);
    plat(367, 8, 5);                  // top tier
    ent(368, 7, 'F');
    ent(370, 7, 'Y');
    ent(370, 4, 'W');                 // sentry wasp at the apex

    // Drop down + descent valley — one last enemy gauntlet on flat ground.
    treatArc(372, 375, 8);
    ground(376, 24);
    ent(379, 11, 'F');
    ent(382, 11, 'B');
    ent(385, 6, 'W');
    ent(388, 11, 'D');
    ent(391, 11, 'B');
    ent(394, 6, 'W');
    ent(397, 11, 'F');
    ent(399, 11, 'F');

    // Hidden rest spot — a sky platform with a Y for curious players.
    plat(380, 3, 12);
    ent(382, 2, 'Y');
    ent(385, 2, 'Y');
    ent(388, 2, 'Y');
    ent(391, 2, 'Y');

    // Final canyon — 8-tile gap with a stepping plat for safe traversal.
    treatArc(400, 407, 8);
    plat(403, 9, 2);                  // mid-air step
    ground(408, 16);
    ent(412, 11, 'F');
    ent(415, 11, 'D');
    ent(418, 8, 'Q');                 // last Q-box of the trilogy
    ent(421, 11, 'F');

    // Home stretch — calm runway into the final climb.
    treatArc(424, 427, 8);
    ground(428, 18);
    ent(431, 11, 'F');
    ent(434, 11, 'F');
    ent(437, 11, 'F');
    ent(440, 11, 'F');                // calm runway, treats only
    ent(443, 11, 'F');

    /* ---- Final goal staircase + cozy bed (the trilogy ends here) ---- */
    ground(446, 274);                 // long final ground all the way to world edge
    plat(450, 11, 3);
    plat(453, 10, 3);
    plat(456, 9, 3);
    plat(459, 8, 4);
    plat(463, 7, 6);                  // raised final tier
    ent(465, 6, 'Y');
    ent(467, 6, 'Y');
    ent(469, 6, 'G');                 // FINAL GOAL — the trilogy ends here

    return { grid: b.finalize(), width: W, height: H, label: 'HOMEWARD BOUND' };
  }


  /* =========================================================================
   *  Build all three levels at module load and expose the array.
   * ======================================================================= */

  const LEVELS = [
    buildLevel1(),
    buildLevel2(),
    buildLevel3(),
  ];

  global.LEVELS = LEVELS;
  // Backwards-compat: callers that haven't switched to LEVELS yet still see
  // level 1 under the old globals.
  global.LEVEL = LEVELS[0].grid;
  global.LEVEL_WIDTH = LEVELS[0].width;
  global.LEVEL_HEIGHT = LEVELS[0].height;
})(window);
