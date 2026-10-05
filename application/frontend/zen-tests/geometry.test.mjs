/**
 * Geometry tests (issue #40 + v2 step 3): ring of beat tiles, sequential
 * placement; radius = radius fraction × min(viewport side), the fraction
 * ramping 0.35 → 0.42 over minSide 820 → 920 (rib width ramps 3 → 7px over
 * the same range), clamped [MIN_RING_RADIUS, box/2 − band-headroom] with
 * ceiling>floor>fraction precedence; band floor 6px, ceiling 44px, slot cap
 * ×0.72.
 *
 * Angles: beat 0 at 12 o'clock, proceeding clockwise; exactly one tile per
 * beat of the Analysis, evenly spaced around the ring.
 */
import assert from 'node:assert/strict';
import { compileTs } from './harness.mjs';

const drawUrl = compileTs('src/lib/zen/draw.ts');
const { LAYOUT_RING, TILE_DIAMETER_FOR } = await import(drawUrl);

const TAU = Math.PI * 2;
// Angle convention: 12 o'clock is -π/2 in canvas space (x right, y down), and
// clockwise = increasing angle. Independent spec-derived truth, not the code's
// arithmetic path.
const START_ANGLE = -Math.PI / 2;

function makeBeat(id) {
  return { id, start: id * 0.5, duration: 0.5, cluster: 0, segment: 0, jump_candidates: [] };
}

{ // 4 beats: exactly 4 tiles at the four cardinal compass points, clockwise.
  const layout = LAYOUT_RING([makeBeat(0), makeBeat(1), makeBeat(2), makeBeat(3)], { width: 200, height: 200, margin: 12 });
  const cx = 100, cy = 100, radius = layout.radius;
  assert.equal(layout.tiles.length, 4);
  assert.equal(layout.center.x, cx);
  assert.equal(layout.center.y, cy);
  assert.ok(radius > 0 && radius < 100, `radius ${radius} outside the 200px square`);

  const expected = [
    { angle: START_ANGLE, x: cx, y: cy - radius },
    { angle: 0, x: cx + radius, y: cy },
    { angle: Math.PI / 2, x: cx, y: cy + radius },
    { angle: Math.PI, x: cx - radius, y: cy },
  ];
  layout.tiles.forEach((tile, i) => {
    assert.ok(Math.abs(tile.angle - expected[i].angle) < 1e-9, `tile ${i} angle ${tile.angle} ≠ ${expected[i].angle}`);
    assert.ok(Math.abs(tile.x - expected[i].x) < 1e-9, `tile ${i} x ${tile.x} ≠ ${expected[i].x}`);
    assert.ok(Math.abs(tile.y - expected[i].y) < 1e-9, `tile ${i} y ${tile.y} ≠ ${expected[i].y}`);
  });
}

{ // 9 beats: wrap-around stays sequential and even (spacing 2π/9).
  const beats = Array.from({ length: 9 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 400, height: 400, margin: 20 });
  const spacing = TAU / 9;
  layout.tiles.forEach((tile, i) => {
    const expected = START_ANGLE + i * spacing;
    const delta = Math.abs(((tile.angle - expected) % TAU + TAU) % TAU);
    assert.ok(delta < 1e-9, `tile ${i} angle off: ${tile.angle} vs ${expected} (delta ${delta})`);
  });
}

{ // v2 radius rule: radius == radius fraction × min(vw, vh) when unclamped.
  // 800×800 margin 32 ⇒ min side 800 is below the 820 ramp start ⇒ fraction
  // 0.35: 0.35 × 800 = 280 (spec's approved reference point); headroom is
  // just the band's outer half (22), so 280 ≤ 400 − 22.
  const layout = LAYOUT_RING([makeBeat(0)], { width: 800, height: 800, margin: 32 });
  assert.ok(Math.abs(layout.radius - 280) < 1e-9, `radius ${layout.radius} == 280 at 800×800`);
}

{ // Min-side rule: same radius for a portrait and a landscape viewport of
  // the same two sides (ring stays circular, centered, no reflow). At 390
  // min side margin 0: below the 820 ramp start ⇒ fraction 0.35, r0 = 136.5
  // (headroom 22 = band ceiling half only), and 136.5 ≤ 195 − 22 = 173 so
  // the fraction wins: radius 136.5.
  const portrait = LAYOUT_RING(Array.from({ length: 5 }, (_, i) => makeBeat(i)), { width: 390, height: 844, margin: 0 });
  const landscape = LAYOUT_RING(Array.from({ length: 5 }, (_, i) => makeBeat(i)), { width: 844, height: 390, margin: 0 });
  assert.equal(portrait.radius, landscape.radius, 'min-side rule: identical radii');
  assert.ok(Math.abs(portrait.radius - 136.5) < 1e-9, `radius == 0.35 × 390 = 136.5 (${portrait.radius})`);
  assert.equal(portrait.center.x, 390 / 2);
  assert.equal(portrait.center.y, 844 / 2);
  assert.equal(landscape.center.x, 844 / 2);
  assert.equal(landscape.center.y, 390 / 2);
  assert.ok(portrait.radius + 22 <= 390 / 2, 'ring + band headroom stays inside the min side');
}

{ // Precedence: ceiling wins over floor, floor wins over fraction. At
  // 100×100 margin 0: r0 = max(35, 64) = 64 (floor wins over fraction),
  // headroom 22 ⇒ ceiling 50 − 22 = 28 < 64 ⇒ radius 28.
  const tiny = LAYOUT_RING([makeBeat(0)], { width: 100, height: 100, margin: 0 });
  assert.ok(Math.abs(tiny.radius - 28) < 1e-9, `ceiling beats floor: radius ${tiny.radius} == 28`);
}

{ // Desktop ramp: minSide ≥ 920 ⇒ fraction 0.42; minSide ≥ 920 ⇒ 7px ribs;
  // mid-ramp values are the linear interpolation (870 ⇒ t 0.5).
  const desktop = LAYOUT_RING([makeBeat(0)], { width: 1080, height: 1080, margin: 32 });
  assert.ok(Math.abs(desktop.radius - 453.6) < 1e-9, `radius == 0.42 × 1080 = 453.6 (${desktop.radius})`);
  assert.ok(Math.abs(desktop.ribWidth - 7) < 1e-9, `ribWidth == 7 at min side 1080 (${desktop.ribWidth})`);
  const at920 = LAYOUT_RING([makeBeat(0)], { width: 920, height: 1000, margin: 32 });
  assert.ok(Math.abs(at920.radius - 386.4) < 1e-9, `radius == 0.42 × 920 = 386.4 (${at920.radius})`);
  assert.ok(Math.abs(at920.ribWidth - 7) < 1e-9, `ribWidth == 7 at min side 920 (${at920.ribWidth})`);
  const mid = LAYOUT_RING([makeBeat(0)], { width: 870, height: 1000, margin: 32 });
  assert.ok(Math.abs(mid.radius - 334.95) < 1e-9, `radius == 0.385 × 870 = 334.95 (${mid.radius})`);
  assert.ok(Math.abs(mid.ribWidth - 5) < 1e-9, `ribWidth == 5 at min side 870 (${mid.ribWidth})`);
  const below = LAYOUT_RING([makeBeat(0)], { width: 800, height: 1000, margin: 32 });
  assert.ok(Math.abs(below.ribWidth - 3) < 1e-9, `ribWidth == 3 at min side 800 (${below.ribWidth})`);
}

{ // Breakpoint continuity: sweep minSide 780..960 (margin 32) across the
  // 820→920 ramp — radius monotone non-decreasing with sub-pixel steps (no
  // pop when resizing across the CSS breakpoint), and the sweep crosses the
  // full ribWidth 3 → 7 ramp.
  let prev = null;
  let saw3 = false;
  let saw7 = false;
  for (let side = 780; side <= 960; side += 1) {
    const layout = LAYOUT_RING([makeBeat(0)], { width: side, height: side, margin: 32 });
    if (prev !== null) {
      assert.ok(layout.radius >= prev.radius - 1e-9, `side ${side}: radius ${layout.radius} monotone (prev ${prev.radius})`);
      // Max slope inside the ramp: radius = (0.35 + 0.07·(s−820)/100)·s, whose
      // derivative peaks ≈ 1.1 px/side at s=960 — the < 1px bound would pin
      // the pre-ramp region only.
      assert.ok(layout.radius - prev.radius < 1.2, `side ${side}: step ${layout.radius - prev.radius} < 1.2px`);
    }
    if (layout.ribWidth === 3) saw3 = true;
    if (layout.ribWidth === 7) saw7 = true;
    prev = layout;
  }
  assert.ok(saw3 && saw7, 'sweep crossed the full ribWidth 3 → 7 ramp');
}

{ // Realistic beat counts (a 4-minute song ≈ 450-617 beats): band thickness
  // with the v2 bounds — floor 6px, ceiling 44px, slot cap ×0.72 kept. The
  // 900-beat case exceeds the slot cap because the floor binds (accepted
  // user tradeoff; pre-decided fallback: floor = min(6, slotArc)).
  for (const count of [12, 60, 450, 900]) {
    const layout = LAYOUT_RING(Array.from({ length: count }, (_, i) => makeBeat(i)), { width: 800, height: 800, margin: 32 });
    const slotArc = (TAU * layout.radius) / count; // circumferential slot width
    const thickness = TILE_DIAMETER_FOR(count, layout.radius);
    assert.ok(thickness >= 6, `count ${count}: band ${thickness} below the 6px floor`);
    assert.ok(
      thickness <= Math.max(6, slotArc * 1.5),
      `count ${count}: band ${thickness.toFixed(1)} too thick for slot ${slotArc.toFixed(1)}`,
    );
  }
  // Reference points at radius 280: 450 beats keep a visible band; sparse
  // songs approach the 44px ceiling.
  const sparse = TILE_DIAMETER_FOR(12, 280);
  assert.ok(Math.abs(sparse - 44) < 1e-9, `sparse ring reaches the 44px ceiling (${sparse})`);
  assert.ok(TILE_DIAMETER_FOR(450, 280) >= 6, '450-beat ring keeps a visible band');
  assert.ok(TILE_DIAMETER_FOR(900, 280) === 6, '900-beat ring sits at the 6px floor');
  assert.ok(
    Math.abs(TILE_DIAMETER_FOR(96, 280) - Math.min(44, ((TAU * 280) / 96) * 0.72)) < 1e-9,
    '96-beat band follows slot ×0.72',
  );
}

console.log('geometry.test.mjs OK');