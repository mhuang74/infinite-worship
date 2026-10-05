/**
 * Tiles + palette tests (issue #40 + v2 step 1): cluster→jewel mapping
 * (round-robin, same palette the waveform's jewel bar uses), tile paint
 * commands, current tile highlight with decaying glow, glow-dot playhead
 * (halo marker + core, midline position, no center ray).
 */
import assert from 'node:assert/strict';
import { compileTs, FakeCtx, callsOf } from './harness.mjs';

const drawUrl = compileTs('src/lib/zen/draw.ts');
const { LAYOUT_RING, JEWEL_COLOR_FOR_CLUSTER, PAINT_FRAME, FADE_SECONDS, GLOW_DOT_POSITION, TILE_DIAMETER_FOR } = await import(drawUrl);

const PALETTE = {
  jewels: ['#ff8a80', '#fdb515', '#7bd5a8', '#8ab8ff', '#cfa9f5', '#7fdce8'],
  background: '#0e141c',
};

function makeBeat(id, cluster) {
  return { id, start: id * 0.5, duration: 0.5, cluster, segment: 0, jump_candidates: [] };
}

{ // Cluster index → palette: round-robin across the six jewels, wrap-safe.
  const clusters = [0, 1, 2, 3, 4, 5, 6, 11, -1, 42];
  const expected = [
    '#ff8a80', '#fdb515', '#7bd5a8', '#8ab8ff', '#cfa9f5', '#7fdce8',
    '#ff8a80', '#7fdce8', // 6 → 0, 11 → 5 (11 % 6)
    '#7fdce8', // -1 wraps to last
    '#ff8a80', // 42 → 42 % 6 = 0
  ];
  clusters.forEach((cluster, i) => {
    assert.equal(JEWEL_COLOR_FOR_CLUSTER(cluster, PALETTE), expected[i], `cluster ${cluster}`);
  });
}

{ // Layout mode pin: 400×400 margin 20 ⇒ r0 = 140 < 200 ⇒ inward mode —
  // play count encodes as band alpha + lightness here (no rib arcs); the
  // full schedule is pinned in brightness.test.mjs.
  const layout = LAYOUT_RING([makeBeat(0, 0)], { width: 400, height: 400, margin: 20 });
  assert.equal(layout.mode, 'inward', 'small layout renders in inward mode');
}

{ // Every tile is painted as an annulus band arc on the ring; color follows
  // its beat cluster (annulus-band seam, review R6).
  const beats = [makeBeat(0, 2), makeBeat(1, 0), makeBeat(2, 5)];
  const layout = LAYOUT_RING(beats, { width: 400, height: 400, margin: 20 });
  const ctx = new FakeCtx({ width: 400, height: 400 });
  PAINT_FRAME(
    {
      beats, layout, palette: PALETTE, currentBeat: null, currentBeatIndex: -1, beatCount: 0,
      jumps: [], reducedMotion: false, nowSec: 0, currentBeatGlowTSec: null,
    },
    ctx,
  );
  const arcs = callsOf(ctx, 'arc');
  assert.equal(arcs.length, 3, 'one band arc per beat');
  arcs.forEach((c, i) => {
    assert.equal(c.args[0], layout.center.x, `band ${i} centered on ring x`);
    assert.equal(c.args[1], layout.center.y, `band ${i} centered on ring y`);
    assert.equal(c.args[2], layout.radius, `band ${i} rides the ring radius`);
  });
  // Band colors follow cluster order.
  assert.deepEqual(arcs.map((c) => c.strokeStyle), [
    JEWEL_COLOR_FOR_CLUSTER(2, PALETTE),
    JEWEL_COLOR_FOR_CLUSTER(0, PALETTE),
    JEWEL_COLOR_FOR_CLUSTER(5, PALETTE),
  ]);
  // Each band spans its angular slot (minus the gap), starting 12 o'clock.
  const first = arcs[0];
  const slot = (Math.PI * 2) / 3;
  assert.ok(Math.abs((first.args[3] - (-Math.PI / 2)) - 0.02) < 0.05, `band 0 starts at the slot: ${first.args[3]}`);
  assert.ok(Math.abs((first.args[4] - first.args[3]) - (slot - 0.04)) < 0.05, `band 0 spans its slot: ${first.args[4] - first.args[3]}`);
}

{ // Current tile: thicker band, and glows — alpha decays over FADE_SECONDS.
  const beats = Array.from({ length: 8 }, (_, i) => makeBeat(i, i % 6));
  const layout = LAYOUT_RING(beats, { width: 400, height: 400, margin: 20 });
  const frame = (nowSec, glowT) => {
    const ctx = new FakeCtx({ width: 400, height: 400 });
    PAINT_FRAME(
      {
        beats, layout, palette: PALETTE,
        currentBeat: beats[3], currentBeatIndex: 3, beatCount: 1, jumps: [], reducedMotion: false, nowSec,
        currentBeatGlowTSec: glowT,
      },
      ctx,
    );
    return ctx;
  };

  const fresh = frame(10, 10); // glow at its peak
  const later = frame(10, 10 - FADE_SECONDS / 2); // decayed halfway
  const spent = frame(10, 10 - FADE_SECONDS * 2); // fully decayed

  const currentArc = (ctx) => callsOf(ctx, 'arc')[3]; // fourth tile is current
  const freshW = currentArc(fresh).lineWidth;
  const laterW = currentArc(later).lineWidth;
  assert.equal(freshW, laterW, 'glow scales once per beat, not per decay time');
  assert.ok(freshW > callsOf(fresh, 'arc')[0].lineWidth, 'current band is thicker vs others');

  const freshA = currentArc(fresh).globalAlpha;
  const laterA = currentArc(later).globalAlpha;
  const spentA = currentArc(spent).globalAlpha;
  assert.ok(freshA > laterA, `fresh alpha ${freshA} should exceed decayed ${laterA}`);
  assert.ok(laterA > spentA, `decayed ${laterA} should exceed spent ${spentA}`);
  assert.equal(spentA, 0.55, 'spent glow settles at the tile base alpha');
}

{ // Glow-dot playhead (v2 halo-marker fallback): halo ring marker stroke at
  // band*2.5 radius + solid core fill at band*0.7, both the CURRENT beat's
  // jewel color.
  const beats = Array.from({ length: 8 }, (_, i) => makeBeat(i, 0));
  const layout = LAYOUT_RING(beats, { width: 400, height: 400, margin: 20 });
  const band = TILE_DIAMETER_FOR(beats.length, layout.radius);
  const dotColor = JEWEL_COLOR_FOR_CLUSTER(beats[5].cluster, PALETTE); // cluster 0
  const ctx = new FakeCtx({ width: 400, height: 400 });
  PAINT_FRAME(
    { beats, layout, palette: PALETTE, currentBeat: beats[5], currentBeatIndex: 5, beatCount: 1, jumps: [], reducedMotion: false, nowSec: 0, currentBeatGlowTSec: null },
    ctx,
  );
  const haloMarkers = callsOf(ctx, 'stroke').filter((s) => s.lineWidth === 2 && s.strokeStyle === dotColor);
  assert.equal(haloMarkers.length, 1, 'exactly one halo marker stroke');
  const haloArcs = callsOf(ctx, 'arc').filter((a) => Math.abs(a.args[2] - band * 2.5) < 1e-9);
  assert.equal(haloArcs.length, 1, `halo arc radius == band*2.5 (${band * 2.5})`);
  const coreFills = callsOf(ctx, 'fill').filter((f) => f.fillStyle === dotColor);
  assert.equal(coreFills.length, 1, 'core disk fill uses the current beat jewel color');
  const coreArcs = callsOf(ctx, 'arc').filter((a) => Math.abs(a.args[2] - band * 0.7) < 1e-9);
  assert.equal(coreArcs.length, 1, `core arc radius == band*0.7 (${band * 0.7})`);
  // Dot sits on the current tile's radial at the band midline.
  const dot = GLOW_DOT_POSITION(layout, band, 0, layout.tiles[5]);
  for (const a of [...haloArcs, ...coreArcs]) {
    assert.equal(a.args[0], dot.x, 'dot arc centered on midline x');
    assert.equal(a.args[1], dot.y, 'dot arc centered on midline y');
  }
}

{ // No center ray anywhere (v2): no path segment may start at the viewport
  // center; sweep/stem is gone.
  const beats = Array.from({ length: 8 }, (_, i) => makeBeat(i, 0));
  const layout = LAYOUT_RING(beats, { width: 400, height: 400, margin: 20 });
  const ctx = new FakeCtx({ width: 400, height: 400 });
  PAINT_FRAME(
    { beats, layout, palette: PALETTE, currentBeat: beats[5], currentBeatIndex: 5, beatCount: 1, jumps: [], reducedMotion: false, nowSec: 0, currentBeatGlowTSec: null },
    ctx,
  );
  const centerMoveTos = callsOf(ctx, 'moveTo').filter((m) => m.args[0] === layout.center.x && m.args[1] === layout.center.y);
  assert.equal(centerMoveTos.length, 0, 'no moveTo at the center (no sweep stem)');
  const centerLineTos = callsOf(ctx, 'lineTo').filter((l) => l.args[0] === layout.center.x && l.args[1] === layout.center.y);
  assert.equal(centerLineTos.length, 0, 'no lineTo at the center');
  // No stroked path carries a center-origin ray: every moveTo at the center
  // would be a stem — there are none (first check above).
}

{ // No dot before the first beat callback: no halo marker, no core fill.
  const beats = Array.from({ length: 8 }, (_, i) => makeBeat(i, 0));
  const layout = LAYOUT_RING(beats, { width: 400, height: 400, margin: 20 });
  const ctx = new FakeCtx({ width: 400, height: 400 });
  PAINT_FRAME(
    { beats, layout, palette: PALETTE, currentBeat: null, currentBeatIndex: -1, beatCount: 0, jumps: [], reducedMotion: false, nowSec: 0, currentBeatGlowTSec: null },
    ctx,
  );
  const fallbackColor = JEWEL_COLOR_FOR_CLUSTER(0, PALETTE); // first-jewel fallback
  const fills = callsOf(ctx, 'fill').filter((f) => f.fillStyle === fallbackColor);
  const markerStrokes = callsOf(ctx, 'stroke').filter((s) => s.strokeStyle === fallbackColor && s.lineWidth === 2);
  assert.equal(fills.length, 0, 'no core fill before a beat');
  assert.equal(markerStrokes.length, 0, 'no halo marker before a beat');
}

{ // Halo radius scales with the band (band*2.5 relation at two beat counts).
  for (const count of [96, 450]) {
    const beats = Array.from({ length: count }, (_, i) => makeBeat(i, 0));
    const layout = LAYOUT_RING(beats, { width: 800, height: 800, margin: 32 });
    const band = TILE_DIAMETER_FOR(count, layout.radius);
    const ctx = new FakeCtx({ width: 800, height: 800 });
    PAINT_FRAME(
      { beats, layout, palette: PALETTE, currentBeat: beats[10], currentBeatIndex: 10, beatCount: 1, jumps: [], reducedMotion: false, nowSec: 0, currentBeatGlowTSec: null },
      ctx,
    );
    const haloArcs = callsOf(ctx, 'arc').filter((a) => Math.abs(a.args[2] - band * 2.5) < 1e-9);
    assert.equal(haloArcs.length, 1, `count ${count}: halo radius tracks band*2.5 (${band * 2.5})`);
  }
}

{ // Midline position: dot is beyond the base midline when the beat has grown
  // (growth/2 shift); below band/2 = 22 the min() cap keeps DOT_BASE_OFFSET.
  const beats = Array.from({ length: 8 }, (_, i) => makeBeat(i, 0));
  const layout = LAYOUT_RING(beats, { width: 800, height: 800, margin: 32 });
  const band = TILE_DIAMETER_FOR(beats.length, layout.radius);
  const base = GLOW_DOT_POSITION(layout, band, 0, layout.tiles[0]);
  const grown = GLOW_DOT_POSITION(layout, band, 18, layout.tiles[0]);
  assert.ok(Math.abs((grown.x - base.x) + (grown.y - base.y)) > 0, 'growth shifts the dot outward');
}

{ // Reduced motion: current band still highlighted statically (thicker, full
  // alpha) — no decaying pulse.
  const beats = Array.from({ length: 8 }, (_, i) => makeBeat(i, 1));
  const layout = LAYOUT_RING(beats, { width: 400, height: 400, margin: 20 });
  const frame = (nowSec) => {
    const ctx = new FakeCtx({ width: 400, height: 400 });
    PAINT_FRAME(
      { beats, layout, palette: PALETTE, currentBeat: beats[2], currentBeatIndex: 2, beatCount: 1, jumps: [], reducedMotion: true, nowSec, currentBeatGlowTSec: nowSec - 5 },
      ctx,
    );
    return ctx;
  };
  const early = frame(20);
  const later = frame(25);
  const current = (ctx) => callsOf(ctx, 'arc')[2];
  const ea = current(early);
  const la = current(later);
  assert.equal(ea.lineWidth, la.lineWidth, 'static highlight thickness under reduced motion');
  assert.equal(ea.globalAlpha, la.globalAlpha, 'no alpha decay under reduced motion');
  assert.ok(ea.lineWidth > callsOf(early, 'arc')[0].lineWidth, 'current band is still thicker');
}

console.log('tiles.test.mjs OK');