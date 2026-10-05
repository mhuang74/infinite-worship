/**
 * Jump arc tests (v2 step 2): one smooth quadratic chord per jump bowing
 * toward the ring center, colored by the TARGET beat's jewel, backed for the
 * first 1s by additive glow layers (18px @ 0.18, 11px @ 0.35 of the chord
 * alpha, linear ramp) that fade into the fixed-width 3.2px chord. Beat-driven
 * memory alpha schedule on top.
 *
 * Suppressed entirely under reduced motion; no arcs for sequential playback.
 */
import assert from 'node:assert/strict';
import { compileTs, FakeCtx, callsOf } from './harness.mjs';

const drawUrl = compileTs('src/lib/zen/draw.ts');
const { LAYOUT_RING, PAINT_FRAME, JEWEL_COLOR_FOR_CLUSTER } = await import(drawUrl);

const PALETTE = {
  jewels: ['#ff8a80', '#fdb515', '#7bd5a8', '#8ab8ff', '#cfa9f5', '#7fdce8'],
  background: '#0e141c',
};
const ARC_LINE_WIDTH = 3.2;
const ARC_GLOW_WIDTHS = [18, 11];
const MEMORY_BEATS = 16;

function makeBeat(id) {
  return { id, start: id * 0.5, duration: 0.5, cluster: id % 6, segment: 0, jump_candidates: [] };
}

function paint(
  beats,
  layout,
  { currentBeat, currentIndex, jumps, reducedMotion = false, nowSec = 0, counts = null, beatCount = 0 } = {},
) {
  const ctx = new FakeCtx({ width: 400, height: 400 });
  PAINT_FRAME(
    {
      beats,
      layout,
      palette: PALETTE,
      currentBeat: currentBeat ?? null,
      currentBeatIndex: currentIndex ?? (currentBeat ? beats.findIndex((b) => b.id === currentBeat.id) : -1),
      beatCount,
      jumps,
      reducedMotion,
      nowSec,
      currentBeatGlowTSec: nowSec,
      beatPlayCounts: counts ?? undefined,
    },
    ctx,
  );
  return ctx;
}

/** Chord strokes: fixed-width 3.2px arcs in the target beat's jewel color. */
function chordStrokes(ctx, color) {
  return callsOf(ctx, 'stroke').filter(
    (s) => s.lineWidth === ARC_LINE_WIDTH && s.strokeStyle === color,
  );
}

/** Glow strokes: jewel-colored strokes at a glow width (18/11). */
function glowStrokes(ctx, width, color) {
  return callsOf(ctx, 'stroke').filter(
    (s) => s.lineWidth === width && s.strokeStyle === color,
  );
}

{ // Arc geometry: moveTo(source tile) + quadraticCurveTo(ctrl, dest tile),
  // lineWidth 3.2; control point bows toward the ring center.
  const beats = Array.from({ length: 12 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 400, height: 400, margin: 20 });
  const jumps = [{ count: 1, from: beats[1], to: beats[9], fromIndex: 1, toIndex: 9, eventTSec: 5, eventBeatCount: 0 }];
  // Paint past the 1s glow window so only the memory-phase chord remains.
  const arcColor = JEWEL_COLOR_FOR_CLUSTER(beats[9].cluster, PALETTE); // cluster 9 % 6 = 3 → '#8ab8ff'
  const ctx = paint(beats, layout, { currentBeat: beats[9], jumps, nowSec: 6 });

  const chords = chordStrokes(ctx, arcColor);
  assert.equal(chords.length, 1, `exactly one chord stroke, got ${chords.length}`);
  assert.equal(chords[0].strokeStyle, arcColor, 'chord is the target beat jewel color');
  const moveTo = callsOf(ctx, 'moveTo').find(
    (m) => m.args[0] === layout.tiles[1].x && m.args[1] === layout.tiles[1].y,
  );
  assert.ok(moveTo, 'chord starts at the source tile');
  const quads = callsOf(ctx, 'quadraticCurveTo');
  assert.equal(quads.length, 1, 'one quadraticCurveTo per chord');
  const q = quads[0];
  assert.equal(q.args[2], layout.tiles[9].x, 'chord ends at the destination tile x');
  assert.equal(q.args[3], layout.tiles[9].y, 'chord ends at the destination tile y');
  // Control point: midpoint pulled 0.35 toward the ring center.
  const mx = (layout.tiles[1].x + layout.tiles[9].x) / 2;
  const my = (layout.tiles[1].y + layout.tiles[9].y) / 2;
  const expectedCx = mx + (layout.center.x - mx) * 0.35;
  const expectedCy = my + (layout.center.y - my) * 0.35;
  assert.ok(Math.abs(q.args[0] - expectedCx) < 1e-9, `ctrl x bows to the center (${q.args[0]} vs ${expectedCx})`);
  assert.ok(Math.abs(q.args[1] - expectedCy) < 1e-9, `ctrl y bows to the center (${q.args[1]} vs ${expectedCy})`);
  // Memory phase (8 beats elapsed since arrival ⇒ alpha = 1 − 0.85·8/16 = 0.575).
  const memCtx = paint(beats, layout, { currentBeat: beats[9], jumps, beatCount: 8, nowSec: 6 });
  const memChords = chordStrokes(memCtx, arcColor);
  assert.ok(Math.abs(memChords[0].globalAlpha - 0.575) < 1e-9, `memory alpha at beatsSince 8 == 0.575 (${memChords[0].globalAlpha})`);
}

{ // Glow window (<1s): the SAME quadratic chord path — outer glow (18px,
  // alpha 0.18 × ramp × memAlpha), inner glow (11px, alpha 0.35 × ramp ×
  // memAlpha) — plus the persistent 3.2px chord at full memAlpha underneath,
  // ALL in the target beat's jewel color. Glow paints first (under), chord last.
  const beats = Array.from({ length: 12 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 400, height: 400, margin: 20 });
  const jumps = [{ count: 1, from: beats[1], to: beats[9], fromIndex: 1, toIndex: 9, eventTSec: 5, eventBeatCount: 0 }];
  const arcColor = JEWEL_COLOR_FOR_CLUSTER(beats[9].cluster, PALETTE);
  // age = 0.1 ⇒ ramp = 0.9; memAlpha(8) = 0.575.
  const ctx = paint(beats, layout, { currentBeat: beats[9], jumps, beatCount: 8, nowSec: 5.1 });

  const outer = glowStrokes(ctx, ARC_GLOW_WIDTHS[0], arcColor);
  const inner = glowStrokes(ctx, ARC_GLOW_WIDTHS[1], arcColor);
  const chords = chordStrokes(ctx, arcColor);
  assert.equal(outer.length, 1, 'one outer glow stroke');
  assert.equal(inner.length, 1, 'one inner glow stroke');
  assert.equal(chords.length, 1, 'one persistent chord under the glow');
  const ramp = 0.9;
  const memAlpha = 0.575;
  assert.ok(Math.abs(inner[0].globalAlpha - 0.35 * ramp * memAlpha) < 1e-9, `inner glow alpha == 0.35 × ramp × memAlpha (${inner[0].globalAlpha})`);
  assert.ok(Math.abs(outer[0].globalAlpha - 0.18 * ramp * memAlpha) < 1e-9, `outer glow alpha == 0.18 × ramp × memAlpha (${outer[0].globalAlpha})`);
  assert.ok(Math.abs(chords[0].globalAlpha - 1.0 * memAlpha) < 1e-9, `chord alpha == full memAlpha during the glow window (${chords[0].globalAlpha})`);
  assert.equal(outer[0].strokeStyle, arcColor, 'outer glow is the target jewel color');
  assert.equal(inner[0].strokeStyle, arcColor, 'inner glow is the target jewel color');
  assert.equal(chords[0].strokeStyle, arcColor, 'chord is the target jewel color');
  // Layer order: outer glow first, inner glow second, chord last (glow under).
  const allStrokes = callsOf(ctx, 'stroke');
  const arcIdx = allStrokes
    .map((s, i) => (s.strokeStyle === arcColor && [18, 11, ARC_LINE_WIDTH].includes(s.lineWidth) ? i : -1))
    .filter((i) => i >= 0);
  assert.equal(arcIdx.length, 3, 'three arc strokes total');
  assert.equal(allStrokes[arcIdx[0]].lineWidth, 18, 'outer glow painted first');
  assert.equal(allStrokes[arcIdx[1]].lineWidth, 11, 'inner glow painted second');
  assert.equal(allStrokes[arcIdx[2]].lineWidth, ARC_LINE_WIDTH, 'chord painted last');
  // Geometry: each layer is a single quadratic path starting at the source tile.
  const arcMoves = callsOf(ctx, 'moveTo').filter((m) => m.args[0] === layout.tiles[1].x && m.args[1] === layout.tiles[1].y);
  assert.equal(arcMoves.length, 3, 'three arc paths start at the source tile');
  const arcLineTos = callsOf(ctx, 'lineTo').filter((l) => l.strokeStyle === arcColor);
  assert.equal(arcLineTos.length, 0, 'arc layers are pure quadratics (no lineTos)');
  const quads = callsOf(ctx, 'quadraticCurveTo');
  assert.equal(quads.length, 3, 'one quadratic per arc layer');
  // Determinism: the glow has no randomness — a repaint in the same window
  // shares identical quadratic geometry.
  const ctx2 = paint(beats, layout, { currentBeat: beats[9], jumps, beatCount: 8, nowSec: 5.1 });
  const first = callsOf(ctx, 'quadraticCurveTo').map((q) => q.args);
  const second = callsOf(ctx2, 'quadraticCurveTo').map((q) => q.args);
  assert.deepEqual(first, second, 'glow geometry is stable across repaints');
  // Linear ramp: later in the window ⇒ proportionally dimmer glow, same geometry.
  const ctx3 = paint(beats, layout, { currentBeat: beats[9], jumps, beatCount: 8, nowSec: 5.15 });
  const ramp2 = 0.85;
  const outer3 = glowStrokes(ctx3, ARC_GLOW_WIDTHS[0], arcColor);
  assert.ok(Math.abs(outer3[0].globalAlpha - 0.18 * ramp2 * memAlpha) < 1e-9, `outer glow alpha at age 0.15 == 0.18 × 0.85 × memAlpha (${outer3[0].globalAlpha})`);
  assert.deepEqual(callsOf(ctx3, 'quadraticCurveTo').map((q) => q.args), second, 'glow geometry unchanged at a different ramp');
}

{ // Glow persists past the old 0.2s window: still present at age 0.2 (ramp 0.8).
  const beats = Array.from({ length: 12 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 400, height: 400, margin: 20 });
  const jumps = [{ count: 1, from: beats[1], to: beats[9], fromIndex: 1, toIndex: 9, eventTSec: 5, eventBeatCount: 0 }];
  const arcColor = JEWEL_COLOR_FOR_CLUSTER(beats[9].cluster, PALETTE);
  const ctx = paint(beats, layout, { currentBeat: beats[9], jumps, beatCount: 8, nowSec: 5.2 });
  assert.equal(glowStrokes(ctx, ARC_GLOW_WIDTHS[0], arcColor).length, 1, 'outer glow still present at age 0.2');
  assert.equal(glowStrokes(ctx, ARC_GLOW_WIDTHS[1], arcColor).length, 1, 'inner glow still present at age 0.2');
  assert.equal(chordStrokes(ctx, arcColor).length, 1, 'chord strokes under the glow');
}

{ // Glow gone at ≥1s; future-dated event draws nothing at all.
  const beats = Array.from({ length: 12 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 400, height: 400, margin: 20 });
  const jumps = [{ count: 1, from: beats[1], to: beats[9], fromIndex: 1, toIndex: 9, eventTSec: 5, eventBeatCount: 0 }];
  const arcColor = JEWEL_COLOR_FOR_CLUSTER(beats[9].cluster, PALETTE);
  const ctx = paint(beats, layout, { currentBeat: beats[9], jumps, nowSec: 6 });
  assert.equal(glowStrokes(ctx, ARC_GLOW_WIDTHS[0], arcColor).length, 0, 'no outer glow past the 1s window');
  assert.equal(glowStrokes(ctx, ARC_GLOW_WIDTHS[1], arcColor).length, 0, 'no inner glow past the 1s window');
  // The persistent chord IS present after the glow fades.
  assert.equal(chordStrokes(ctx, arcColor).length, 1, 'chord strokes after the glow window');
  // Future-dated event (not yet arrived): no strokes at all.
  const futureCtx = paint(beats, layout, { currentBeat: beats[9], jumps, nowSec: 4.9 });
  assert.equal(glowStrokes(futureCtx, ARC_GLOW_WIDTHS[0], arcColor).length, 0, 'no glow before the event time');
  assert.equal(chordStrokes(futureCtx, arcColor).length, 0, 'no chord before the event time');
}

{ // Beat-decay contract (memory + ghost phases, one formula).
  const beats = Array.from({ length: 48 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 800, height: 800, margin: 32 });
  // Jump from 4 to 8; decay is anchored to the jump's arrival beat tick:
  // beatsSince = beatCount − eventBeatCount. Assert the spec's alpha
  // schedule at each beatsSince directly. currentIndex is irrelevant to the
  // alpha now (walked forward anyway to mirror real playback).
  const cases = [
    [0, 1.0], [8, 0.575], [16, 0.15], [24, 0.075], [31, 0.15 * (1 / 16)],
  ];
  const decArcColor = JEWEL_COLOR_FOR_CLUSTER(beats[8].cluster, PALETTE);
  for (const [beatsSince, expected] of cases) {
    const jumps = [{ count: 1, from: beats[4], to: beats[8], fromIndex: 4, toIndex: 8, eventTSec: 5, eventBeatCount: 0 }];
    const ringPos = (4 + beatsSince) % 48;
    const ctx = paint(beats, layout, {
      currentBeat: beats[ringPos],
      currentIndex: ringPos,
      jumps,
      beatCount: beatsSince,
      nowSec: 6,
    });
    const chords = chordStrokes(ctx, decArcColor);
    assert.equal(chords.length, 1, `beatsSince ${beatsSince}: chord strokes once`);
    assert.ok(
      Math.abs(chords[0].globalAlpha - expected) < 0.002,
      `beatsSince ${beatsSince}: alpha ${chords[0].globalAlpha} ≈ ${expected}`,
    );
  }
  // ≥32 beats: no chord stroke at all.
  const gone = paint(beats, layout, {
    currentBeat: beats[(4 + 32) % 48], currentIndex: (4 + 32) % 48,
    jumps: [{ count: 1, from: beats[4], to: beats[8], fromIndex: 4, toIndex: 8, eventTSec: 5, eventBeatCount: 0 }],
    beatCount: 32, nowSec: 6,
  });
  assert.equal(chordStrokes(gone, decArcColor).length, 0, 'alpha 0 at ≥32 ⇒ no stroke at all');
}

{ // REGRESSION (phantom re-light): a jump 32+ beats OLD must NOT re-draw when
  // the playhead wraps around and sits exactly ON its source tile. The old
  // playhead-anchored formula ((currentIndex − fromIndex) % N) measured 0
  // there and re-lit the arc at full alpha every lap of the ring.
  const beats = Array.from({ length: 48 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 800, height: 800, margin: 32 });
  // Jump fired at beat tick 2 (playhead was ON tile 4); 40 beats elapsed.
  const jumps = [{ count: 1, from: beats[4], to: beats[8], fromIndex: 4, toIndex: 8, eventTSec: 5, eventBeatCount: 2 }];
  const phArcColor = JEWEL_COLOR_FOR_CLUSTER(beats[8].cluster, PALETTE);
  const ctx = paint(beats, layout, {
    currentBeat: beats[4], currentIndex: 4, jumps, beatCount: 42, nowSec: 6,
  });
  assert.equal(chordStrokes(ctx, phArcColor).length, 0, 'old jump on its source tile ⇒ no phantom chord');
  // Sanity: the same jump a few beats after arrival still draws (past the
  // 1s glow window, so the persistent chord strokes).
  const fresh = paint(beats, layout, {
    currentBeat: beats[4], currentIndex: 4, jumps, beatCount: 3, nowSec: 6,
  });
  assert.equal(chordStrokes(fresh, phArcColor).length, 1, 'fresh jump draws its chord');
}

{ // Monotone decreasing across the schedule.
  const beats = Array.from({ length: 48 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 800, height: 800, margin: 32 });
  const monoArcColor = JEWEL_COLOR_FOR_CLUSTER(beats[8].cluster, PALETTE);
  const alphas = [];
  for (let b = 0; b < 31; b++) {
    // Jump fired at beat tick 0; the beat-tick counter walks forward.
    const jumps = [{ count: 1, from: beats[4], to: beats[8], fromIndex: 4, toIndex: 8, eventTSec: 5, eventBeatCount: 0 }];
    const ctx = paint(beats, layout, { currentBeat: null, currentIndex: (4 + b) % 48, jumps, beatCount: b, nowSec: 6 });
    alphas.push(chordStrokes(ctx, monoArcColor)[0].globalAlpha);
  }
  for (let i = 1; i < alphas.length; i++) {
    assert.ok(alphas[i] < alphas[i - 1], `alpha monotone decreasing at step ${i} (${alphas[i - 1]} → ${alphas[i]})`);
  }
}

{ // Beat count ≥ eventBeatCount: jump fired 10 ticks ago ⇒ 0.469 (no
  // wrap arithmetic — decay is pure elapsed beats).
  const beats = Array.from({ length: 48 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 800, height: 800, margin: 32 });
  const jumps = [{ count: 1, from: beats[40], to: beats[4], fromIndex: 40, toIndex: 4, eventTSec: 5, eventBeatCount: 0 }];
  const ctx = paint(beats, layout, { currentIndex: 2, jumps, beatCount: 10, nowSec: 6 });
  const chords = chordStrokes(ctx, JEWEL_COLOR_FOR_CLUSTER(beats[4].cluster, PALETTE));
  const expected = 1 - 0.85 * (10 / MEMORY_BEATS); // 0.46875
  assert.ok(Math.abs(chords[0].globalAlpha - expected) < 0.002, `10 beats elapsed ⇒ ${expected} (${chords[0].globalAlpha})`);
}

{ // Exactly 0.15 at the 16 boundary + no-arc edge cases + reduced motion.
  const beats = Array.from({ length: 48 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 800, height: 800, margin: 32 });
  const jumps = [{ count: 1, from: beats[0], to: beats[16], fromIndex: 0, toIndex: 16, eventTSec: 5, eventBeatCount: 0 }];
  const bArcColor = JEWEL_COLOR_FOR_CLUSTER(beats[16].cluster, PALETTE);
  const ctx = paint(beats, layout, { currentIndex: 16, jumps, beatCount: 16, nowSec: 6 });
  const chords = chordStrokes(ctx, bArcColor);
  assert.ok(Math.abs(chords[0].globalAlpha - 0.15) < 1e-9, `exactly 0.15 at beatsSince 16 (${chords[0].globalAlpha})`);

  // Missing indices (unresolvable jumps): no stroke, no throw.
  const broken = paint(beats, layout, {
    currentBeat: beats[16], currentIndex: 16,
    jumps: [{ count: 1, from: beats[0], to: beats[4], fromIndex: 200, toIndex: 16, eventTSec: 5, eventBeatCount: 0 }], nowSec: 6,
  });
  assert.equal(chordStrokes(broken, bArcColor).length, 0, 'missing tile ⇒ no arc');

  // Reduced motion: no arcs, no glow at all.
  const rmCtx = paint(beats, layout, {
    currentBeat: beats[16], currentIndex: 16, jumps,
    reducedMotion: true, nowSec: 5.05,
  });
  assert.equal(chordStrokes(rmCtx, bArcColor).length, 0, 'reduced motion suppresses chords');
  assert.equal(glowStrokes(rmCtx, ARC_GLOW_WIDTHS[0], bArcColor).length, 0, 'reduced motion suppresses outer glow');
  assert.equal(glowStrokes(rmCtx, ARC_GLOW_WIDTHS[1], bArcColor).length, 0, 'reduced motion suppresses inner glow');
}

{ // Sequential playback only (no jump): zero arcs, zero glow.
  const beats = Array.from({ length: 12 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 400, height: 400, margin: 20 });
  const ctx = paint(beats, layout, { currentBeat: beats[4], currentIndex: 4, jumps: [], nowSec: 2 });
  // No jewel-colored arc strokes of any width without a jump.
  assert.equal(callsOf(ctx, 'stroke').filter((s) => PALETTE.jewels.includes(s.strokeStyle) && s.lineWidth !== undefined && [3.2, 18, 11].includes(s.lineWidth)).length, 0, 'no chord/glow strokes without a jump');
}

{ // Two overlapping jumps: each gets its own chord. Alphas follow elapsed
  // beats since each jump's arrival: jump 1 fired at tick 0 (7 ticks ago),
  // jump 2 at tick 5 (2 ticks ago) ⇒ jump 2 is brighter.
  const beats = Array.from({ length: 12 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 400, height: 400, margin: 20 });
  const jumps = [
    { count: 1, from: beats[0], to: beats[6], fromIndex: 0, toIndex: 6, eventTSec: 5, eventBeatCount: 0 },
    { count: 2, from: beats[6], to: beats[2], fromIndex: 6, toIndex: 2, eventTSec: 5.8, eventBeatCount: 5 },
  ];
  const ctx = paint(beats, layout, { currentIndex: 2, jumps, beatCount: 7, nowSec: 6 });
  // Each chord takes its TARGET beat's jewel color (cluster = id % 6).
  const chords0 = chordStrokes(ctx, JEWEL_COLOR_FOR_CLUSTER(beats[6].cluster, PALETTE)); // → beats[6]
  const chords2 = chordStrokes(ctx, JEWEL_COLOR_FOR_CLUSTER(beats[2].cluster, PALETTE)); // → beats[2]
  assert.equal(chords0.length, 1, 'jump 1 chord in its target color');
  assert.equal(chords2.length, 1, 'jump 2 chord in its target color');
  assert.notEqual(chords0[0].strokeStyle, chords2[0].strokeStyle, 'the two jumps have different target colors');
  const chords = [...chords0, ...chords2];
  const a0 = 1 - 0.85 * (7 / 16);
  const a1 = 1 - 0.85 * (2 / 16);
  assert.ok(Math.abs(chords0[0].globalAlpha - a0) < 0.002, `jump 1 alpha == ${a0} (${chords0[0].globalAlpha})`);
  assert.ok(Math.abs(chords2[0].globalAlpha - a1) < 0.002, `jump 2 alpha == ${a1} (${chords2[0].globalAlpha})`);
  assert.ok(chords2[0].globalAlpha > chords0[0].globalAlpha, `jump 2 ${chords2[0].globalAlpha} brighter than jump 1 ${chords0[0].globalAlpha}`);
  assert.equal(chords.length, 2, 'two chords, one per jump');
}

console.log('arcs.test.mjs OK');