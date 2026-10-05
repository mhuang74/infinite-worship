# zen-mode-mobile-brightness-encoding

Fixes the mobile Zen ring rendering: at phone viewport sizes the ring reads as
**concentric circles of different colors** instead of one band with per-beat color
segments. Supersedes the fix approach in `zen-mode-mobile-ring-fix.md` (root-cause
analysis there is unchanged and still normative; the fix direction changed after
review: radius-scaled ribs → **brightness encoding** on small rings).

Ring-painting logic lives in `application/frontend/src/lib/zen/draw.ts`; the host
(`application/frontend/src/components/ZenMode.tsx`) supplies the viewport
(`LAYOUT_RING(beats, { width, height, margin: 32 })`, `ZenMode.tsx:401`) and builds
the playhead halo gradient (`ZenMode.tsx:135-148`).

## Root cause (carried from zen-mode-mobile-ring-fix.md, verified against draw.ts)

### Defect A — segment separation collapses (the multicolor smear)

Base band per beat is a stroke arc at `layout.radius`, `lineWidth = band`,
spanning `slot − gapAngle`: `band = max(6, min(44, slotArc × 0.72))`
(`TILE_DIAMETER_FOR`, draw.ts:443), `GAP = band < 10 ? band × 0.18 : 1.5`
(draw.ts:246). At 390px/margin 32 (radius 96, N ≈ 450): slotArc 1.34px, GAP
1.08px → **0.26px visible arc** per segment; antialiasing smears consecutive
jewels into a multicolor annulus.

**Defect A′ (latent wrap):** `slot < gapAngle` (N ≳ 558 at r=96) makes
`angleEnd < angleStart`; canvas paints ~2π per tile. Reachable with long songs
on phones.

### Defect B — growth ribs dominate the mobile ring (the literal concentric circles)

Ribs stack absolute 3px annuli outward, k = 1..15 (`PLAY_GROWTH_PX = 3`,
`PLAY_MAX_REPS = 15`): max stack 48px from a 96px ring (~48% of radius; desktop
r=315: ~14%). `MAX_RING_HEADROOM = 67` (draw.ts:83) eats 67 of 163 available px,
capping the mobile ring at 96px.

## Fix

Two changes in `draw.ts`; one host line (`ZenMode.tsx:139`). Desktop (requested
radius ≥ 245) is pixel-identical except one ≤0.2px gap tightening (Change 1,
test-pinned below).

### Change 1 — slot-aware gap (fixes Defect A + A′)

In `PAINT_FRAME` (draw.ts:246):

```ts
// gap between bands: proportional to the slot, never larger than a fraction
// of it — keeps segments visible even when the 6px band floor overrides slotArc
const GAP = Math.min(band < 10 ? band * 0.18 : 1.5, slot * 0.2 * layout.radius);
```

- Phone (post-Change-2 r=136.5, N=450): gap capped at 0.38px → ~1.5px visible arc
  (vs 0.26 today, ~6× separation).
- `gapAngle < 0.2·slot` **always** → `angleEnd > angleStart` by construction;
  Defect A′ impossible at any N.
- Desktop delta: GAP 1.08→0.88 at r=315/N=450 (invisible); unchanged when
  band ≥ 10 or slotArc ≥ ~5.4px. The desktop regression test pins the NEW
  formula values, not "identical to today" (the change is real, just ≤0.2px).

### Change 2 — brightness mode for play count on small rings (fixes Defect B)

Ribs stay exactly as-is on large rings. On small rings the rib loop is skipped
and play count encodes as **band alpha + color lightness** (two redundant
channels; alpha alone gives only 4–6 resolvable levels).

New constants:

```ts
/** r0 (requested radius) below which headroom ramps down from the rib reserve. */
const RIB_HEADROOM_RAMP_START = 200;
/** r0 at/above which rib mode engages and the full 67px headroom is reserved.
 *  The flip sits at the ramp TOP so headroom is exactly 67 on both sides —
 *  continuous, no radius pop at the mode boundary. */
const RIB_MODE_MIN_REQUESTED_RADIUS = 245;
/** Brightness mode: never-played band alpha. */
const COUNT_DIM_ALPHA = 0.35;
/** Brightness mode: count at which the band reaches full alpha / max mix. */
const COUNT_FULL_REPS = 16;
/** Brightness mode: max fraction the jewel mixes toward the contrast target —
 *  capped so the cluster hue stays identifiable at any count. */
const COUNT_LIGHTNESS_MIX_MAX = 0.5;
```

**Mode + headroom in `LAYOUT_RING`** — keyed on the *requested* radius
`r0 = max(0.35 × minSide, MIN_RING_RADIUS)`, a pure function of viewport (no
circularity; radius never feeds back):

```ts
const headroom = TILE_MAX_DIAMETER_PX / 2 +   // 22: band ceiling half
  (MAX_RING_HEADROOM - TILE_MAX_DIAMETER_PX / 2) *
  clamp01((r0 - RIB_HEADROOM_RAMP_START) /
          (RIB_MODE_MIN_REQUESTED_RADIUS - RIB_HEADROOM_RAMP_START));
const radius = Math.max(10, Math.min(r0, box / 2 - headroom));
const mode = r0 >= RIB_MODE_MIN_REQUESTED_RADIUS ? 'ribs' : 'brightness';
```

- Headroom: 22px at r0 ≤ 200 → 67px at r0 ≥ 245, linear between. Continuous in
  viewport ⇒ radius continuous across the boundary (both `r0` and the ceiling
  are monotonic in viewport size through the ramp: dCeiling/dS = 0.5 − 0.35 >
  0). No pop on rotate/resize at tablet widths.
- 390px portrait, margin 32: r0 = 136.5 → headroom 22 → radius = min(136.5,
  163−22) = **136.5** (vs 96 today); slotArc 1.9px, compounding Change 1.
- Desktop 800×800/margin 32: r0 = 280 → headroom 67 → radius 280. Unchanged.
- `RingLayout` gains `mode: 'ribs' | 'brightness'` so `PAINT_FRAME` and the host
  never re-derive (and can never disagree about) the mode.

**Paint changes in `PAINT_FRAME`** (plain-band branch only):

```ts
if (layout.mode === 'brightness') {
  const t = Math.sqrt(Math.min(count, COUNT_FULL_REPS) / COUNT_FULL_REPS);
  // sqrt: big relative steps for the first few plays (where session count
  // mass lives), compressed tail; cap pulse carries the >16 signal, as on
  // desktop.
  alpha = COUNT_DIM_ALPHA + (1 - COUNT_DIM_ALPHA) * t; // 0.35 → ~0.51 → ~0.68 → ~0.84 → 1.0
  strokeColor = COUNT_COLOR_FOR(jewel, t, palette.background);
} else {
  alpha = 0.9; // unchanged desktop path
  strokeColor = jewel;
}
```

`COUNT_COLOR_FOR` mixes the jewel toward a contrast target derived from the
background: `luminance(palette.background) < 0.5 → mix toward white, else toward
black` (hot sections always move AWAY from the background — correct in both
schemes; `ZenPalette` already carries `background`, no palette/host change).
Simple per-channel sRGB lerp by `COUNT_LIGHTNESS_MIX_MAX × t`; ~450 mixes/frame
is negligible.

- Current-tile alpha (`0.55 + 0.45·glow`) and cap-pulse alpha override the count
  alpha exactly as they override 0.9 today; the current tile keeps full jewel
  color (attention beats history) — same precedence as desktop.
- Rib loop: skipped in brightness mode.
- Unplayed ring: whole ring starts at 0.35 alpha and "lights up" as sections
  play (approved design decision; verify on the real device check below).

**`PLAY_GROWTH_FOR` — keyed off mode, not radius.** It feeds the glow-dot
position and the host's halo gradient (draw.ts glow-dot block, ZenMode.tsx:139);
in brightness mode growth is 0 (dot sits at the base-band midline). Signature
becomes `PLAY_GROWTH_FOR(count, mode)` (or it takes the layout); both call sites
updated. Keying off `layout.mode` — never a re-tested radius — closes the
boundary disagreement where a re-derived radius could say "growth" while
`PAINT_FRAME` skipped ribs (halo floats with no ribs under it).

### Out of scope

- `TILE_DIAMETER_FOR`'s 6px floor stays; Change 1 is what restores separation
  under it.
- Candidate-dot geometry and jump-chord rendering untouched (band-scaled /
  inner-space; both gain room from the larger radius as a side benefit).
- No worker/analysis changes. `ZenPalette` unchanged.

## Tests

Existing suite: `application/frontend/zen-tests/*.test.mjs`, run with
`node zen-tests/run.mjs` from `application/frontend/` (plain-node runner, no
framework). Behavioral geometry/paint-sequence assertions on a stubbed
`DrawTarget`.

Update:

- `geometry.test.mjs:67-83` — re-pin: 390px portrait margin 0 → r0 = 136.5,
  headroom 22 → radius **136.5** (was 128). Tiny 100×100 margin 0 → r0 = 64,
  headroom 22, ceiling 50−22 = 28 → radius **28** (was 10). The 800×800/margin 32
  pin (radius 280, headroom 67) survives unchanged.
- `repeats.test.mjs:63-69,108` — `LAYOUT_12` is 800×800/margin 32 → r0 = 280 →
  rib mode: all rib-geometry pins survive; helper pins gain the mode argument
  (`PLAY_GROWTH_FOR(1, 'ribs') === 3`, `PLAY_GROWTH_FOR(1, 'brightness') === 0`).
- `tiles.test.mjs` — uses 400×400/margin 20 layouts (r0 = 140 → brightness
  mode): any rib assertions become brightness-alpha/color assertions.

Add:

- Gap property test, N ∈ {100..1200} × radius ∈ {64..504}: `gapAngle < 0.2·slot`
  always (permanent A′ guard).
- Boundary continuity: sweep minSide 500..800 (margin 32), assert radius is
  monotonic non-decreasing and step-to-step delta < 1px across the r0 = 200..245
  ramp (no pop, no dip at the mode flip).
- Brightness-mode paint test (r0 < 200 layout, counts 0/1/4/16): exactly one
  base arc per beat (no rib arcs); alphas match the sqrt schedule
  (0.35 / ~0.51 / ~0.68 / 1.0); stroke colors mix toward white on the dark test
  background and toward black on a light background, capped at 50%; current-tile
  and cap-pulse overrides still win.
- Desktop regression: `repeats.test.mjs` rib geometry covers r=280; pin Change
  1's desktop gap to the NEW value (0.88 at r=315/N=450) with a comment noting
  the ≤0.2px intentional delta.
- Manual: `npm run dev`, enter Zen on a real song at 390px width (devtools
  mobile viewport): one band with distinct colored segments; unplayed ring
  clearly visible at 0.35 (not muddy — if it is, raise `COUNT_DIM_ALPHA` to
  ~0.45, tuning not redesign); played sections visibly brighter AND paler; no
  outward rib stack; halo centered on the band midline at all counts;
  ✕/⏸/⏭ and tap-to-jump (`handleJumpAtClientPoint`, band-half + fudge —
  mode-independent) unaffected.

## Gates

- `cd application/frontend && npm run lint`
- `npx tsc --noEmit`
- `node zen-tests/run.mjs`
