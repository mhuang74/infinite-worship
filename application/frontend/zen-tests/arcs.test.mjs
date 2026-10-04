/**
 * Jump arc tests (issue #41): one arc per jump through the center connecting
 * the source tile to the destination tile, fading ~1s; suppressed entirely
 * under reduced motion; no arcs for sequential playback (crossfade replays
 * beat ids but is not a jump — no arc, but the playhead follows).
 */
import assert from 'node:assert/strict';
import { compileTs, FakeCtx, callsOf } from './harness.mjs';

const drawUrl = compileTs('src/lib/zen/draw.ts');
const { LAYOUT_RING, PAINT_FRAME, FADE_SECONDS } = await import(drawUrl);

const PALETTE = {
  jewels: ['#ff8a80', '#fdb515', '#7bd5a8', '#8ab8ff', '#cfa9f5', '#7fdce8'],
  playhead: '#fdb515',
  background: '#0e141c',
};

function makeBeat(id) {
  return { id, start: id * 0.5, duration: 0.5, cluster: id % 6, segment: 0, jump_candidates: [] };
}

function paint(beats, layout, { currentBeat, jumps, reducedMotion = false, nowSec = 0, glowT = null } = {}) {
  const ctx = new FakeCtx({ width: 400, height: 400 });
  PAINT_FRAME(
    { beats, layout, palette: PALETTE, currentBeat: currentBeat ?? null, jumps, reducedMotion, nowSec, currentBeatGlowTSec: glowT },
    ctx,
  );
  return ctx;
}

{ // One jump → exactly one arc: polyline from source tile, through center,
  // to destination tile (exact endpoints per the widened #39 callback).
  const beats = Array.from({ length: 12 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 400, height: 400, margin: 20 });
  const jumps = [{ count: 1, from: beats[1], to: beats[9], fromIndex: 1, toIndex: 9, eventTSec: 5 }];
  const ctx = paint(beats, layout, { currentBeat: beats[9], jumps, nowSec: 5.1, glowT: 5 });

  const strokes = callsOf(ctx, 'stroke');
  // Jump arcs are 3px polylines tile→center→tile; annulus bands are arcs with
  // 4px+ width — distinguish by geometry (moveTo at the source tile), not width.
  const arcStrokes = strokes.filter((s) => s.lineWidth === 3);
  assert.equal(arcStrokes.length, 1, `exactly one arc stroke, got ${arcStrokes.length}`);
  const arcSegs = callsOf(ctx, 'moveTo').filter((m) => m.args[0] === layout.tiles[1].x && m.args[1] === layout.tiles[1].y);
  assert.equal(arcSegs.length, 1, 'arc starts at the source tile');
  const centerHits = callsOf(ctx, 'lineTo').filter((l) => l.args[0] === layout.center.x && l.args[1] === layout.center.y);
  assert.equal(centerHits.length, 1, 'arc passes through the center');
  const toSegs = callsOf(ctx, 'lineTo').filter((l) => l.args[0] === layout.tiles[9].x && l.args[1] === layout.tiles[9].y);
  assert.equal(toSegs.length, 1, 'arc ends at the destination tile');
  assert.ok(
    Math.abs(arcSegs[0].globalAlpha - (1 - 0.1 / FADE_SECONDS)) < 1e-9,
    `arc alpha follows the decay (${arcSegs[0].globalAlpha})`,
  );
}

{ // Arc fades within ~1s: invisible by FADE_SECONDS.
  const beats = Array.from({ length: 12 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 400, height: 400, margin: 20 });
  const jumps = [{ count: 1, from: beats[0], to: beats[7], fromIndex: 0, toIndex: 7, eventTSec: 3 }];
  const lateCtx = paint(beats, layout, { currentBeat: beats[7], jumps, nowSec: 3 + FADE_SECONDS + 0.01, glowT: 3 });
  const arcStrokes = callsOf(lateCtx, 'stroke').filter((s) => s.lineWidth === 3);
  assert.equal(arcStrokes.length, 0, 'no arc stroke survives the fade window');
}

{ // Sequential playback only (no jump): zero arcs.
  const beats = Array.from({ length: 12 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 400, height: 400, margin: 20 });
  const ctx = paint(beats, layout, { currentBeat: beats[4], jumps: [], nowSec: 2, glowT: 2 });
  // No jump ⇒ no 3px arc polyline; the only stroke is a band arc + the sweep.
  const strokes = callsOf(ctx, 'stroke');
  assert.equal(strokes.filter((s) => s.lineWidth === 3).length, 0, 'no arc strokes without a jump');
  assert.ok(strokes.length >= 2, 'band arcs + sweep stroke');
}

{ // Rapid successive jumps: each gets its own arc, both still fading.
  const beats = Array.from({ length: 12 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 400, height: 400, margin: 20 });
  const jumps = [
    { count: 1, from: beats[0], to: beats[6], fromIndex: 0, toIndex: 6, eventTSec: 5 },
    { count: 2, from: beats[6], to: beats[2], fromIndex: 6, toIndex: 2, eventTSec: 5.2 },
  ];
  const ctx = paint(beats, layout, { currentBeat: beats[2], jumps, nowSec: 5.3, glowT: 5.2 });
  const arcStrokes = callsOf(ctx, 'stroke').filter((s) => s.lineWidth === 3);
  assert.equal(arcStrokes.length, 2, 'two overlapping arcs, one per jump');
  const alphas = arcStrokes.map((s) => s.globalAlpha);
  assert.ok(alphas[0] > 0 && alphas[0] < alphas[1], `older arc ${alphas[0]} fades ahead of newer ${alphas[1]}`);
}

{ // Reduced motion: no arcs at all; the playhead re-aim is the only signal.
  const beats = Array.from({ length: 12 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 400, height: 400, margin: 20 });
  const jumps = [{ count: 1, from: beats[0], to: beats[8], fromIndex: 0, toIndex: 8, eventTSec: 4 }];
  const ctx = paint(beats, layout, { currentBeat: beats[8], jumps, reducedMotion: true, nowSec: 4.05, glowT: 4 });
  // Arc polylines start with a moveTo at the SOURCE tile; bands never moveTo.
  const arcPolylines = callsOf(ctx, 'moveTo').filter((m) => m.args[0] === layout.tiles[0].x && m.args[1] === layout.tiles[0].y);
  assert.equal(arcPolylines.length, 0, 'reduced motion suppresses arcs');
  const sweeps = callsOf(ctx, 'stroke').filter((s) => s.strokeStyle === PALETTE.playhead && s.lineWidth === 2);
  assert.equal(sweeps.length, 1, 'playhead sweep still aims');
}

console.log('arcs.test.mjs OK');