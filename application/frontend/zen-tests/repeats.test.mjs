/**
 * Repetition growth tests (v2 step 4): per-beat play counts grow stepped
 * outward ribs (15 × 3px, alpha ramp, inner edge fixed at ringRadius + band/2);
 * base annulus is unchanged by counts; cap pulse re-brightens a capped beat's
 * band; the glow dot tracks the grown band's midline; jump-candidate dots
 * mark the tiles the current beat can jump to.
 */
import assert from 'node:assert/strict';
import { compileTs, FakeCtx, callsOf } from './harness.mjs';

const drawUrl = compileTs('src/lib/zen/draw.ts');
const { LAYOUT_RING, PAINT_FRAME, PLAY_GROWTH_FOR, PLAY_MAX_REPS, TILE_DIAMETER_FOR, GLOW_DOT_POSITION, CANDIDATE_DOT_POSITION, CANDIDATE_DOT_DIAMETER_FOR, CANDIDATE_DOT_ALPHA, JEWEL_COLOR_FOR_CLUSTER } = await import(drawUrl);

const PALETTE = {
  jewels: ['#ff8a80', '#fdb515', '#7bd5a8', '#8ab8ff', '#cfa9f5', '#7fdce8'],
  background: '#0e141c',
};
const RIB_LINE_WIDTH = 3;
/** Rib alpha ramp, mirrored from draw.ts: linear 0.9 → RIB_ALPHA_MIN over PLAY_MAX_REPS ribs. */
const RIB_ALPHA_MIN = 0.02;
const ribAlpha = (k) => 0.9 - ((k - 1) * (0.9 - RIB_ALPHA_MIN)) / (PLAY_MAX_REPS - 1);

function makeBeat(id, cluster = id % 6) {
  return { id, start: id * 0.5, duration: 0.5, cluster, segment: 0, jump_candidates: [] };
}

function paint(beats, layout, { currentBeat = null, currentIndex = -1, counts = null, pulses = null, reducedMotion = false, nowSec = 0, glowAt = null } = {}) {
  const ctx = new FakeCtx({ width: 800, height: 800 });
  PAINT_FRAME(
    {
      beats,
      layout,
      palette: PALETTE,
      currentBeat,
      currentBeatIndex: currentIndex ?? (currentBeat ? beats.findIndex((b) => b.id === currentBeat.id) : -1),
      beatCount: 0,
      jumps: [],
      reducedMotion,
      nowSec,
      currentBeatGlowTSec: currentBeat ? (glowAt ?? nowSec) : null,
      beatPlayCounts: counts ?? undefined,
      capPulseTSecByIndex: pulses ?? undefined,
    },
    ctx,
  );
  return ctx;
}

/** Band arcs: lineWidth == band (base annulus strokes). */
function baseArcs(ctx, band) {
  return callsOf(ctx, 'arc').filter((a) => a.lineWidth === band);
}

/** Rib arcs: lineWidth == 3 annulus strokes above the base band. */
function ribArcs(ctx) {
  return callsOf(ctx, 'arc').filter((a) => a.lineWidth === RIB_LINE_WIDTH);
}

const BEATS_12 = Array.from({ length: 12 }, (_, i) => makeBeat(i));
const LAYOUT_12 = LAYOUT_RING(BEATS_12, { width: 800, height: 800, margin: 32 });
const BAND_12 = TILE_DIAMETER_FOR(12, LAYOUT_12.radius);

{ // play-growth helper: cap at 15 × 3 = 45 in rib mode; 0 in brightness mode
  // (the dot sits at the base-band midline; no ribs exist under a floating
  // halo).
  assert.equal(PLAY_GROWTH_FOR(0, 'ribs'), 0);
  assert.equal(PLAY_GROWTH_FOR(1, 'ribs'), 3);
  assert.equal(PLAY_GROWTH_FOR(6, 'ribs'), 18);
  assert.equal(PLAY_GROWTH_FOR(15, 'ribs'), 45);
  assert.equal(PLAY_GROWTH_FOR(50, 'ribs'), 45);
  assert.equal(PLAY_GROWTH_FOR(50, 'ribs'), PLAY_MAX_REPS * RIB_LINE_WIDTH);
  for (const count of [0, 1, 4, 15, 50]) {
    assert.equal(PLAY_GROWTH_FOR(count, 'brightness'), 0, `brightness mode: count ${count} ⇒ growth 0`);
  }
}

{ // Base annulus UNCHANGED by counts: arc at layout.radius, lineWidth = band,
  // for counts 0 through 50.
  for (const count of [0, 1, 2, 3, 5, 6, 7, 20, 50]) {
    const counts = new Map([[0, count]]);
    const ctx = paint(BEATS_12, LAYOUT_12, { counts });
    const base = baseArcs(ctx, BAND_12).find(
      (a) => Math.abs(a.args[2] - LAYOUT_12.radius) < 1e-9 && Math.abs(a.args[0] - LAYOUT_12.center.x) < 1e-9,
    );
    assert.ok(base, `count ${count}: base arc present`);
    // Non-current alpha stays 0.9 regardless of ribs.
    const base0 = baseArcs(ctx, BAND_12)[0];
    assert.equal(base0.globalAlpha, 0.9, `count ${count}: base alpha stays 0.9`);
  }
}

{ // Inner-edge invariance: count 0 vs count 5 — identical base arc (radius +
  // lineWidth + angles); ribs never paint at or below ringRadius + band/2 − 3.
  const ctx0 = paint(BEATS_12, LAYOUT_12, { counts: new Map() });
  const ctx5 = paint(BEATS_12, LAYOUT_12, { counts: new Map([[0, 5]]) });
  const base0 = callsOf(ctx0, 'arc').filter((a) => Math.abs(a.args[2] - LAYOUT_12.radius) < 1e-9)[0];
  const base5 = baseArcs(ctx5, BAND_12).filter((a) => Math.abs(a.args[2] - LAYOUT_12.radius) < 1e-9)[0];
  assert.deepEqual(
    { r: base5.args[2], w: base5.lineWidth, a0: base5.args[3], a1: base5.args[4] },
    { r: base0.args[2], w: base0.lineWidth, a0: base0.args[3], a1: base0.args[4] },
    'base arc identical across counts',
  );
  // Ribs are strictly OUTSIDE the shared flush edge (rib inner edge ≥
  // ringRadius + band/2; stroke centerline at + (k−0.5)·3 clears it).
  for (const a of callsOf(ctx5, 'arc')) {
    if (a.lineWidth !== RIB_LINE_WIDTH) continue;
    assert.ok(
      a.args[2] >= LAYOUT_12.radius + BAND_12 / 2 - 1e-9,
      `rib radius ${a.args[2]} never intrudes inside ringRadius + band/2`,
    );
  }
  // And the innermost rib center exactly at ringRadius + band/2 + 1.5.
  const firstRib = ribArcs(ctx5).find((a) => Math.abs(a.args[2] - (LAYOUT_12.radius + BAND_12 / 2 + 1.5)) < 1e-9);
  assert.ok(firstRib, 'rib 1 centerline flush at ringRadius + band/2 + PLAY_GROWTH_PX/2');
}

{ // Rib geometry: count 3 ⇒ exactly 3 rib arcs at radii radius + band/2 +
  // (k−0.5)·3, lineWidth 3, alphas per the computed ramp in order; count 50 ⇒
  // exactly 15 ribs (cap).
  const ctx3 = paint(BEATS_12, LAYOUT_12, { counts: new Map([[0, 3]]) });
  const ribs3 = ribArcs(ctx3).sort((a, b) => a.args[2] - b.args[2]);
  // Beat 0 is not current, so its 3 ribs are the only rib-stroke arcs.
  assert.equal(ribs3.length, 3, `count 3 ⇒ 3 rib arcs (got ${ribs3.length})`);
  ribs3.forEach((a, idx) => {
    const k = idx + 1;
    const expectedR = LAYOUT_12.radius + BAND_12 / 2 + (k - 0.5) * RIB_LINE_WIDTH;
    assert.ok(Math.abs(a.args[2] - expectedR) < 1e-9, `rib ${k} radius ${a.args[2]} == ${expectedR}`);
    assert.equal(a.lineWidth, RIB_LINE_WIDTH, `rib ${k} lineWidth 3`);
    assert.ok(Math.abs(a.globalAlpha - ribAlpha(idx + 1)) < 1e-9, `rib ${k} alpha ${a.globalAlpha} == ${ribAlpha(idx + 1)}`);
  });

  const ctx50 = paint(BEATS_12, LAYOUT_12, { counts: new Map([[0, 50]]) });
  const ribs50 = ribArcs(ctx50).filter((a) => Math.abs(a.args[2]) > LAYOUT_12.radius);
  assert.equal(ribs50.length, 15, `count 50 capped at 15 ribs (got ${ribs50.length})`);
}

{ // Alpha ramp monotone decreasing outward; first rib alpha == 0.9 (base-band
  // alpha) ⇒ no brightness discontinuity at the flush edge; last rib fades
  // to RIB_ALPHA_MIN (near-invisible).
  const ctx = paint(BEATS_12, LAYOUT_12, { counts: new Map([[0, 15]]) });
  const ribs = ribArcs(ctx).filter((a) => Math.abs(a.args[0] - LAYOUT_12.center.x) < 1e-9).sort((a, b) => a.args[2] - b.args[2]);
  assert.equal(ribs.length, 15);
  assert.ok(Math.abs(ribs[0].globalAlpha - 0.9) < 1e-9, `rib 1 alpha == base alpha 0.9 (${ribs[0].globalAlpha})`);
  for (let i = 1; i < ribs.length; i++) {
    assert.ok(ribs[i].globalAlpha < ribs[i - 1].globalAlpha, `rib ${i + 1} dimmer outward`);
  }
  assert.ok(Math.abs(ribs[14].globalAlpha - RIB_ALPHA_MIN) < 1e-9, `outermost rib alpha ${RIB_ALPHA_MIN} (${ribs[14].globalAlpha})`);
}

{ // No beatPlayCounts ⇒ zero rib arcs (identical stream to pre-rib paint).
  const ctx = paint(BEATS_12, LAYOUT_12, { counts: null });
  assert.equal(ribArcs(ctx).length, 0, 'no counts ⇒ no ribs');
}

{ // Cap pulse: a stamped ring index past PLAY_MAX_REPS re-brightens the base
  // annulus: alpha = 0.55 + 0.45 × decay(0.5) = 0.775; ribs lift proportionally.
  const pulses = new Map([[0, 9.5]]); // pulse started 0.5s before nowSec=10
  const counts = new Map([[0, 17]]);
  const ctx = paint(BEATS_12, LAYOUT_12, { counts, pulses, nowSec: 10 });
  const base = baseArcs(ctx, BAND_12)[0];
  assert.ok(Math.abs(base.globalAlpha - 0.775) < 1e-9, `pulsed base alpha == 0.775 (${base.globalAlpha})`);
  const ribs = ribArcs(ctx).sort((a, b) => a.args[2] - b.args[2]);
  assert.equal(ribs.length, 15);
  // Proportional lift: rib alpha = ribAlpha(k) × (0.55 + 0.45 × 0.5) / 0.9.
  ribs.forEach((a, idx) => {
    const expected = (ribAlpha(idx + 1) * 0.775) / 0.9;
    assert.ok(Math.abs(a.globalAlpha - expected) < 1e-9, `pulsed rib ${idx + 1} alpha == ${expected} (${a.globalAlpha})`);
  });

  // Expired stamp (≥1s old): normal 0.9 alpha base, no pulse lift.
  const expiredPaint = paint(
    BEATS_12,
    LAYOUT_12,
    { counts, pulses: new Map([[0, 1.5]]), nowSec: 10 },
  );
  const normalBase = baseArcs(expiredPaint, BAND_12)[0];
  assert.equal(normalBase.globalAlpha, 0.9, 'expired pulse ⇒ normal 0.9 alpha');
  const expiredRibs = ribArcs(expiredPaint).sort((a, b) => a.args[2] - b.args[2]);
  assert.ok(Math.abs(expiredRibs[0].globalAlpha - 0.9) < 1e-9, 'expired pulse ⇒ plain rib alpha');
}

{ // Reduced motion: cap pulse suppressed (no re-brightening); ribs still
  // render statically.
  const pulses = new Map([[0, 9.5]]);
  const counts = new Map([[0, 17]]);
  const ctx = paint(BEATS_12, LAYOUT_12, { counts, pulses, reducedMotion: true, nowSec: 10 });
  const base = baseArcs(ctx, BAND_12)[0];
  assert.equal(base.globalAlpha, 0.9, 'reduced motion ⇒ pulse suppressed');
  const ribs = ribArcs(ctx);
  assert.equal(ribs.length, 15, 'reduced motion ⇒ static ribs still paint');
}

{ // Missing stamp ⇒ NO pulse for that tile: a pulse map holding only index 3
  // must re-brighten exactly one band; every other non-current tile stays at
  // alpha 0.9 (a sentinel default would decay(−∞) = 1 and brighten the ring).
  const pulses = new Map([[3, 9.5]]);
  const ctx = paint(BEATS_12, LAYOUT_12, { counts: null, pulses, nowSec: 10 });
  // Base-band arcs (lineWidth band): collect alpha by ring index order —
  // tile arc k is the k-th base stroke (one per tile, no glow: no currentBeat).
  const baseAlphas = baseArcs(ctx, BAND_12).map((a) => a.globalAlpha);
  assert.equal(baseAlphas.length, 12, 'one base arc per tile');
  baseAlphas.forEach((alpha, idx) => {
    const expected = idx === 3 ? 0.55 + 0.45 * decayHalf() : 0.9;
    assert.ok(
      Math.abs(alpha - expected) < 1e-9,
      `tile ${idx} alpha == ${expected} with a stamp only on tile 3 (${alpha})`,
    );
  });
  // And a stamp on a non-current tile doesn't pin the current tile's glow.
  const pulses2 = new Map([[1, 9.5]]);
  // Backdate the beat-tick glow 0.5s: glow alone ⇒ alpha 0.775.
  const ctx2 = paint(BEATS_12, LAYOUT_12, { currentBeat: BEATS_12[0], currentIndex: 0, counts: null, pulses: pulses2, nowSec: 10, glowAt: 9.5 });
  const currentAlpha = baseArcs(ctx2, BAND_12)[0];
  // 0.55 + 0.45 × glowDecay(0.5) = 0.775 — the decaying glow ramp, NOT pinned
  // at 1.0 by a missing-stamp sentinel (would be 1.0 forever with the bug).
  assert.ok(Math.abs(currentAlpha.globalAlpha - 0.775) < 1e-9, `current tile glow decays unpinned (${currentAlpha.globalAlpha})`);
}

/** Half-life 0.5s decay of the cap pulse (mirrors paint's 0.55 + 0.45 × decay). */
function decayHalf() {
  return 1 - 0.5; // stamp 9.5, nowSec 10 ⇒ elapsed 0.5 ⇒ decay 0.5
}

{ // Dot-position coupling: current beat with count 4 ⇒ dot center at
  // ringRadius − band/2 + min(9, band/2) + growth/2 (growth = min(4,6)·3 = 12;
  // rib mode at 800×800/margin 32). Brightness layouts have no rib growth, so
  // the midline point is mode-independent in position formula only.
  const counts = new Map([[0, 4]]);
  const ctx = paint(BEATS_12, LAYOUT_12, { currentBeat: BEATS_12[0], currentIndex: 0, counts, nowSec: 10 });
  const growth = PLAY_GROWTH_FOR(4, 'ribs');
  const dot = GLOW_DOT_POSITION(LAYOUT_12, BAND_12, growth, LAYOUT_12.tiles[0]);
  const dotArcs = callsOf(ctx, 'arc').filter((a) => Math.abs(a.args[0] - dot.x) < 1e-9 && Math.abs(a.args[1] - dot.y) < 1e-9);
  assert.ok(dotArcs.length >= 2, 'halo + core arcs at the grown midline point');
  const expectedR = LAYOUT_12.radius - BAND_12 / 2 + Math.min(9, BAND_12 / 2) + growth / 2;
  const ux = (LAYOUT_12.tiles[0].x - LAYOUT_12.center.x) / LAYOUT_12.radius;
  const uy = (LAYOUT_12.tiles[0].y - LAYOUT_12.center.y) / LAYOUT_12.radius;
  const expectedX = LAYOUT_12.center.x + ux * expectedR;
  const expectedY = LAYOUT_12.center.y + uy * expectedR;
  assert.ok(Math.abs(dot.x - expectedX) < 1e-9 && Math.abs(dot.y - expectedY) < 1e-9, `dot at midline formula point (${dot.x}, ${dot.y})`);
}

{ // Jump-candidate dots: small translucent dots in the inner white space —
  // the dot's OUTER edge sits 3px clear of the band's INNER edge — in the
  // candidate tile's jewel color; nonexistent ids and the current beat's own
  // id produce nothing; only the CURRENT beat's candidates matter; no current
  // beat ⇒ no dots. Independent of growth: play counts never move these dots.
  BEATS_12[0].jump_candidates = [1, 5, 99]; // 99 = nonexistent id
  BEATS_12[2].jump_candidates = [0]; // non-current tile's candidates: ignored
  try {
    const ctx = paint(BEATS_12, LAYOUT_12, { currentBeat: BEATS_12[0], currentIndex: 0, counts: null, nowSec: 10 });
    // Candidate-dot fill arcs: radius BAND_12 × 0.7 / 2 exactly, alpha 0.5.
    const dotArcs = callsOf(ctx, 'arc').filter((a) => Math.abs(a.args[2] - CANDIDATE_DOT_DIAMETER_FOR(BAND_12) / 2) < 1e-9);
    assert.equal(dotArcs.length, 2, `exactly 2 candidate dots (got ${dotArcs.length})`);
    assert.equal(CANDIDATE_DOT_DIAMETER_FOR(BAND_12), BAND_12 * 0.7);
    const dot1 = CANDIDATE_DOT_POSITION(LAYOUT_12, BAND_12, LAYOUT_12.tiles[1]);
    const dot5 = CANDIDATE_DOT_POSITION(LAYOUT_12, BAND_12, LAYOUT_12.tiles[5]);
    const byPos = (dot) => dotArcs.find((a) => Math.abs(a.args[0] - dot.x) < 1e-9 && Math.abs(a.args[1] - dot.y) < 1e-9);
    const arc1 = byPos(dot1);
    const arc5 = byPos(dot5);
    assert.ok(arc1, 'candidate dot on tile 1, 3px clear inside the band');
    assert.ok(arc5, 'candidate dot on tile 5, 3px clear inside the band');
    assert.equal(arc1.globalAlpha, CANDIDATE_DOT_ALPHA, 'candidate dot alpha 0.5');
    assert.equal(arc5.globalAlpha, CANDIDATE_DOT_ALPHA, 'candidate dot alpha 0.5');
    const cBeat1 = BEATS_12[1];
    assert.equal(arc1.fillStyle, JEWEL_COLOR_FOR_CLUSTER(cBeat1.cluster, PALETTE), 'tile-1 dot uses the tile\'s jewel color');
    // Edge clearance: dot center radius = ringRadius − band/2 − 3 − dotRadius
    // (outer edge exactly 3px inside the band's inner edge).
    const clearR = LAYOUT_12.radius - BAND_12 / 2 - 3 - CANDIDATE_DOT_DIAMETER_FOR(BAND_12) / 2;
    const r5 = Math.hypot(dot5.x - LAYOUT_12.center.x, dot5.y - LAYOUT_12.center.y);
    assert.ok(Math.abs(r5 - clearR) < 1e-9, `tile-5 dot center radius clears band inner edge by 3px + dotRadius (${r5} vs ${clearR})`);
    // No dot on the current tile (self skipped), no dot from id 99, none from
    // beat 2's candidate list while beat 0 is current.
    const dot0 = CANDIDATE_DOT_POSITION(LAYOUT_12, BAND_12, LAYOUT_12.tiles[0]);
    assert.ok(!byPos(dot0), 'no self-candidate dot under the playhead');
    assert.equal(dotArcs.length, 2, 'nonexistent id 99 and beat 2\'s list contribute nothing');
  } finally {
    BEATS_12[0].jump_candidates = [];
    BEATS_12[2].jump_candidates = [];
  }

  { // No current beat ⇒ zero candidate dots.
    BEATS_12[0].jump_candidates = [1];
    try {
      const ctx = paint(BEATS_12, LAYOUT_12, { currentIndex: -1 });
      const dotArcs = callsOf(ctx, 'arc').filter((a) => Math.abs(a.args[2] - CANDIDATE_DOT_DIAMETER_FOR(BAND_12) / 2) < 1e-9);
      assert.equal(dotArcs.length, 0, 'no current beat ⇒ no candidate dots');
    } finally {
      BEATS_12[0].jump_candidates = [];
    }
  }
}

console.log('repeats.test.mjs OK');