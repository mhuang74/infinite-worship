# zen-mode-mobile-ring-fix

Fixes the mobile Zen ring rendering: at phone viewport sizes the ring reads as
**concentric circles of different colors** instead of one band with per-beat color
segments. Ring-painting logic lives in `application/frontend/src/lib/zen/draw.ts`;
the host (`application/frontend/src/components/ZenMode.tsx`) supplies the viewport
(`LAYOUT_RING(beats, { width, height, margin: 32 })`, `ZenMode.tsx:401`) and builds
the playhead halo gradient (`ZenMode.tsx:135-148`).

Direction (chosen over radius-scaled ribs): keep the desktop rib-growth metaphor,
but on small rings replace outward ribs with **per-segment brightness encoding** of
play count. Ribs scaled to a 96-137px ring are ~1px each — individually invisible
and still costing 67px of headroom. Brightness encoding needs no headroom beyond
the band itself, so the mobile ring grows to its 0.35×minSide request and play
count stays readable as relative intensity.

## Root cause (two independent defects, both mobile-triggered)

### Defect A — segment separation collapses (primary: the multicolor smear)

The base band per beat is a stroke arc at a **shared radius** (`layout.radius`),
`lineWidth = band`, spanning `slot − gapAngle` where:

- `slot = 2π / N` (N = beat count; `songData.segments` — ALL beats, madmom
  DBNDownBeatTrackingProcessor output — page.tsx:633)
- `band = max(6, min(44, slotArc × 0.72))` with `slotArc = 2π·radius / N` (`draw.ts:443-447`)
- `gapAngle = GAP / radius`, `GAP = band < 10 ? band × 0.18 : 1.5` px (`draw.ts:246`)

Numbers at 390px phone viewport (margin 32, radius = min(max(0.35·390, 64),
390/2−32−67) = 96px, typical N ≈ 450):

| quantity | value |
|---|---|
| slotArc (`2π·96/450`) | 1.34 px |
| band | 6 px (floor overrides `0.72·slotArc`) |
| GAP (`6 × 0.18`) | 1.08 px |
| visible arc per segment | `1.34 − 1.08` ≈ **0.26 px** |

The 6px visibility floor is correct in intent, but GAP is derived from the floored
band rather than from the slot. When the floor overrides `0.72·slotArc`, the gap
consumes ~80% of the slot: each beat paints a 6px-thick × 0.26px-long sliver, and
antialiasing blends consecutive slivers of different cluster jewels into a smeared
multicolor annulus. Desktop is unaffected (radius 315–504 → slotArc 4.4–7px →
visible segments 3.3–6px).

**Secondary wrap artifact (Defect A′, latent):** `angleEnd < angleStart` whenever
`slot < gapAngle`, i.e. `N > 2π·radius / GAP`. At radius 96 / GAP 1.08 that is
N ≳ 558. Canvas treats a negative arc delta as ~2π, so every tile renders as a
near-complete circle. Not triggered by typical songs (N ≈ 450) but reachable with
long songs on phones. Fix A removes the trigger condition; no separate code change.

### Defect B — growth ribs dominate the mobile ring (the literal concentric circles)

Ribs stack **absolute** 3px annuli outward: `radius + band/2 + (k−0.5)·3px`,
k = 1..min(count, 15) (`draw.ts:300`, `PLAY_GROWTH_PX = 3`, `PLAY_MAX_REPS = 15`).

- Max rib stack = `45px` + band half `3px` = 48px **from a 96px ring** — ribs
  occupy ~48% of the ring radius (desktop r=315: ~14%; r=504: ~9%).
- `MAX_RING_HEADROOM = 67px` (`draw.ts:83`) is sized for the desktop band ceiling
  (44/2 = 22) + full rib growth (45); on mobile it eats 67 of 163 available px
  (`box/2 = 163`), capping the ring at 96px and compounding Defect B.
- Beats cluster by play count: all count≥1 beats form a full multicolor circle at
  one radius, count≥2 another, etc. — with the playhead halo (`band × 2.5` = 15px
  circle) and candidate dots (~r 88) layered between them, the result is several
  colored circles at distinct radii.

Both defects are mobile-only manifestations of constants that assume the desktop
band scale; the geometry code itself is viewport-correct.

## Fix

Two changes in `draw.ts`, plus a one-line host update in `ZenMode.tsx` (the halo
gradient placement must agree with the mode — see Change 2).

### Change 1 — slot-aware gap (fixes Defect A + A′)

In `PAINT_FRAME` (`draw.ts:246`), replace the band-derived gap with a slot-derived
one:

```ts
// gap between bands: proportional to the slot, never larger than a fraction
// of it — keeps segments visible even when the 6px band floor overrides slotArc
const GAP = Math.min(band < 10 ? band * 0.18 : 1.5, slot * 0.2 * layout.radius);
```

- `slot × 0.2 × radius` = 20% of the slot's arc length; at phone/N=450 that caps
  the gap at ~0.38px (r=136.5, post-Change-2), leaving ~1.5px of visible arc per
  segment (vs 0.26 today) — ~6× more color separation.
- Also caps `gapAngle < slot × 0.2` **always**, so `angleEnd > angleStart` by
  construction — Defect A′ (the ~2π wrap) becomes impossible at any N.
- Desktop unchanged in practice: slot-arc there is ≥ 4.4px, so the min() picks
  the existing band-derived value except at r=315/N=450 (GAP 1.08→0.88 — a 0.2px
  tightening, visually negligible; segment edges stay crisp).

### Change 2 — brightness mode for play count on small rings (fixes Defect B)

Add a mode switch on the **final** ring radius. Ribs stay exactly as-is on
desktop; below the threshold the rib loop is skipped and play count maps to
base-band alpha.

New constants:

```ts
/** Below this final ring radius, play count paints as band brightness instead
 *  of outward ribs (ribs would be sub-pixel and cost 45px of headroom). */
const RIB_MODE_MIN_RADIUS = 200;
/** Brightness mode: never-played band alpha (current normal alpha is 0.9). */
const COUNT_DIM_ALPHA = 0.35;
/** Brightness mode: count at which the band reaches full alpha. */
const COUNT_FULL_REPS = 16;
```

Mode + headroom resolution in `LAYOUT_RING` (headroom depends on mode, mode on
final radius, radius on headroom — break the circle with at most one recompute):

```ts
// requested = max(0.35 × minSide, MIN_RING_RADIUS), as today
// 1. rib-mode candidate: r_rib = min(requested, box/2 − MAX_RING_HEADROOM)
// 2. if r_rib >= RIB_MODE_MIN_RADIUS → rib mode, radius = r_rib (today's path)
// 3. else → brightness mode: radius = min(requested, box/2 − TILE_MAX_DIAMETER_PX/2)
//    (headroom = band half only; no rib reserve)
```

Since the brightness headroom (22) < rib headroom (67), step 3 can only grow the
radius — the result is always mode-consistent (a ring that ends <200 in rib mode
is re-laid-out in brightness mode; it may land above 200 and stays brightness,
which is harmless: the threshold exists to protect small rings, not to force ribs
onto mid-size ones).

Numbers at 390px portrait, margin 32: requested = 136.5; r_rib = min(136.5,
163−67) = 96 < 200 → brightness mode → radius = min(136.5, 163−22) = **136.5**
(vs 96 today). slotArc grows 1.34→1.9px, compounding Change 1.

Add `mode: 'ribs' | 'brightness'` (or the numeric radius threshold decision) to
`RingLayout` so `PAINT_FRAME` and the host don't re-derive it.

Paint changes in `PAINT_FRAME`:

```ts
// In the per-beat loop, the plain-band alpha branch (currently `alpha = 0.9`):
if (layout.mode === 'brightness') {
  // sqrt ramp: big relative steps for the first few plays, compressed beyond —
  // "relative, not exact" by design. count 0 → 0.35, 1 → ~0.51, 4 → ~0.68,
  // 9 → ~0.84, ≥16 → 1.0.
  alpha = COUNT_DIM_ALPHA +
    (1 - COUNT_DIM_ALPHA) * Math.sqrt(Math.min(count, COUNT_FULL_REPS) / COUNT_FULL_REPS);
} else {
  alpha = 0.9;
}
// Rib loop: skip entirely in brightness mode.
```

- Current-tile alpha (`0.55 + 0.45·glow`) and cap-pulse alpha override the count
  alpha exactly as they override 0.9 today — attention states never dim.
- Cap pulse (16th+ plays) still works: it re-applies the brightness ramp to the
  band, now at full base alpha.

**`PLAY_GROWTH_FOR` signature change (exported):** the glow-dot position and the
host's halo gradient both consume it (`draw.ts` glow-dot block, `ZenMode.tsx:139`).
In brightness mode growth is 0 (dot sits at the base-band midline). Change to
`PLAY_GROWTH_FOR(count, radius)` returning 0 below `RIB_MODE_MIN_RADIUS`, and
update both call sites — the host change is required, otherwise the halo floats
at the desktop-scaled growth offset while no ribs exist.

Desktop impact: **none**. r ≥ 200 keeps rib mode, identical constants, identical
paint order; `PLAY_GROWTH_FOR(count, r≥200)` returns today's values.

### Out of scope

- `TILE_DIAMETER_FOR`'s 6px floor stays: a sub-6px band is invisible; the gap fix
  (Change 1) is what restores segment separation under the floor.
- Candidate-dot geometry and jump-chord rendering are untouched — they scale with
  `band` / live in the inner space, not with the defects. (The larger mobile
  radius gives both more room as a side benefit.)
- No worker/analysis changes.

## Tests

Existing suite: `application/frontend/zen-tests/*.test.mjs`, run with
`node zen-tests/run.mjs` from `application/frontend/` (plain-node runner, no
framework). Behavioral geometry/paint-sequence assertions on a stubbed
`DrawTarget`.

Update:

- `geometry.test.mjs:67-83` — pins mobile radius to `195 − 67 = 128` (390px
  portrait, margin 0) and the degenerate-tiny radius to 10. Re-pin to the
  brightness-mode values: 390px portrait → `max(136.5, 64)` requested, rib
  candidate 128 < 200 → brightness → `min(136.5, 195−22)` = **136.5**; tiny
  100×100 → rib candidate < 200 → `min(64, 50−22)` = **28**.
- `repeats.test.mjs:63-69,108` — pins `PLAY_GROWTH_FOR(count)` absolute values
  (1→3, 15→45) and rib centerlines at `radius + band/2 + 1.5`. `LAYOUT_12` is
  800×800/margin 32 → r=280 ≥ 200 → rib mode: geometry pins survive; the
  helper-call pins gain the radius argument (`PLAY_GROWTH_FOR(1, 280) === 3`,
  `PLAY_GROWTH_FOR(1, 136) === 0`).
- Any test painting counts on a sub-200-radius layout (check `tiles.test.mjs`,
  which uses 400×400/margin 20 → r=140, brightness mode after the change): rib
  assertions there must be replaced with brightness-alpha assertions.

Add:

- Gap property test over N ∈ {100..1200} × radius ∈ {64..504}: `gapAngle < slot`
  always (guards the A′ wrap permanently).
- Brightness-mode paint test (small-ring layout, counts 0/1/4/16): no rib arcs
  (only one arc per beat at `layout.radius`), base-band alphas match the sqrt
  schedule, current-tile and pulse overrides still win.
- Mode-boundary test: final radius ≥ 200 ⇒ ribs paint exactly as today (desktop
  regression — `repeats.test.mjs` largely covers; add an explicit boundary case
  at r_rib just under 200 flipping to brightness).
- Manual: `npm run dev`, enter Zen on a real song at 390px width (devtools mobile
  viewport): ring must read as one band with distinct colored segments; played
  sections visibly brighter than unplayed; no outward rib stack; ✕/⏸/⏭ hit
  targets and tap-to-jump (`handleJumpAtClientPoint`, `ZenMode.tsx:502`)
  unaffected (hit test uses `band/2 + BAND_FUDGE_PX`, mode-independent).

## Gates

- `cd application/frontend && npm run lint`
- `npx tsc --noEmit`
- `node zen-tests/run.mjs`
