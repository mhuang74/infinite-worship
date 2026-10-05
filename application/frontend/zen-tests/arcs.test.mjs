/**
 * Jump arc tests (v2 step 2): one smooth quadratic chord per jump bowing
 * toward the ring center; an energy beam fires along it for the first 0.2s
 * (thicker core + layered glow, linear alpha ramp, playhead gold); the chord
 * then persists as beat-driven short-term memory
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
};
const ARC_LINE_WIDTH = 3.2;
const BEAM_CORE_WIDTH = 6;
const BEAM_GLOW_WIDTHS = [18, 11];
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

/** Chord strokes: lineWidth 3.2 playhead strokes (the smooth quadratic). */
function chordStrokes(ctx) {
  return callsOf(ctx, 'stroke').filter(
    (s) => s.lineWidth === ARC_LINE_WIDTH && s.strokeStyle === PALETTE.playhead,
  );
}

/** Beam strokes: playhead-colored strokes at a glow (18/11) or core (6) width. */
function beamStrokes(ctx, width) {
  return callsOf(ctx, 'stroke').filter(
    (s) => s.lineWidth === width && s.strokeStyle === PALETTE.playhead,
  );
}

{ // Arc geometry: moveTo(source tile) + quadraticCurveTo(ctrl, dest tile),
  // lineWidth 3.2; control point bows toward the ring center.
  const beats = Array.from({ length: 12 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 400, height: 400, margin: 20 });
  const jumps = [{ count: 1, from: beats[1], to: beats[9], fromIndex: 1, toIndex: 9, eventTSec: 5, eventBeatCount: 0 }];
  // Paint 1s after the beam so only the memory-phase chord remains.
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
  // Memory phase (8 beats elapsed since arrival ⇒ alpha = 1 − 0.85·8/16 = 0.575).
  const memCtx = paint(beats, layout, { currentBeat: beats[9], jumps, beatCount: 8, nowSec: 5.5 });
  const memChords = chordStrokes(memCtx);
  assert.ok(Math.abs(memChords[0].globalAlpha - 0.575) < 1e-9, `memory alpha at beatsSince 8 == 0.575 (${memChords[0].globalAlpha})`);
}

{ // Energy-beam phase (<0.2s): the SAME quadratic chord path, stroked three
  // times — outer glow (18px, alpha 0.18 × ramp × memAlpha), inner glow
  // (11px, alpha 0.35 × ramp × memAlpha), core (6px, alpha 1.0 × ramp ×
  // memAlpha) — all playhead gold. The persistent 3.2px chord does NOT
  // stroke underneath during the beam window (the core fully covers it).
  const beats = Array.from({ length: 12 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 400, height: 400, margin: 20 });
  const jumps = [{ count: 1, from: beats[1], to: beats[9], fromIndex: 1, toIndex: 9, eventTSec: 5, eventBeatCount: 0 }];
  // age = 0.1 ⇒ ramp = 0.5; memAlpha(8) = 0.575.
  const ctx = paint(beats, layout, { currentBeat: beats[9], jumps, beatCount: 8, nowSec: 5.1 });

  const outer = beamStrokes(ctx, BEAM_GLOW_WIDTHS[0]);
  const inner = beamStrokes(ctx, BEAM_GLOW_WIDTHS[1]);
  const core = beamStrokes(ctx, BEAM_CORE_WIDTH);
  assert.equal(outer.length, 1, 'one outer glow stroke');
  assert.equal(inner.length, 1, 'one inner glow stroke');
  assert.equal(core.length, 1, 'one core stroke');
  const ramp = 0.5;
  const memAlpha = 0.575;
  assert.ok(Math.abs(core[0].globalAlpha - 1.0 * ramp * memAlpha) < 1e-9, `core alpha == 1.0 × ramp × memAlpha (${core[0].globalAlpha})`);
  assert.ok(Math.abs(inner[0].globalAlpha - 0.35 * ramp * memAlpha) < 1e-9, `inner glow alpha == 0.35 × ramp × memAlpha (${inner[0].globalAlpha})`);
  assert.ok(Math.abs(outer[0].globalAlpha - 0.18 * ramp * memAlpha) < 1e-9, `outer glow alpha == 0.18 × ramp × memAlpha (${outer[0].globalAlpha})`);
  assert.equal(outer[0].strokeStyle, PALETTE.playhead, 'outer glow is playhead gold');
  assert.equal(inner[0].strokeStyle, PALETTE.playhead, 'inner glow is playhead gold');
  assert.equal(core[0].strokeStyle, PALETTE.playhead, 'core is playhead gold');
  // Layer order: outer glow first, core last (glow renders under the core).
  const allStrokes = callsOf(ctx, 'stroke');
  const beamIdx = allStrokes.map((s, i) => ([18, 11, 6].includes(s.lineWidth) && s.strokeStyle === PALETTE.playhead ? i : -1)).filter((i) => i >= 0);
  assert.equal(beamIdx.length, 3, 'three beam strokes total');
  assert.equal(allStrokes[beamIdx[0]].lineWidth, 18, 'outer glow painted first');
  assert.equal(allStrokes[beamIdx[1]].lineWidth, 11, 'inner glow painted second');
  assert.equal(allStrokes[beamIdx[2]].lineWidth, 6, 'core painted last');
  // Geometry: each layer is a single quadratic path starting at the source tile.
  const beamMoves = callsOf(ctx, 'moveTo').filter((m) => m.args[0] === layout.tiles[1].x && m.args[1] === layout.tiles[1].y);
  assert.equal(beamMoves.length, 3, 'three beam paths start at the source tile');
  const beamLineTos = callsOf(ctx, 'lineTo').filter((l) => l.strokeStyle === PALETTE.playhead);
  assert.equal(beamLineTos.length, 0, 'beam layers are pure quadratics (no lineTos)');
  const quads = callsOf(ctx, 'quadraticCurveTo');
  assert.equal(quads.length, 3, 'one quadratic per beam layer');
  // No dimmed chord underneath during the beam window.
  assert.equal(chordStrokes(ctx).length, 0, 'persistent chord skipped during the beam window');
  // Determinism: the beam has no randomness — a repaint in the same window
  // shares identical quadratic geometry.
  const ctx2 = paint(beats, layout, { currentBeat: beats[9], jumps, beatCount: 8, nowSec: 5.1 });
  const first = callsOf(ctx, 'quadraticCurveTo').map((q) => q.args);
  const second = callsOf(ctx2, 'quadraticCurveTo').map((q) => q.args);
  assert.deepEqual(first, second, 'beam geometry is stable across repaints');
  // Linear ramp: later in the window ⇒ proportionally dimmer core, same geometry.
  const ctx3 = paint(beats, layout, { currentBeat: beats[9], jumps, beatCount: 8, nowSec: 5.15 });
  const ramp2 = 0.25;
  const core3 = beamStrokes(ctx3, 6);
  assert.ok(Math.abs(core3[0].globalAlpha - 1.0 * ramp2 * memAlpha) < 1e-9, `core alpha at age 0.15 == 1.0 × 0.25 × memAlpha (${core3[0].globalAlpha})`);
  assert.deepEqual(callsOf(ctx3, 'quadraticCurveTo').map((q) => q.args), second, 'beam geometry unchanged at a different ramp');
}

{ // No beam at ≥ 0.2s.
  const beats = Array.from({ length: 12 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 400, height: 400, margin: 20 });
  const jumps = [{ count: 1, from: beats[1], to: beats[9], fromIndex: 1, toIndex: 9, eventTSec: 5, eventBeatCount: 0 }];
  const ctx = paint(beats, layout, { currentBeat: beats[9], jumps, nowSec: 5.2 });
  assert.equal(beamStrokes(ctx, BEAM_GLOW_WIDTHS[0]).length, 0, 'no outer glow at the beam boundary');
  assert.equal(beamStrokes(ctx, BEAM_GLOW_WIDTHS[1]).length, 0, 'no inner glow at the beam boundary');
  assert.equal(beamStrokes(ctx, BEAM_CORE_WIDTH).length, 0, 'no core at the beam boundary');
  // The persistent chord IS present after the beam powers down.
  assert.equal(chordStrokes(ctx).length, 1, 'chord strokes after the beam window');
  // Future-dated event (not yet arrived): no beam either.
  const futureCtx = paint(beats, layout, { currentBeat: beats[9], jumps, nowSec: 4.9 });
  assert.equal(beamStrokes(futureCtx, BEAM_GLOW_WIDTHS[0]).length, 0, 'no beam before the event time');
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
    jumps: [{ count: 1, from: beats[4], to: beats[8], fromIndex: 4, toIndex: 8, eventTSec: 5, eventBeatCount: 0 }],
    beatCount: 32, nowSec: 6,
  });
  assert.equal(chordStrokes(gone).length, 0, 'alpha 0 at ≥32 ⇒ no stroke at all');
}

{ // REGRESSION (phantom re-light): a jump 32+ beats OLD must NOT re-draw when
  // the playhead wraps around and sits exactly ON its source tile. The old
  // playhead-anchored formula ((currentIndex − fromIndex) % N) measured 0
  // there and re-lit the arc at full alpha every lap of the ring.
  const beats = Array.from({ length: 48 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 800, height: 800, margin: 32 });
  // Jump fired at beat tick 2 (playhead was ON tile 4); 40 beats elapsed.
  const jumps = [{ count: 1, from: beats[4], to: beats[8], fromIndex: 4, toIndex: 8, eventTSec: 5, eventBeatCount: 2 }];
  const ctx = paint(beats, layout, {
    currentBeat: beats[4], currentIndex: 4, jumps, beatCount: 42, nowSec: 6,
  });
  assert.equal(chordStrokes(ctx).length, 0, 'old jump on its source tile ⇒ no phantom chord');
  // Sanity: the same jump a few beats after arrival still draws (past the
  // 0.2s beam window, so the persistent chord strokes).
  const fresh = paint(beats, layout, {
    currentBeat: beats[4], currentIndex: 4, jumps, beatCount: 3, nowSec: 5.5,
  });
  assert.equal(chordStrokes(fresh).length, 1, 'fresh jump draws its chord');
}

{ // Monotone decreasing across the schedule.
  const beats = Array.from({ length: 48 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 800, height: 800, margin: 32 });
  const alphas = [];
  for (let b = 0; b < 31; b++) {
    // Jump fired at beat tick 0; the beat-tick counter walks forward.
    const jumps = [{ count: 1, from: beats[4], to: beats[8], fromIndex: 4, toIndex: 8, eventTSec: 5, eventBeatCount: 0 }];
    const ctx = paint(beats, layout, { currentBeat: null, currentIndex: (4 + b) % 48, jumps, beatCount: b, nowSec: 6 });
    alphas.push(chordStrokes(ctx)[0].globalAlpha);
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
  const chords = chordStrokes(ctx);
  const expected = 1 - 0.85 * (10 / MEMORY_BEATS); // 0.46875
  assert.ok(Math.abs(chords[0].globalAlpha - expected) < 0.002, `10 beats elapsed ⇒ ${expected} (${chords[0].globalAlpha})`);
}

{ // Exactly 0.15 at the 16 boundary + no-arc edge cases + reduced motion.
  const beats = Array.from({ length: 48 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 800, height: 800, margin: 32 });
  const jumps = [{ count: 1, from: beats[0], to: beats[16], fromIndex: 0, toIndex: 16, eventTSec: 5, eventBeatCount: 0 }];
  const ctx = paint(beats, layout, { currentIndex: 16, jumps, beatCount: 16, nowSec: 6 });
  const chords = chordStrokes(ctx);
  assert.ok(Math.abs(chords[0].globalAlpha - 0.15) < 1e-9, `exactly 0.15 at beatsSince 16 (${chords[0].globalAlpha})`);

  // Missing indices (unresolvable jumps): no stroke, no throw.
  const broken = paint(beats, layout, {
    currentBeat: beats[16], currentIndex: 16,
    jumps: [{ count: 1, from: beats[0], to: beats[4], fromIndex: 200, toIndex: 16, eventTSec: 5, eventBeatCount: 0 }], nowSec: 6,
  });
  assert.equal(chordStrokes(broken).length, 0, 'missing tile ⇒ no arc');

  // Reduced motion: no arcs, no beam at all.
  const rmCtx = paint(beats, layout, {
    currentBeat: beats[16], currentIndex: 16, jumps,
    reducedMotion: true, nowSec: 5.05,
  });
  assert.equal(chordStrokes(rmCtx).length, 0, 'reduced motion suppresses chords');
  assert.equal(beamStrokes(rmCtx, BEAM_GLOW_WIDTHS[0]).length, 0, 'reduced motion suppresses outer glow');
  assert.equal(beamStrokes(rmCtx, BEAM_GLOW_WIDTHS[1]).length, 0, 'reduced motion suppresses inner glow');
  assert.equal(beamStrokes(rmCtx, BEAM_CORE_WIDTH).length, 0, 'reduced motion suppresses beam core');
}

{ // Sequential playback only (no jump): zero arcs, zero beams.
  const beats = Array.from({ length: 12 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 400, height: 400, margin: 20 });
  const ctx = paint(beats, layout, { currentBeat: beats[4], currentIndex: 4, jumps: [], nowSec: 2 });
  assert.equal(chordStrokes(ctx).length, 0, 'no chord strokes without a jump');
  assert.equal(beamStrokes(ctx, BEAM_GLOW_WIDTHS[0]).length, 0, 'no beams without a jump');
  assert.equal(beamStrokes(ctx, BEAM_GLOW_WIDTHS[1]).length, 0, 'no beams without a jump');
  assert.equal(beamStrokes(ctx, BEAM_CORE_WIDTH).length, 0, 'no beams without a jump');
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
  const chords = chordStrokes(ctx);
  assert.equal(chords.length, 2, 'two chords, one per jump');
  const a0 = 1 - 0.85 * (7 / 16);
  const a1 = 1 - 0.85 * (2 / 16);
  assert.ok(Math.abs(chords[0].globalAlpha - a0) < 0.002, `jump 1 alpha == ${a0} (${chords[0].globalAlpha})`);
  assert.ok(Math.abs(chords[1].globalAlpha - a1) < 0.002, `jump 2 alpha == ${a1} (${chords[1].globalAlpha})`);
  assert.ok(chords[1].globalAlpha > chords[0].globalAlpha, `jump 2 ${chords[1].globalAlpha} brighter than jump 1 ${chords[0].globalAlpha}`);
}

console.log('arcs.test.mjs OK');