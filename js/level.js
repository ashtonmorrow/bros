/* level.js — ASCII tilemap describing the level.
 *
 * Each row is one row of tiles, each tile is 32×32 px in the world. Edit the
 * strings to redesign the level — rows are auto-padded to the longest row's
 * width with empty tiles, so you don't have to keep them aligned.
 *
 * Tile legend:
 *   '.'  empty (sky)
 *   '#'  ground top (grass)
 *   '='  underground (dirt)
 *   '-'  floating wooden platform
 *   'P'  player start
 *   'G'  goal (cozy bed) — exit point
 *   'F'  fish treat   (collectible, +10 points)
 *   'Y'  yarn ball    (collectible, +50 points)
 *   'B'  bug enemy    (small, walks back & forth, falls off ledges)
 *   'D'  dust bunny   (slower patroller)
 *
 * Level teaching beats:
 *
 *   1. Long flat tutorial section (cols 0-13)            — learn to walk + fight gravity.
 *   2. Single bug enemy on the tutorial section           — first stomp.
 *   3. Tiny pit (cols 14-17, 4 tiles wide)                — first jump.
 *   4. Mid platform with a fish treat                     — reward.
 *   5. Second tiny pit (cols 23-26)                       — repeat the lesson.
 *   6. Long dangerous section with two enemies             — apply both skills.
 *   7. Wider gap (cols 45-50) with a mid-air platform     — taller jump introduction.
 *   8. Stepping stones with another mid-air platform      — chained jumps.
 *   9. End ground with a raised wooden plateau + goal     — final platforming sequence.
 *
 * The structure is similar in *spirit* to a typical 8-bit first stage, but the
 * exact layout, geometry, enemies, and aesthetics are all original.
 */
(function (global) {
  'use strict';

  // Helper to make repeated characters easy to read in the source.
  const sp = (n) => ' '.repeat(n);
  const ch = (c, n) => c.repeat(n);

  // Each row is a string. Spaces become '.' (empty) after normalisation.
  // The final ground/dirt sections sum to exactly 80 columns:
  //   14 + 4 + 5 + 4 + 18 + 6 + 5 + 5 + 19 = 80
  const LEVEL_RAW = [
    /* 0  */ sp(80),
    /* 1  */ sp(80),
    /* 2  */ sp(80),
    /* 3  */ sp(80),
    /* 4  */ sp(80),
    /* 5  */ sp(12) + 'F' + sp(23) + 'F' + sp(29) + 'Y' + sp(13),
    /* 6  */ sp(11) + '---' + sp(21) + '---' + sp(27) + '---' + sp(12),
    /* 7  */ sp(80),
    /* 8  */ sp(48) + 'F' + sp(10) + 'F' + sp(12) + 'Y' + 'G' + sp(6),
    /* 9  */ sp(47) + '---' + sp(8) + '---' + sp(9) + '-----' + sp(5),
    /* 10 */ sp(80),
    /* 11 */ ' P' + sp(6) + 'B' + sp(11) + 'F' + sp(9) + 'F' + sp(2) + 'B'
             + sp(7) + 'D' + sp(11) + 'F' + sp(26),
    /* 12 */ ch('#', 14) + sp(4) + ch('#', 5) + sp(4) + ch('#', 18) + sp(6)
             + ch('#', 5) + sp(5) + ch('#', 19),
    /* 13 */ ch('=', 14) + sp(4) + ch('=', 5) + sp(4) + ch('=', 18) + sp(6)
             + ch('=', 5) + sp(5) + ch('=', 19),
    /* 14 */ ch('=', 14) + sp(4) + ch('=', 5) + sp(4) + ch('=', 18) + sp(6)
             + ch('=', 5) + sp(5) + ch('=', 19),
  ];

  // Normalise: pad to the widest row, swap spaces for '.'.
  const W = LEVEL_RAW.reduce((m, r) => Math.max(m, r.length), 0);
  const LEVEL = LEVEL_RAW.map((r) => {
    let row = r;
    while (row.length < W) row += ' ';
    return row.replace(/ /g, '.');
  });

  global.LEVEL = LEVEL;
  global.LEVEL_WIDTH = W;
  global.LEVEL_HEIGHT = LEVEL.length;
})(window);
