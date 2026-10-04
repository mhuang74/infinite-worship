/**
 * Jump arc tests (v2 step 2): one smooth quadratic chord per jump bowing
 * toward the ring center; a jagged white-hot bolt rides it for the first
 * 0.2s; the chord then persists as beat-driven short-term memory
 * (alpha 1.0 → 0.15 over 16 beats, → 0 over the following 16, gone at 32).
 * Suppressed entirely under reduced motion; no arcs for sequential playback.
 */
import assert from 'node:assert/strict';
import { compileTs, FakeCtx, callsOf } from './harness.mjs';

const drawUrl = compileTs('src/lib/zen/draw.ts');
const { LAYOUT_RING, PAINT_FRAME } = await import(drawUrl);

const PALETTE = {
  jewels: ['#ff8a80', '#fdb515', '#7bd5a8', '#8ab8ff', '#cfa9f5', '#7fdce8'],
  playhead: '#fdb515',
  background: '#0e141c',
  spark: '#FFFFFF',
};
const ARC_LINE_WIDTH = 3.2;
const MEMORY_BEATS = 16;

function makeBeat(id) {
  return { id, start: id * 0.5, duration: 0.5, cluster: id % 6, segment: 0, jump_candidates: [] };
}

function paint(
  beats,
  layout,
  { currentBeat, currentIndex, jumps, reducedMotion = false, nowSec = 0, counts = null } = {},
) {
  const ctx = new FakeCtx({ width: 400, height: 400 });
  PAINT_FRAME(
    {
      beats,
      layout,
      palette: PALETTE,
      currentBeat: currentBeat ?? null,
      currentBeatIndex: currentIndex ?? (currentBeat ? beats.findIndex((b) => b.id === currentBeat.id) : -1),
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

/** Chord strokes: lineWidth 3.2 playhead strokes (the smooth quadratic). */
function chordStrokes(ctx) {
  return callsOf(ctx, 'stroke').filter(
    (s) => s.lineWidth === ARC_LINE_WIDTH && s.strokeStyle === PALETTE.playhead,
  );
}

/** Bolt strokes: white strokes at halo (2.5) or core (1.0) width. */
function boltStrokes(ctx, width) {
  return callsOf(ctx, 'stroke').filter(
    (s) => s.lineWidth === width && s.strokeStyle === PALETTE.spark,
  );
}

{ // Arc geometry: moveTo(source tile) + quadraticCurveTo(ctrl, dest tile),
  // lineWidth 3.2; control point bows toward the ring center.
  const beats = Array.from({ length: 12 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 400, height: 400, margin: 20 });
  const jumps = [{ count: 1, from: beats[1], to: beats[9], fromIndex: 1, toIndex: 9, eventTSec: 5 }];
  // Paint 1s after the spark so only the memory-phase chord remains.
  const ctx = paint(beats, layout, { currentBeat: beats[9], jumps, nowSec: 5.5 });

  const chords = chordStrokes(ctx);
  assert.equal(chords.length, 1, `exactly one chord stroke, got ${chords.length}`);
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
  // Memory phase (beatsSince = (9−1)%12 = 8 ⇒ alpha = 1 − 0.85·8/16 = 0.575).
  assert.ok(Math.abs(chords[0].globalAlpha - 0.575) < 1e-9, `memory alpha at beatsSince 8 == 0.575 (${chords[0].globalAlpha})`);
}

{ // Spark phase (<0.2s): jagged bolt = 1 moveTo + 5 lineTos (6-point path,
  // two passes: halo 2.5 alpha 1.0 + core 1.0 alpha 0.95, both #FFFFFF) over
  // a dimmed chord (alpha = 0.45 × memAlpha).
  const beats = Array.from({ length: 12 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 400, height: 400, margin: 20 });
  const jumps = [{ count: 1, from: beats[1], to: beats[9], fromIndex: 1, toIndex: 9, eventTSec: 5 }];
  const ctx = paint(beats, layout, { currentBeat: beats[9], jumps, nowSec: 5.1 });

  const halos = boltStrokes(ctx, 2.5);
  const cores = boltStrokes(ctx, 1.0);
  assert.equal(halos.length, 1, 'one bolt halo stroke');
  assert.equal(cores.length, 1, 'one bolt core stroke');
  assert.equal(halos[0].globalAlpha, 1.0, 'bolt halo alpha 1.0');
  assert.ok(Math.abs(cores[0].globalAlpha - 0.95) < 1e-9, 'bolt core alpha 0.95');
  const boltMoves = callsOf(ctx, 'moveTo').filter((m) => m.args[0] === layout.tiles[1].x && m.args[1] === layout.tiles[1].y);
  assert.equal(boltMoves.length, 3, 'two bolt paths + one chord start at the source tile');
  // Each bolt path: 5 lineTos after its moveTo.
  const boltLineTos = callsOf(ctx, 'lineTo').filter((l) => l.strokeStyle === PALETTE.spark);
  assert.equal(boltLineTos.length, 10, 'two bolt passes × 5 segments');
  // Jitter is deterministic per jump: two paints in the same spark window
  // give identical bolt points.
  const ctx2 = paint(beats, layout, { currentBeat: beats[9], jumps, nowSec: 5.15 });
  const first = boltLineTos.map((l) => l.args);
  const second = callsOf(ctx2, 'lineTo').filter((l) => l.strokeStyle === PALETTE.spark).map((l) => l.args);
  assert.deepEqual(first, second, 'bolt jitter is stable across repaints');
  // Jagged, not a uniform kink: the 5 halo midpoints must NOT share a single
  // fixed offset (a reseeded-per-call LCG would displace every point by the
  // same scalar and render a straight shifted arc).
  const midHalo = first.slice(0, 5);
  const distinct = new Set(midHalo.map(([x, y]) => `${x},${y}`));
  assert.equal(distinct.size, 5, 'all 5 bolt midpoints distinct (per-midpoint jitter advance)');
  // Dimmed chord: beatsSince = (9−1)%12 = 8 ⇒ alpha = 0.45 × 0.575.
  const chords = chordStrokes(ctx);
  assert.equal(chords.length, 1, 'chord also strokes during spark');
  assert.ok(Math.abs(chords[0].globalAlpha - 0.45 * 0.575) < 1e-9, `spark chord alpha == 0.45 × memAlpha(8) (${chords[0].globalAlpha})`);
  {
    // Fresh spark at b=0: current beat still on the FROM tile (jump just
    // fired; the to-beat hasn't started yet) — alpha == 0.45 × 1.0.
    const ctx0 = paint(beats, layout, { currentBeat: beats[1], currentIndex: 1, jumps, nowSec: 5.05 });
    const chords0 = chordStrokes(ctx0);
    assert.ok(Math.abs(chords0[0].globalAlpha - 0.45) < 1e-9, `spark chord alpha at b=0 == 0.45 (${chords0[0].globalAlpha})`);
  }
}

{ // No bolt at ≥ 0.2s.
  const beats = Array.from({ length: 12 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 400, height: 400, margin: 20 });
  const jumps = [{ count: 1, from: beats[1], to: beats[9], fromIndex: 1, toIndex: 9, eventTSec: 5 }];
  const ctx = paint(beats, layout, { currentBeat: beats[9], jumps, nowSec: 5.2 });
  assert.equal(boltStrokes(ctx, 2.5).length, 0, 'no bolt halo at the spark boundary');
  assert.equal(boltStrokes(ctx, 1.0).length, 0, 'no bolt core at the spark boundary');
  // Future-dated event (not yet arrived): no bolt either.
  const futureCtx = paint(beats, layout, { currentBeat: beats[9], jumps, nowSec: 4.9 });
  assert.equal(boltStrokes(futureCtx, 2.5).length, 0, 'no bolt before the event time');
}

{ // Beat-decay contract (memory + ghost phases, one formula).
  const beats = Array.from({ length: 48 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 800, height: 800, margin: 32 });
  // Jump from 4 to 8; the ring position walks forward from the FROM tile:
  // ringPos = 4 + beatsSince (mod 48). Assert the spec's alpha schedule at
  // each beatsSince directly.
  const cases = [
    [0, 1.0], [8, 0.575], [16, 0.15], [24, 0.075], [31, 0.15 * (1 / 16)],
  ];
  for (const [beatsSince, expected] of cases) {
    const jumps = [{ count: 1, from: beats[4], to: beats[8], fromIndex: 4, toIndex: 8, eventTSec: 5 }];
    const ringPos = (4 + beatsSince) % 48;
    const ctx = paint(beats, layout, {
      currentBeat: beats[ringPos],
      currentIndex: ringPos,
      jumps,
      nowSec: 6,
    });
    const chords = chordStrokes(ctx);
    assert.equal(chords.length, 1, `beatsSince ${beatsSince}: chord strokes once`);
    assert.ok(
      Math.abs(chords[0].globalAlpha - expected) < 0.002,
      `beatsSince ${beatsSince}: alpha ${chords[0].globalAlpha} ≈ ${expected}`,
    );
  }
  // ≥32 beats: no chord stroke at all.
  const gone = paint(beats, layout, {
    currentBeat: beats[(4 + 32) % 48], currentIndex: (4 + 32) % 48,
    jumps: [{ count: 1, from: beats[4], to: beats[8], fromIndex: 4, toIndex: 8, eventTSec: 5 }], nowSec: 6,
  });
  assert.equal(chordStrokes(gone).length, 0, 'alpha 0 at ≥32 ⇒ no stroke at all');
}

{ // Monotone decreasing across the schedule.
  const beats = Array.from({ length: 48 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 800, height: 800, margin: 32 });
  const alphas = [];
  for (let b = 0; b < 31; b++) {
    // Jump fired while the ring position was 4; position walks forward.
    const jumps = [{ count: 1, from: beats[4], to: beats[8], fromIndex: 4, toIndex: 8, eventTSec: 5 }];
    const ctx = paint(beats, layout, { currentBeat: null, currentIndex: (4 + b) % 48, jumps, nowSec: 6 });
    alphas.push(chordStrokes(ctx)[0].globalAlpha);
  }
  for (let i = 1; i < alphas.length; i++) {
    assert.ok(alphas[i] < alphas[i - 1], `alpha monotone decreasing at step ${i} (${alphas[i - 1]} → ${alphas[i]})`);
  }
}

{ // Wrap: jump from index 40 of 48, current at 2 ⇒ beatsSince 10 ⇒ 0.469.
  const beats = Array.from({ length: 48 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 800, height: 800, margin: 32 });
  const jumps = [{ count: 1, from: beats[40], to: beats[4], fromIndex: 40, toIndex: 4, eventTSec: 5 }];
  const ctx = paint(beats, layout, { currentBeat: beats[2], currentIndex: 2, jumps, nowSec: 6 });
  const chords = chordStrokes(ctx);
  const expected = 1 - 0.85 * (10 / MEMORY_BEATS); // 0.46875
  assert.ok(Math.abs(chords[0].globalAlpha - expected) < 0.002, `wrap alpha ${(10)} ⇒ ${expected} (${chords[0].globalAlpha})`);
}

{ // Exactly 0.15 at the 16 boundary + no-arc edge cases + reduced motion.
  const beats = Array.from({ length: 48 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 800, height: 800, margin: 32 });
  const jumps = [{ count: 1, from: beats[0], to: beats[16], fromIndex: 0, toIndex: 16, eventTSec: 5 }];
  const ctx = paint(beats, layout, { currentBeat: beats[16], currentIndex: 16, jumps, nowSec: 6 });
  const chords = chordStrokes(ctx);
  assert.ok(Math.abs(chords[0].globalAlpha - 0.15) < 1e-9, `exactly 0.15 at beatsSince 16 (${chords[0].globalAlpha})`);

  // Missing indices (unresolvable jumps): no stroke, no throw.
  const broken = paint(beats, layout, {
    currentBeat: beats[16], currentIndex: 16,
    jumps: [{ count: 1, from: beats[0], to: beats[4], fromIndex: 200, toIndex: 16, eventTSec: 5 }], nowSec: 6,
  });
  assert.equal(chordStrokes(broken).length, 0, 'missing tile ⇒ no arc');

  // Reduced motion: no arcs, no sparks at all.
  const rmCtx = paint(beats, layout, {
    currentBeat: beats[16], currentIndex: 16, jumps,
    reducedMotion: true, nowSec: 5.05,
  });
  assert.equal(chordStrokes(rmCtx).length, 0, 'reduced motion suppresses chords');
  assert.equal(boltStrokes(rmCtx, 2.5).length, 0, 'reduced motion suppresses bolt halos');
  assert.equal(boltStrokes(rmCtx, 1.0).length, 0, 'reduced motion suppresses bolt cores');
}

{ // Sequential playback only (no jump): zero arcs, zero bolts.
  const beats = Array.from({ length: 12 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 400, height: 400, margin: 20 });
  const ctx = paint(beats, layout, { currentBeat: beats[4], currentIndex: 4, jumps: [], nowSec: 2 });
  assert.equal(chordStrokes(ctx).length, 0, 'no chord strokes without a jump');
  assert.equal(boltStrokes(ctx, 2.5).length, 0, 'no bolts without a jump');
}

{ // Two overlapping jumps: each gets its own chord. Alphas follow the beat
  // schedule, not arrival time: jump 1 (from 0, current 2) ⇒ beatsSince 2;
  // jump 2 (from 6, current 2) ⇒ beatsSince (2−6+12)%12 = 8 ⇒ dimmer.
  const beats = Array.from({ length: 12 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 400, height: 400, margin: 20 });
  const jumps = [
    { count: 1, from: beats[0], to: beats[6], fromIndex: 0, toIndex: 6, eventTSec: 5 },
    { count: 2, from: beats[6], to: beats[2], fromIndex: 6, toIndex: 2, eventTSec: 5.2 },
  ];
  const ctx = paint(beats, layout, { currentBeat: beats[2], currentIndex: 2, jumps, nowSec: 5.5 });
  const chords = chordStrokes(ctx);
  assert.equal(chords.length, 2, 'two chords, one per jump');
  const a0 = 1 - 0.85 * (2 / 16);
  const a1 = 1 - 0.85 * (8 / 16);
  assert.ok(Math.abs(chords[0].globalAlpha - a0) < 0.002, `jump 1 alpha == ${a0} (${chords[0].globalAlpha})`);
  assert.ok(Math.abs(chords[1].globalAlpha - a1) < 0.002, `jump 2 alpha == ${a1} (${chords[1].globalAlpha})`);
  assert.ok(chords[0].globalAlpha > chords[1].globalAlpha, `jump 1 ${chords[0].globalAlpha} brighter than jump 2 ${chords[1].globalAlpha}`);
}

console.log('arcs.test.mjs OK');