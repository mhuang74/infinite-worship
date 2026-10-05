/**
 * Brightness-mode + gap tests (spec zen-mode-mobile-brightness-encoding):
 *
 * - Change 1 (slot-aware gap): gapAngle < 0.2·slot for every N and radius —
 *   the permanent Defect A′ guard (angleEnd > angleStart by construction).
 *   Desktop gap re-pinned to the NEW formula value (0.88 at r=315/N=450;
 *   intentional ≤0.2px tightening vs the old 1.08).
 * - Change 2 (mode + headroom): boundary continuity across the r0 200→245
 *   ramp (radius monotone, sub-pixel steps, no pop at the mode flip).
 * - Brightness-mode paint: exactly one base arc per beat (no ribs), the sqrt
 *   alpha schedule, color mixing toward the contrast target, current-tile /
 *   cap-pulse overrides.
 */
import assert from 'node:assert/strict';
import { compileTs, FakeCtx, callsOf } from './harness.mjs';

const drawUrl = compileTs('src/lib/zen/draw.ts');
const { LAYOUT_RING, PAINT_FRAME, PLAY_GROWTH_FOR, TILE_DIAMETER_FOR, JEWEL_COLOR_FOR_CLUSTER, GLOW_DOT_POSITION } = await import(drawUrl);

const PALETTE = {
  jewels: ['#ff8a80', '#fdb515', '#7bd5a8', '#8ab8ff', '#cfa9f5', '#7fdce8'],
  background: '#0e141c',
};

function makeBeat(id, cluster = id % 6) {
  return { id, start: id * 0.5, duration: 0.5, cluster, segment: 0, jump_candidates: [] };
}

function paint(beats, layout, { currentBeat = null, currentIndex = -1, counts = null, pulses = null, reducedMotion = false, nowSec = 0, glowAt = null, background = PALETTE.background } = {}) {
  const ctx = new FakeCtx({ width: layout.radius * 2 + 200, height: layout.radius * 2 + 200 });
  PAINT_FRAME(
    {
      beats,
      layout,
      palette: { ...PALETTE, background },
      currentBeat,
      currentBeatIndex: currentIndex ?? (currentBeat ? beats.findIndex((b) => b.id === currentBeat.id) : -1),
      beatCount: 0,
      jumps: [],
      reducedMotion,
      nowSec,
      currentBeatGlowTSec: currentBeat ? (glowAt ?? nowSec) : null,
      beatPlayCounts: counts ?? undefined,
      capPulseTSecByIndex: pulses ?? undefined,
    },
    ctx,
  );
  return ctx;
}

const TAU = Math.PI * 2;

{ // Gap property (permanent Defect A′ guard): for every beat count and
  // radius, the painted band span (angleEnd − angleStart) must be positive
  // and strictly inside its slot — gapAngle < 0.2·slot always.
  // Fixture mode rule mirrors LAYOUT_RING's (r0 ≥ 245 ⇒ ribs), keyed off the
  // same requested-radius boundary so fixtures always exercise the branch
  // PAINT_FRAME would take at that radius.
  const fixtureMode = (radius) => {
    const ref = LAYOUT_RING([makeBeat(0)], { width: radius / 0.35, height: radius / 0.35, margin: 0 });
    return ref.radius === radius ? ref.mode : (radius >= 245 ? 'ribs' : 'brightness');
  };
  for (const N of [100, 200, 450, 558, 700, 900, 1200]) {
    for (const radius of [64, 96, 136.5, 280, 504]) {
      const beats = Array.from({ length: N }, (_, i) => makeBeat(i));
      const layout = { center: { x: 600, y: 600 }, radius, tiles: beats.map((_, i) => {
        const angle = -Math.PI / 2 + ((TAU / N) * i);
        return { angle, x: 600 + Math.cos(angle) * radius, y: 600 + Math.sin(angle) * radius };
      }), mode: fixtureMode(radius) };
      const ctx = paint(beats, layout, {});
      const band = TILE_DIAMETER_FOR(N, radius);
      const arcs = callsOf(ctx, 'arc').filter((a) => a.lineWidth === band);
      assert.equal(arcs.length, N, `N=${N} r=${radius}: one band arc per beat`);
      const slot = TAU / N;
      arcs.forEach((a) => {
        const span = a.args[4] - a.args[3];
        assert.ok(span > 0, `N=${N} r=${radius}: band span ${span} must be positive (no wrap)`);
        assert.ok(span < slot, `N=${N} r=${radius}: band span ${span} inside slot ${slot}`);
        assert.ok(slot - span < 0.2 * slot + 1e-12, `N=${N} r=${radius}: gap ${(slot - span).toFixed(6)} < 0.2·slot`);
      });
    }
  }
}

{ // Desktop gap re-pin (Change 1): at r=315 / N=450 the band ≥ 10px path
  // gives GAP = min(1.5, slot·0.2·r) = 0.88 px (INTENTIONAL ≤0.2px tightening
  // vs the old flat 1.5·(radius/…) — the old formula gave 1.08; the new one
  // keeps gapAngle < 0.2·slot at every density).
  const N = 450, radius = 315;
  const slot = TAU / N;
  // Literal pin (not recomputed from the formula — a mirrored formula would
  // make this pin tautological). If the formula changes intentionally,
  // re-derive and update this number.
  assert.ok(Math.abs(Math.min(1.5, slot * 0.2 * radius) - 0.88) < 0.01, `desktop gap at r=315/N=450 == 0.88px (got ${Math.min(1.5, slot * 0.2 * radius)})`);
  const gapPx = 0.88;
  const beats = Array.from({ length: N }, (_, i) => makeBeat(i));
  const layout = { center: { x: 500, y: 500 }, radius, tiles: beats.map((_, i) => {
    const angle = -Math.PI / 2 + (TAU / N) * i;
    return { angle, x: 500 + Math.cos(angle) * radius, y: 500 + Math.sin(angle) * radius };
  }), mode: 'ribs' };
  const ctx = paint(beats, layout, {});
  const band = TILE_DIAMETER_FOR(N, radius);
  const first = callsOf(ctx, 'arc').filter((a) => a.lineWidth === band)[0];
  const measuredGap = (slot - (first.args[4] - first.args[3])) * radius;
  assert.ok(Math.abs(measuredGap - gapPx) < 0.01, `painted gap ${measuredGap} == ${gapPx}px`);
}

{ // Boundary continuity: sweep minSide 500..800 (margin 32) across the
  // r0 = 200..245 ramp — radius must be monotone non-decreasing with
  // step-to-step deltas < 1px (no pop, no dip at the mode flip).
  let prev = null;
  let crossed = false;
  for (let side = 500; side <= 800; side += 1) {
    const layout = LAYOUT_RING([makeBeat(0)], { width: side, height: side, margin: 32 });
    if (prev !== null) {
      assert.ok(layout.radius >= prev.radius - 1e-9, `side ${side}: radius ${layout.radius} monotone (prev ${prev.radius})`);
      assert.ok(layout.radius - prev.radius < 1, `side ${side}: step ${layout.radius - prev.radius} < 1px`);
    }
    if (prev && prev.mode === 'brightness' && layout.mode === 'ribs') crossed = true;
    prev = layout;
  }
  assert.ok(crossed, 'sweep crossed the brightness→ribs mode boundary');
  // Headroom is exactly the rib reserve on both sides of the flip.
  const below = LAYOUT_RING([makeBeat(0)], { width: 656, height: 656, margin: 32 }); // r0 229.6
  const at = LAYOUT_RING([makeBeat(0)], { width: 701, height: 701, margin: 32 }); // r0 245.35
  const above = LAYOUT_RING([makeBeat(0)], { width: 702, height: 702, margin: 32 }); // r0 245.7
  assert.equal(below.mode, 'brightness');
  assert.equal(at.mode, 'ribs');
  // At r0 245 headroom = 22 + 45 = 67 on BOTH sides — radius continuous
  // across the flip (r0 itself is far below the ceiling here).
  assert.ok(Math.abs(at.radius - 245.35) < 1e-9, `at the flip radius ${at.radius} == r0 (headroom 67 both sides)`);
  assert.ok(Math.abs(above.radius - 245.7) < 1e-9, `just above the flip radius ${above.radius} == r0`);
}

{ // Brightness-mode paint schedule: counts 0/1/4/16 → sqrt alpha schedule
  // 0.35 / ~0.51 / ~0.68 / 1.0, one base arc per beat, ZERO rib arcs.
  const beats = Array.from({ length: 96 }, (_, i) => makeBeat(i, 0));
  const desktop = LAYOUT_RING(beats, { width: 800, height: 800, margin: 32 }); // r0 280 ⇒ ribs
  assert.equal(desktop.mode, 'ribs');
  const phone = LAYOUT_RING(beats, { width: 390, height: 844, margin: 32 });
  assert.equal(phone.mode, 'brightness', '390px phone layout is brightness mode');

  const alphaFor = (count) => {
    const ctx = paint(beats, phone, { counts: new Map([[0, count]]) });
    const band = TILE_DIAMETER_FOR(96, phone.radius);
    const arcs = callsOf(ctx, 'arc').filter((a) => a.lineWidth === band);
    assert.equal(arcs.length, 96, `count ${count}: exactly one base arc per beat (no ribs)`);
    assert.equal(callsOf(ctx, 'stroke').filter((s) => s.lineWidth === 3).length, 0, `count ${count}: no rib strokes`);
    return arcs[0].globalAlpha;
  };

  const t = (c) => Math.sqrt(Math.min(c, 16) / 16);
  const expected = (c) => 0.35 + 0.65 * t(c);
  for (const count of [0, 1, 4, 16, 50]) {
    const a = alphaFor(count);
    assert.ok(Math.abs(a - expected(count)) < 1e-9, `count ${count}: alpha ${a} == ${expected(count)}`);
  }
  assert.ok(Math.abs(alphaFor(0) - 0.35) < 1e-9, 'never-played alpha 0.35');
  assert.ok(Math.abs(alphaFor(1) - 0.35 - 0.65 * Math.sqrt(1 / 16)) < 1e-9, 'count 1 ≈ 0.51');
  assert.ok(Math.abs(alphaFor(4) - 0.35 - 0.65 * Math.sqrt(4 / 16)) < 1e-9, 'count 4 ≈ 0.68');
  assert.equal(alphaFor(16), 1, 'count 16 reaches full alpha');
  assert.equal(alphaFor(50), 1, 'counts past 16 capped at full alpha');
}

{ // Brightness color mixing: on a dark background the jewel mixes toward
  // white with count; on a light background toward black; capped at 50% mix.
  const beats = Array.from({ length: 96 }, (_, i) => makeBeat(i, 0));
  const phone = LAYOUT_RING(beats, { width: 390, height: 844, margin: 32 });
  const jewel = JEWEL_COLOR_FOR_CLUSTER(0, PALETTE); // #ff8a80
  const hexChan = (hex, i) => parseInt(hex.replace('#', '').slice(i * 2, i * 2 + 2), 16);

  const colorFor = (count, background) => {
    const ctx = paint(beats, phone, { counts: new Map([[0, count]]), background });
    const band = TILE_DIAMETER_FOR(96, phone.radius);
    return callsOf(ctx, 'arc').filter((a) => a.lineWidth === band)[0].strokeStyle;
  };

  // Dark background (#0e141c → luminance < 0.5) ⇒ toward white (255).
  const dark0 = colorFor(0, '#0e141c');
  const dark16 = colorFor(16, '#0e141c');
  assert.equal(dark0, jewel, 'count 0: pure jewel');
  for (let i = 0; i < 3; i++) {
    const mixed = hexChan(dark16, i);
    const expected = Math.round(hexChan(jewel, i) + (255 - hexChan(jewel, i)) * 0.5);
    assert.equal(mixed, expected, `dark bg count 16 channel ${i}: ${mixed} == ${expected}`);
  }
  // Light background ⇒ toward black (0).
  const light16 = colorFor(16, '#f5f0e8');
  for (let i = 0; i < 3; i++) {
    const mixed = hexChan(light16, i);
    const expected = Math.round(hexChan(jewel, i) * 0.5);
    assert.equal(mixed, expected, `light bg count 16 channel ${i}: ${mixed} == ${expected}`);
  }
  // Mid count mixes proportionally (t = sqrt(4/16) = 0.5 ⇒ mix 0.25).
  const dark4 = colorFor(4, '#0e141c');
  const expected4 = Math.round(hexChan(jewel, 0) + (255 - hexChan(jewel, 0)) * 0.25);
  assert.equal(hexChan(dark4, 0), expected4, `count 4 mixes 25% toward white (${expected4})`);
}

{ // Overrides keep precedence in brightness mode: the current tile keeps full
  // jewel color with the glow ramp alpha (attention beats history), and a cap
  // pulse re-brightens a dim band.
  const beats = Array.from({ length: 96 }, (_, i) => makeBeat(i, 0));
  const phone = LAYOUT_RING(beats, { width: 390, height: 844, margin: 32 });
  const band = TILE_DIAMETER_FOR(96, phone.radius);
  const jewel = JEWEL_COLOR_FOR_CLUSTER(0, PALETTE);

  // Current tile: full jewel stroke (NOT the lightened mix), glow alpha ramp.
  const ctx = paint(beats, phone, { currentBeat: beats[0], currentIndex: 0, counts: new Map([[0, 4]]), nowSec: 10, glowAt: 10 });
  const currentArc = callsOf(ctx, 'arc').filter((a) => a.lineWidth === band * 1.8)[0];
  assert.equal(currentArc.strokeStyle, jewel, 'current tile keeps the pure jewel color');
  assert.equal(currentArc.globalAlpha, 1, 'fresh glow alpha 1.0');

  // Cap pulse overrides the count alpha on a non-current tile.
  const ctx2 = paint(beats, phone, { counts: new Map([[0, 4]]), pulses: new Map([[0, 9.5]]), nowSec: 10 });
  const pulsed = callsOf(ctx2, 'arc').filter((a) => a.lineWidth === band)[0];
  assert.ok(Math.abs(pulsed.globalAlpha - 0.775) < 1e-9, `cap pulse alpha 0.775 overrides count alpha (${pulsed.globalAlpha})`);
}

{ // Glow-dot growth is 0 in brightness mode: with counts, the dot sits at the
  // base-band midline (same point as count 0); the host halo gradient and the
  // draw-module dot cannot disagree.
  const beats = Array.from({ length: 96 }, (_, i) => makeBeat(i, 0));
  const phone = LAYOUT_RING(beats, { width: 390, height: 844, margin: 32 });
  const band = TILE_DIAMETER_FOR(96, phone.radius);
  const base = GLOW_DOT_POSITION(phone, band, PLAY_GROWTH_FOR(4, 'brightness'), phone.tiles[0]);
  const zero = GLOW_DOT_POSITION(phone, band, 0, phone.tiles[0]);
  assert.equal(base.x, zero.x, 'brightness dot x == count-0 x (growth 0)');
  assert.equal(base.y, zero.y, 'brightness dot y == count-0 y (growth 0)');

  // And PAINT_FRAME's dot block uses the same growth: dot arcs at the count-0
  // midline even when the beat has 4 plays.
  const ctx = paint(beats, phone, { currentBeat: beats[0], currentIndex: 0, counts: new Map([[0, 4]]), nowSec: 10 });
  const dotArcs = callsOf(ctx, 'arc').filter((a) => Math.abs(a.args[0] - zero.x) < 1e-9 && Math.abs(a.args[1] - zero.y) < 1e-9);
  assert.ok(dotArcs.length >= 2, 'halo + core painted at the base midline point (no growth shift)');
}

console.log('brightness.test.mjs OK');
