/**
 * Geometry tests (issue #40 + v2 step 3): ring of beat tiles, sequential
 * placement; radius = 0.35 × min(viewport side), clamped [MIN_RING_RADIUS,
 * box/2 − MAX_RING_HEADROOM] with ceiling>floor>fraction precedence; band
 * floor 6px, ceiling 44px, slot cap ×0.72.
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

{ // v2 radius rule: radius == 0.35 × min(vw, vh) when unclamped. 800×800
  // margin 32 ⇒ 0.35 × 800 = 280 (spec's approved reference point).
  const layout = LAYOUT_RING([makeBeat(0)], { width: 800, height: 800, margin: 32 });
  assert.ok(Math.abs(layout.radius - 280) < 1e-9, `radius ${layout.radius} == 280 at 800×800`);
}

{ // Min-side rule: same radius for a portrait and a landscape viewport of
  // the same two sides (ring stays circular, centered, no reflow). At 390
  // min side margin 0 the ceiling binds and caps the fraction
  // (box/2 − 67 = 195 − 67 = 128 < 0.35 × 390 = 136.5 ⇒ ceiling wins: 128).
  const portrait = LAYOUT_RING(Array.from({ length: 5 }, (_, i) => makeBeat(i)), { width: 390, height: 844, margin: 0 });
  const landscape = LAYOUT_RING(Array.from({ length: 5 }, (_, i) => makeBeat(i)), { width: 844, height: 390, margin: 0 });
  assert.equal(portrait.radius, landscape.radius, 'min-side rule: identical radii');
  assert.ok(Math.abs(portrait.radius - 128) < 1e-9, `radius == 195 − 67 = 128 (${portrait.radius})`);
  assert.equal(portrait.center.x, 390 / 2);
  assert.equal(portrait.center.y, 844 / 2);
  assert.equal(landscape.center.x, 844 / 2);
  assert.equal(landscape.center.y, 390 / 2);
  assert.ok(portrait.radius + 67 <= 390 / 2, 'ring + headroom stays inside the min side');
}

{ // Precedence: ceiling wins over floor, floor wins over fraction. At
  // 100×100 margin 0: box/2 − 67 = 50 − 67 = −17 (negative) < 64 floor ⇒
  // radius 10 (the degenerate guard wins; the ceiling went negative).
  const tiny = LAYOUT_RING([makeBeat(0)], { width: 100, height: 100, margin: 0 });
  assert.ok(Math.abs(tiny.radius - 10) < 1e-9, `ceiling beats floor: radius ${tiny.radius} == 10`);
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