/**
 * Geometry tests (issue #40): ring of beat tiles, sequential placement.
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

{ // Largest square that fits the viewport: radius ≤ half of min(vw, vh)
  // minus margin; ring stays centered (issue #40: min(vw, vh)).
  const layout = LAYOUT_RING([makeBeat(0)], { width: 400, height: 700, margin: 24 });
  assert.equal(layout.center.x, 200);
  assert.equal(layout.center.y, 350);
  assert.ok(layout.radius <= 176, `radius ${layout.radius} leaks past the square (max 176)`);
  assert.ok(layout.radius >= 140, `radius ${layout.radius} too small for a 376px square`);
}

{ // Portrait→landscape: ring stays circular and inside the viewport with no
  // reflow-special-casing; min dimension governs both (issue #40).
  const portrait = LAYOUT_RING(Array.from({ length: 5 }, (_, i) => makeBeat(i)), { width: 390, height: 844, margin: 20 });
  const landscape = LAYOUT_RING(Array.from({ length: 5 }, (_, i) => makeBeat(i)), { width: 844, height: 390, margin: 20 });
  assert.ok(portrait.radius <= 175 && landscape.radius <= 175);
  assert.equal(portrait.radius, landscape.radius);
}

{ // Realistic beat counts (a 4-minute song ≈ 450-617 beats): the ring must
  // stay READABLE — each beat's band occupies its angular slot as an annulus
  // segment. The band thickness never exceeds the slot's arc width (color
  // separation) and never drops below a visible ~2px; the current tile's
  // highlight exceeds base thickness so the playhead reads from across the
  // room (review finding R6, user stories 5/8/9, 6).
  for (const count of [12, 60, 450, 900]) {
    const layout = LAYOUT_RING(Array.from({ length: count }, (_, i) => makeBeat(i)), { width: 800, height: 800, margin: 24 });
    const slotArc = (TAU * layout.radius) / count; // circumferential slot width
    const thickness = TILE_DIAMETER_FOR(count, layout.radius);
    assert.ok(
      thickness <= Math.max(4.2, slotArc * 1.5),
      `count ${count}: band ${thickness.toFixed(1)} too thick for slot ${slotArc.toFixed(1)}`,
    );
    assert.ok(thickness >= 2, `count ${count}: band ${thickness} invisible`);
  }
}

console.log('geometry.test.mjs OK');