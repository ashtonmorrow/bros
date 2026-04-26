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
   *  Three movements, each ~240 tiles. Each opens with a calm tutorial-style
   *  beat, escalates into a section-specific twist, and closes with a
   *  recovery + transition into the next movement. The final movement ends
   *  at the goal (cozy bed).
   * ======================================================================= */

  function buildLevel1() {
    const W = 720;
    const b = makeBuilder(W);
    const { ground, plat, ent, treatArc } = b;

    /* ---- Movement A: tutorial through layered platforms (cols 0–239) ----
       (this is the original Pounce level, lightly tweaked) */

    ground(0, 16);
    ent(1, 11, 'P');
    ent(8,  11, 'F');
    ent(11, 11, 'F');
    ent(13, 11, 'F');
    ent(10, 8, 'Q');                 // first power-up box (cat food)

    treatArc(16, 18, 8);             // Pit #1 arc
    ground(19, 11);
    ent(22, 11, 'F');
    ent(24, 11, 'F');
    ent(26, 11, 'F');

    treatArc(30, 32, 8);             // Pit #2 arc
    ground(33, 17);
    ent(40, 11, 'B');
    plat(38, 7, 5);
    ent(40, 6, 'Y');
    ent(45, 11, 'F');
    ent(47, 11, 'F');

    treatArc(50, 53, 8);             // Pit #3 arc
    ground(54, 12);
    ent(57, 11, 'F');
    ent(58, 11, 'D');
    ent(61, 11, 'F');
    ent(63, 11, 'F');
    ent(65, 11, 'F');

    treatArc(66, 69, 8);             // Pit #4 arc
    ground(70, 17);
    ent(71, 11, 'F');
    ent(73, 11, 'F');
    plat(74, 8, 5);
    ent(72, 8, 'Q');
    ent(76, 7, 'F');
    plat(76, 5, 4);
    ent(77, 4, 'Y');
    ent(80, 11, 'B');
    ent(82, 11, 'F');
    ent(83, 11, 'F');

    treatArc(87, 91, 8);             // Pit #5 arc
    ground(92, 11);
    ent(94, 11, 'F');
    ent(95, 11, 'D');
    ent(99, 11, 'F');
    ent(100, 11, 'B');

    plat(104, 9, 3);
    ent(105, 8, 'F');

    ground(108, 7);
    plat(115, 11, 2);
    plat(117, 10, 2);
    plat(119, 9, 5);                 // top of stairs / Act 3 entry

    ent(120, 8, 'F');
    plat(126, 8, 4);
    ent(127, 7, 'F');
    plat(132, 7, 4);
    ent(133, 6, 'Y');

    // Hidden sky route (above the disconnected platforms)
    plat(137, 3, 14);
    ent(139, 2, 'Y');
    ent(141, 2, 'Y');
    ent(143, 2, 'Y');
    ent(145, 2, 'Y');
    ent(147, 2, 'Y');
    ent(151, 5, 'F');                // visible "huh, why's that here?" hint

    ground(135, 14);
    ent(138, 6, 'W');                // first wasp
    ent(140, 11, 'F');
    ent(143, 11, 'B');
    ent(146, 11, 'D');

    plat(150, 9, 2);
    plat(153, 7, 2);
    ent(153, 6, 'F');

    ground(156, 6);
    plat(162, 10, 3);
    plat(165, 9, 3);
    plat(168, 7, 3);
    ent(169, 6, 'Y');

    ground(170, 15);
    ent(171, 11, 'F');
    ent(174, 11, 'F');
    ent(176, 8, 'Q');
    ent(178, 11, 'B');
    ent(180, 7, 'W');
    ent(181, 11, 'F');
    ent(182, 11, 'F');
    ent(184, 11, 'F');

    ground(185, 18);
    ent(190, 11, 'F');
    ent(192, 8, 'Q');
    ent(194, 11, 'F');
    ent(196, 8, 'Q');
    ent(198, 11, 'F');
    ent(201, 11, 'F');

    treatArc(203, 206, 8);
    ground(207, 14);
    ent(209, 11, 'F');
    ent(210, 11, 'D');
    ent(212, 11, 'F');
    ent(213, 6, 'W');
    ent(214, 11, 'F');
    plat(215, 7, 4);
    ent(216, 6, 'Y');

    /* ---- Movement B: forest gauntlet (cols 240-479) ----
       New ideas: stacked enemies, the first 6-tile pit (uncomfortable),
       a forced down-pounce challenge through a tight corridor of wasps. */

    ground(221, 22);                 // bridge into movement B
    ent(225, 11, 'F');
    ent(229, 8, 'Q');                // refresher box
    ent(232, 11, 'D');
    ent(236, 11, 'F');
    ent(240, 11, 'B');

    // Movement B opens
    ground(244, 14);
    ent(247, 11, 'F');
    ent(250, 11, 'B');
    ent(254, 11, 'D');
    ent(257, 6, 'W');                // wasp directly above the patrol
    plat(252, 8, 5);
    ent(253, 7, 'F');
    ent(254, 7, 'F');

    treatArc(258, 263, 8);           // 6-tile gap (max-jump check)
    ground(264, 14);
    ent(266, 11, 'F');
    ent(268, 11, 'B');
    ent(272, 11, 'B');
    plat(269, 6, 6);
    ent(270, 5, 'Y');
    ent(273, 5, 'F');
    ent(276, 11, 'F');

    // Tight wasp corridor — three wasps on a short, low ceiling-platform
    // section. The intended solution is shoot or pounce-down, not "jump."
    ground(278, 16);
    ent(280, 11, 'F');
    ent(283, 6, 'W');
    ent(287, 6, 'W');
    ent(291, 6, 'W');
    plat(280, 4, 14);                // ceiling that funnels you under the wasps
    ent(285, 11, 'B');
    ent(289, 11, 'D');
    ent(292, 11, 'F');

    treatArc(295, 298, 8);
    ground(299, 18);
    ent(303, 8, 'Q');                // mid-section box (probably yields fish)
    ent(305, 11, 'F');
    ent(309, 11, 'D');
    ent(312, 11, 'B');
    plat(307, 8, 5);
    ent(309, 7, 'F');
    ent(316, 11, 'F');

    treatArc(318, 322, 8);           // 5-tile gap
    ground(323, 16);
    ent(326, 11, 'F');
    ent(329, 11, 'B');
    plat(327, 6, 5);
    ent(328, 5, 'Y');
    ent(335, 11, 'F');

    // Movement-B finale: descent. The cat drops down to a lower elevation —
    // visually like falling into a forest hollow.
    treatArc(340, 343, 8);
    ground(344, 26);                 // long flat — set up for descent
    ent(347, 11, 'F');
    ent(350, 6, 'W');
    ent(353, 11, 'B');
    ent(357, 11, 'D');
    ent(361, 11, 'F');
    ent(364, 11, 'B');
    ent(368, 11, 'F');

    // Stepped down — the next ground row would be lower if we had multiple
    // floor levels. We simulate by placing a series of 2-wide platforms
    // stair-stepping DOWN below row 12... but our ground is row 12. So
    // instead this is just a long flat with breaks.
    treatArc(371, 374, 8);
    ground(375, 14);
    ent(378, 11, 'F');
    ent(381, 11, 'B');
    ent(385, 11, 'D');
    plat(380, 6, 6);
    ent(382, 5, 'Y');
    ent(386, 6, 'W');
    ent(388, 11, 'F');

    treatArc(390, 393, 8);
    ground(394, 16);
    ent(397, 11, 'F');
    ent(400, 8, 'Q');
    ent(402, 11, 'D');
    ent(405, 11, 'B');
    ent(408, 11, 'F');

    treatArc(411, 415, 8);           // 5-tile gap
    ground(416, 14);
    ent(420, 11, 'F');
    ent(423, 11, 'B');
    plat(418, 7, 4);
    ent(419, 6, 'F');
    ent(421, 6, 'Y');
    ent(427, 11, 'F');

    treatArc(431, 434, 8);
    ground(435, 12);
    ent(438, 11, 'D');
    ent(441, 11, 'B');
    ent(444, 11, 'F');

    /* ---- Movement C: cliff approach + final goal (cols 480–719) ----
       Vertical climbing + a "boss-room" enemy pile-up + the goal staircase. */

    treatArc(448, 451, 8);
    ground(452, 28);                 // long bridge into C
    ent(455, 11, 'F');
    ent(458, 8, 'Q');
    ent(461, 11, 'B');
    ent(464, 6, 'W');
    ent(467, 11, 'F');
    ent(470, 11, 'D');
    ent(474, 11, 'F');
    ent(478, 11, 'B');

    // Vertical staircase up (the cliff)
    ground(482, 8);
    plat(489, 11, 3);
    plat(492, 10, 3);
    plat(495, 9, 3);
    plat(498, 8, 3);
    plat(501, 7, 5);                 // top plateau
    ent(502, 6, 'Y');
    ent(503, 6, 'F');
    ent(504, 6, 'F');

    // Drop down to a "valley" with multiple wasps + ground enemies
    ground(507, 24);
    ent(510, 11, 'F');
    ent(513, 6, 'W');
    ent(516, 11, 'B');
    ent(519, 6, 'W');
    ent(522, 11, 'D');
    ent(525, 11, 'B');
    ent(528, 11, 'F');

    treatArc(531, 535, 8);
    ground(536, 16);
    ent(540, 8, 'Q');                // refresher
    ent(542, 11, 'F');
    ent(545, 11, 'B');
    ent(548, 6, 'W');
    plat(540, 6, 8);
    ent(543, 5, 'Y');
    ent(550, 11, 'F');

    // Long, low ceiling — pounce-down or shoot territory
    treatArc(553, 557, 8);
    ground(558, 22);
    plat(560, 4, 18);                // long ceiling
    ent(562, 6, 'W');
    ent(566, 6, 'W');
    ent(570, 6, 'W');
    ent(574, 6, 'W');
    ent(563, 11, 'B');
    ent(567, 11, 'D');
    ent(572, 11, 'B');
    ent(577, 11, 'F');

    treatArc(580, 584, 8);
    ground(585, 18);
    ent(588, 11, 'F');
    ent(591, 8, 'Q');
    ent(594, 11, 'D');
    ent(597, 11, 'B');
    ent(601, 11, 'F');

    // Big climb — pre-finale
    treatArc(603, 606, 8);
    ground(607, 16);
    plat(611, 11, 3);
    plat(614, 10, 3);
    plat(617, 9, 5);
    ent(618, 8, 'Q');                // climb-reward
    ent(620, 8, 'F');

    // Final stretch — lots of treats, pace breaker, then goal staircase.
    treatArc(623, 626, 8);
    ground(627, 30);
    ent(631, 11, 'F');
    ent(634, 11, 'F');
    ent(637, 11, 'F');
    ent(640, 8, 'Q');
    ent(642, 11, 'F');
    ent(645, 11, 'D');                // last enemy
    ent(648, 11, 'F');
    ent(651, 11, 'F');
    ent(654, 11, 'F');

    treatArc(659, 662, 8);
    ground(663, 22);
    ent(666, 11, 'F');
    ent(669, 11, 'F');
    ent(672, 11, 'F');
    plat(670, 7, 4);
    ent(671, 6, 'Y');
    ent(675, 11, 'F');
    ent(678, 11, 'F');

    // ----- Goal staircase + bed -----
    ground(685, 35);                 // long final ground
    plat(689, 11, 3);
    plat(692, 10, 3);
    plat(695, 9, 3);
    plat(698, 8, 6);                 // top tier — wide enough for the bed
    ent(700, 7, 'Y');
    ent(702, 7, 'G');                // GOAL — cozy bed

    return { grid: b.finalize(), width: W, height: H, label: 'MEADOW WALK' };
  }


  /* =========================================================================
   *  LEVEL 2 — "NIGHT GARDEN"
   *
   *  Shorter and denser. Lots of wasps. The hidden-sky-route trick gets
   *  re-used as the *required* path through one section.
   * ======================================================================= */

  function buildLevel2() {
    const W = 540;
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

    // Final approach
    treatArc(287, 291, 8);
    ground(292, 24);
    ent(295, 11, 'F');
    ent(298, 6, 'W');
    ent(301, 11, 'D');
    ent(304, 11, 'F');
    ent(308, 8, 'Q');
    ent(311, 11, 'F');
    ent(315, 11, 'F');

    // Goal staircase
    ground(320, 30);
    plat(323, 11, 3);
    plat(326, 10, 3);
    plat(329, 9, 3);
    plat(332, 8, 6);
    ent(334, 7, 'Y');
    ent(336, 7, 'G');

    // Pad to the declared width (rest of the world is empty sky).
    return { grid: b.finalize(), width: W, height: H, label: 'NIGHT GARDEN' };
  }


  /* =========================================================================
   *  LEVEL 3 — "HOMEWARD BOUND"
   *
   *  Shortest, most concentrated. A sprint through the cat's collected
   *  obstacles ending at the cozy bed.
   * ======================================================================= */

  function buildLevel3() {
    const W = 480;
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

    treatArc(235, 240, 8);            // 6-tile finale gap
    ground(241, 22);
    ent(244, 11, 'F');
    ent(247, 11, 'D');
    ent(250, 8, 'Q');
    ent(253, 11, 'B');
    ent(256, 11, 'F');
    ent(260, 11, 'F');

    // Goal — final cozy bed at the end of the trilogy
    treatArc(265, 268, 8);
    ground(269, 28);
    plat(273, 11, 3);
    plat(276, 10, 3);
    plat(279, 9, 3);
    plat(282, 8, 4);
    plat(286, 7, 6);                 // raised final tier
    ent(288, 6, 'Y');
    ent(290, 6, 'Y');
    ent(292, 6, 'G');                // FINAL GOAL — the trilogy ends here

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
