/**
 * Mobile lyric layout tests (Zen Mode circle downshift / side-by-side):
 * LAYOUT_RING's `mode` — 'stacked' (portrait phone: lyric band above, circle
 * below) and 'side' (landscape phone: circle left, lyric column right). Both
 * split the leftover whitespace edge:gap:edge = 1 : 1.5 : 0.75 with the gap
 * capped at MOBILE_GAP_CAP; surplus above the cap re-splits by the 1 : 0.75
 * edge weights. Radius/ring math is unchanged from the legacy path; no-lyric
 * and ≥ MOBILE_MIN_SIDE viewports must behave exactly as before (`lyric` null).
 */
import assert from 'node:assert/strict';
import { compileTs } from './harness.mjs';

const drawUrl = compileTs('src/lib/zen/draw.ts');
const {
  LAYOUT_RING,
  MOBILE_LYRIC_BLOCK_HEIGHT,
  MOBILE_LYRIC_COLUMN_WIDTH,
  MOBILE_GAP_CAP,
  MOBILE_MIN_SIDE,
} = await import(drawUrl);

function makeBeats(n) {
  return Array.from({ length: n }, (_, id) => ({
    id,
    start: id * 0.5,
    duration: 0.5,
    cluster: 0,
    segment: 0,
    jump_candidates: [],
  }));
}

const beats = makeBeats(64);
const MARGIN = 32;

{ // Portrait 390×844 stacked: pinned numbers from the layout spec.
  // radius = 0.35 × 390 = 136.5 (unclamped); free = 844 − 64 − 56 − 273 = 451;
  // gap = min(1.5/3.25 × 451, 120) = 120 (capped); surplus = 331;
  // topBand = 32 + 331 × (1/1.75) = 221.142857…; cy = topBand + 56 + 120 + 136.5 ≈ 533.64.
  const layout = LAYOUT_RING(beats, { width: 390, height: 844, margin: MARGIN, mode: 'stacked' });
  assert.equal(layout.radius, 136.5);
  const topBand = 32 + (451 - 120) * (1 / 1.75);
  assert.ok(Math.abs(layout.center.y - (topBand + 56 + 120 + 136.5)) < 1e-9, `cy ${layout.center.y}`);
  assert.ok(Math.abs(layout.center.y - 533.64) < 0.01, `cy sanity ≈533.5, got ${layout.center.y}`);
  assert.ok(Math.abs(layout.lyric.bandCenterY - (topBand + 28)) < 1e-9, `bandCenterY ${layout.lyric.bandCenterY}`);
  assert.ok(Math.abs(layout.lyric.bandCenterY - 249.14) < 0.01);
  // Circle bottom leaves the bottom edge band ≈ 174px.
  const bottomBand = 844 - (layout.center.y + layout.radius);
  assert.ok(Math.abs(bottomBand - (32 + (451 - 120) * (0.75 / 1.75))) < 1e-9);
  assert.ok(Math.abs(bottomBand - 174) < 0.5, `bottom band sanity, got ${bottomBand}`);
  // Gap ≤ cap: lyric band bottom to circle top = gap.
  assert.ok(topBand + MOBILE_LYRIC_BLOCK_HEIGHT + MOBILE_GAP_CAP + layout.radius <= layout.center.y + 1e-9);
  assert.equal(layout.center.x, 195);
}

{ // Landscape 844×390 side: pinned numbers from the layout spec.
  // radius = 0.35 × 390 = 136.5; free = 844 − 64 − 240 − 273 = 267;
  // gap = min(1.5/3.25 × 267, 120) = 120 (capped); surplus = 147;
  // cx = 32 + 147 × (1/1.75) + 136.5 = 252.5; columnCenterX = 252.5 + 136.5 + 120 + 120 = 629.
  const layout = LAYOUT_RING(beats, { width: 844, height: 390, margin: MARGIN, mode: 'side' });
  assert.equal(layout.radius, 136.5);
  assert.ok(Math.abs(layout.center.x - 252.5) < 1e-9, `cx ${layout.center.x}`);
  assert.equal(layout.center.y, 195);
  assert.ok(Math.abs(layout.lyric.columnCenterX - 629) < 1e-9, `columnCenterX ${layout.lyric.columnCenterX}`);
  // Right edge band: 844 − (columnCenterX + 120) = 95.
  const rightBand = 844 - (layout.lyric.columnCenterX + MOBILE_LYRIC_COLUMN_WIDTH / 2);
  assert.ok(Math.abs(rightBand - 95) < 1e-9);
  // Gap ≤ cap.
  assert.ok(layout.center.x + layout.radius + MOBILE_GAP_CAP <= layout.lyric.columnCenterX - MOBILE_LYRIC_COLUMN_WIDTH / 2 + 1e-9);
}

{ // Unclamped ratio: when free is small enough that 1.5/3.25 × free < cap,
  // the gap must equal the pure ratio — the cap must not mask it. Derive the
  // gap from cy and assert it matches 1.5/3.25 × free exactly.
  // 400×900: radius 140, free = 900 − 64 − 56 − 280 = 500; 1.5/3.25 × 500 ≈ 230.77 > 120 — capped.
  // Pick 460×620: radius 161, free = 620 − 64 − 56 − 322 = 178; 1.5/3.25 × 178 ≈ 82.15 < 120 ✓.
  const w = 460;
  const h = 620;
  const layout = LAYOUT_RING(beats, { width: w, height: h, margin: MARGIN, mode: 'stacked' });
  assert.equal(layout.radius, 0.35 * 460);
  const free = h - 2 * MARGIN - MOBILE_LYRIC_BLOCK_HEIGHT - 2 * layout.radius;
  const expectedGap = (1.5 / 3.25) * free;
  // cy = topBand + block + gap + radius, topBand = margin + (free − gap) × (1/1.75)
  // ⇒ gap = cy − margin − (free − gap)/1.75 − block − radius ⇒ solve linearly.
  const derivedGap = (layout.center.y - MARGIN - free / 1.75 - MOBILE_LYRIC_BLOCK_HEIGHT - layout.radius) / (1 - 1 / 1.75);
  assert.ok(Math.abs(derivedGap - expectedGap) < 1e-9, `derived ${derivedGap} vs ratio ${expectedGap}`);
  assert.ok(expectedGap < MOBILE_GAP_CAP, 'fixture must stay under the cap');
}

{ // No lyrics on a phone viewport: ring centered, no lyric anchor.
  const layout = LAYOUT_RING(beats, { width: 390, height: 844, margin: MARGIN, centerY: 0.5 });
  assert.equal(layout.center.y, 422);
  assert.equal(layout.lyric, null);
}

{ // minSide ≥ MOBILE_MIN_SIDE with lyrics: legacy centerY path, lyric null.
  const layout = LAYOUT_RING(beats, { width: 700, height: 900, margin: MARGIN, centerY: 0.35 });
  assert.ok(Math.abs(layout.center.y - 0.35 * 900) < 1e-9, `legacy cy ${layout.center.y}`);
  assert.equal(layout.lyric, null);
  assert.ok(700 >= MOBILE_MIN_SIDE);
}

{ // Desktop regression: 1280×800 with lyrics ⇒ same as today (mode undefined,
  // centerY 0.35). Requested cy = 0.35 × 800 = 280, but the existing clamp
  // (radius 280 ⇒ min cy = 32 + 280 = 312) lifts it — unchanged behavior.
  const layout = LAYOUT_RING(beats, { width: 1280, height: 800, margin: MARGIN, centerY: 0.35 });
  assert.equal(layout.center.y, 312);
  assert.equal(layout.center.x, 640);
  assert.equal(layout.lyric, null);
}

console.log('layout-mode.test.mjs OK');
