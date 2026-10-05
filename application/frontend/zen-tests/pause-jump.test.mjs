/**
 * Zen pause/jump regression tests (tap-to-pause + double-tap-to-jump).
 *
 * Contract: the ZenMode overlay converts a client tap point back to the ring
 * tile index LAYOUT_RING placed there. These tests round-trip every tile of
 * real layouts through the exact conversion the component performs —
 * screen-space (x, y) → atan2 → un-rotate by START_ANGLE → normalize →
 * nearest slot — plus the ring-band inner/outer hit boundaries with the
 * ±BAND_FUDGE_PX forgiveness.
 *
 * The conversion lives in ZenMode.tsx (React/DOM-bound); it is replicated
 * here verbatim as the spec-derived truth — if the component's math drifts
 * from this, the live double-tap jumps the wrong tile.
 */
import assert from 'node:assert/strict';
import { compileTs } from './harness.mjs';

const drawUrl = compileTs('src/lib/zen/draw.ts');
const { LAYOUT_RING, TILE_DIAMETER_FOR, START_ANGLE } = await import(drawUrl);

const TAU = Math.PI * 2;
const BAND_FUDGE_PX = 4;

/** Verbatim conversion from ZenMode.tsx handleJumpAtClientPoint. */
function tileIndexAt(layout, beatCount, clientX, clientY) {
  const dx = clientX - layout.center.x;
  const dy = clientY - layout.center.y;
  const dist = Math.hypot(dx, dy);
  const band = TILE_DIAMETER_FOR(beatCount, layout.radius);
  const bandHalf = band / 2 + BAND_FUDGE_PX;
  const inner = Math.max(0, layout.radius - bandHalf);
  const outer = layout.radius + bandHalf;
  if (dist < inner || dist > outer) return null; // outside the ring band
  const angle = Math.atan2(dy, dx) - START_ANGLE;
  const norm = ((angle % TAU) + TAU) % TAU;
  const slot = TAU / layout.tiles.length;
  return Math.round(norm / slot) % layout.tiles.length;
}

function makeBeat(id) {
  return { id, start: id * 0.5, duration: 0.5, cluster: 0, segment: 0, jump_candidates: [] };
}

for (const n of [4, 37, 200]) {
  const beats = Array.from({ length: n }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 800, height: 600, margin: 32 });
  assert.equal(layout.tiles.length, n);

  for (let i = 0; i < n; i++) {
    const tile = layout.tiles[i];
    // Tap exactly on the tile center → must land back on tile i.
    const hit = tileIndexAt(layout, n, tile.x, tile.y);
    assert.equal(hit, i, `tile ${i}/${n}: center tap resolved to ${hit}`);
    // Jitter within the band half-width (finger-scale slop) still resolves.
    const band = TILE_DIAMETER_FOR(n, layout.radius);
    const jitter = Math.min(band / 2, band) * 0.35;
    const hitJitter = tileIndexAt(layout, n, tile.x + jitter, tile.y + jitter);
    assert.equal(hitJitter, i, `tile ${i}/${n}: jittered tap resolved to ${hitJitter}`);
  }
}

{ // Cardinal sanity at 4 beats: 12 o'clock → 0, 3 o'clock → 1, 6 o'clock → 2, 9 o'clock → 3.
  const beats = [0, 1, 2, 3].map(makeBeat);
  const layout = LAYOUT_RING(beats, { width: 200, height: 200, margin: 12 });
  const { center, radius } = layout;
  const at = (x, y) => tileIndexAt(layout, 4, x, y);
  assert.equal(at(center.x, center.y - radius), 0, '12 o-clock is tile 0');
  assert.equal(at(center.x + radius, center.y), 1, '3 o-clock is tile 1');
  assert.equal(at(center.x, center.y + radius), 2, '6 o-clock is tile 2');
  assert.equal(at(center.x - radius, center.y), 3, '9 o-clock is tile 3');
}

{ // Band boundaries: inside inner/outer fudge edges hits; beyond them is a miss.
  const beats = Array.from({ length: 37 }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 800, height: 800, margin: 32 });
  const band = TILE_DIAMETER_FOR(37, layout.radius);
  const bandHalf = band / 2 + BAND_FUDGE_PX;
  const { center } = layout;
  // Straight up (tile 0's direction): inside outer edge → hit; outside → null.
  assert.equal(tileIndexAt(layout, 37, center.x, center.y - (layout.radius + bandHalf - 0.5)), 0);
  assert.equal(tileIndexAt(layout, 37, center.x, center.y - (layout.radius + bandHalf + 0.5)), null);
  // Inside inner edge → hit; closer to the center → null.
  assert.equal(tileIndexAt(layout, 37, center.x, center.y - (layout.radius - bandHalf + 0.5)), 0);
  assert.equal(tileIndexAt(layout, 37, center.x, center.y - (layout.radius - bandHalf - 0.5)), null);
  // Page center and far corner: outside the band → no jump target.
  assert.equal(tileIndexAt(layout, 37, center.x, center.y), null);
  assert.equal(tileIndexAt(layout, 37, 5, 5), null);
}

{ // Wrap-around: tile 0's angle sits at ±π seam — a tap slightly counterclockwise of 12 o'clock must still resolve to 0 (or n-1's direction), never a mirrored index.
  const n = 12;
  const beats = Array.from({ length: n }, (_, i) => makeBeat(i));
  const layout = LAYOUT_RING(beats, { width: 400, height: 400, margin: 24 });
  const slot = TAU / n;
  const { center, radius } = layout;
  // Epsilon counterclockwise of 12 o'clock: nearest slot is tile 0.
  const eps = slot / 4;
  const x = center.x + Math.cos(START_ANGLE - eps) * radius;
  const y = center.y + Math.sin(START_ANGLE - eps) * radius;
  assert.equal(tileIndexAt(layout, n, x, y), 0, 'counterclockwise of 12 o-clock stays tile 0');
  // Just past the midpoint toward tile 1 resolves to tile 1 (the exact
  // half-slot is a Math.round knife-edge — not a contract).
  const x1 = center.x + Math.cos(START_ANGLE + slot / 2 + 1e-6) * radius;
  const y1 = center.y + Math.sin(START_ANGLE + slot / 2 + 1e-6) * radius;
  assert.equal(tileIndexAt(layout, n, x1, y1), 1, 'clockwise past the midpoint is tile 1');
}

console.log('pause-jump.test.mjs OK');
