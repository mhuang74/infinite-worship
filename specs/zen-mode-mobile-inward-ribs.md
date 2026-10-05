# zen-mode-mobile-inward-ribs

Fixes mobile Zen ring play-count readability: the brightness-only encoding
(band alpha + lightness mix, `zen-mode-mobile-brightness-encoding.md` Change 2)
is visually indistinguishable past a few plays — alpha/lightness steps too
subtle to count. Supersedes that spec's **Change 2** ("brightness instead of
ribs"); its **Change 1** (slot-aware gap) and headroom ramp remain normative,
and the root-cause analysis there is unchanged.

New direction: on small rings, mirror the desktop rib metaphor **INWARD** —
ribs grow from the band's inner edge toward the center, and jump-candidate dots
move **outside** the circle. The circle size stays fixed and the count reads as
radial extent, the same way it does on desktop. All paint/geometry edits are in
`application/frontend/src/lib/zen/draw.ts`; the host `ZenMode.tsx` needs no
change (`layout.mode` flows through `PLAY_GROWTH_FOR`, signature unchanged).

## Design

### Mode rename `'brightness'` → `'inward'`

The union member (`RingLayout.mode`, draw.ts:29), `LAYOUT_RING`'s assignment
(draw.ts:157), and `PAINT_FRAME`'s base-band branch (draw.ts:330) rename with
the mode's meaning: small rings now have ribs too — they just grow inward. The
mode no longer means "brightness instead of ribs".

### Change A — inward ribs (primary count signal)

`PAINT_FRAME`'s rib loop (draw.ts:355) becomes mode-aware:

- **ribs mode** (desktop, r0 ≥ 245): unchanged — rib k's centerline is
  `radius + band/2 + (k−0.5)·3`, capped at `PLAY_MAX_REPS` = 15. Pixel-identical
  to before this spec.
- **inward mode**: rib k's centerline is `radius − band/2 − (k−0.5)·3` — rib 1
  flush against the band's inner edge, subsequent ribs stepping toward center.

Everything else in the loop is shared and unchanged: lineWidth `PLAY_GROWTH_PX`
(3), full-jewel color, the `ribAlpha(k)` ramp (rib 1 at 0.9 → `RIB_ALPHA_MIN` =
0.02 inward — same direction of decay as desktop: rib 1 brightest, adjacent to
the band), and the cap-pulse proportional lift
(`ribAlpha(k) × (0.55 + 0.45 × pulseDecay) / 0.9`).

Rib 1's alpha (0.9) against the dimmed base band underneath is intentionally a
visible step (desktop mirror): the radial extent is the signal, not tonal
continuity. If the manual check shows rib 1 fighting the dim band at low
counts, the pre-decided fallback is raising `COUNT_DIM_ALPHA` toward ~0.45
(tuning, not redesign — same fallback as the previous spec).

**Tiny-viewport clamp** (degenerate viewports only): inward rib count is
`max(0, min(count, 15, floor((radius − band/2 − 2) / 3)))` — the innermost
rib's inner edge stays ≥ 2px clear of the center instead of overflowing past
it. At normal phone sizes (390px ⇒ radius 136.5, band 6) the cap is 15: 15
ribs span 45px of the ~130px inner space; the clamp only binds on tiny rings.

### Change B — candidate dots move outside (inward mode only)

`CANDIDATE_DOT_POSITION` (draw.ts:~251) branches on mode:

- inward: `radius + band/2 + 3 + dotRadius` — the dot's outer edge sits 3px
  clear of the band's **outer** edge (the inner space is rib territory).
- ribs (desktop): `radius − band/2 − 3 − dotRadius` — unchanged.

The `PAINT_FRAME` dots block needs no change — it consumes the position. Halo
overlap near the playhead is acceptable (dots paint before the glow-dot halo,
same layering as desktop chords-under-halo). The `handleJumpAtClientPoint` hit
band (`ZenMode.tsx:502-519`, band ± fudge around `layout.radius`) is
mode-independent and unaffected.

### Brightness stays a secondary channel

The base band's `COUNT_DIM_ALPHA` = 0.35 → 1.0 sqrt alpha ramp and
`COUNT_COLOR_FOR` lightness mix stay exactly as implemented (user decision 1):
the unplayed ring still lights up as it plays; radial extent carries the count.
`PLAY_GROWTH_FOR` in inward mode stays 0 (the playhead dot sits at the
band midline; no ribs exist outside for a halo to float over).

## Numbers (390px phone, margin 32, ~96-beat excerpt)

- radius 136.5 (unchanged — headroom logic untouched), band 6px.
- 15 ribs × 3px = 45px of inward growth; innermost rib centerline
  136.5 − 3 − 42.5 = 91px from center — well clear of the clamp.
- Candidate dots at 136.5 + 3 + 3 + 2.1 ≈ 144.6px from center (outside).

## Tests (`application/frontend/zen-tests/`, run `node zen-tests/run.mjs`)

- `geometry.test.mjs`, `tiles.test.mjs`, `repeats.test.mjs` — literal renames
  `'brightness'` → `'inward'`; radius/headroom pins (136.5 / 28 / 280) and the
  desktop rib pins unchanged and passing (desktop regression proof).
- `brightness.test.mjs` — the main rewrite:
  - Paint schedule: base-arc sqrt alphas unchanged (filter `lineWidth === band`
    still isolates the base band); the old "no rib strokes" assertion inverted:
    count 0 ⇒ 0 rib strokes, count ≥ 1 ⇒ present.
  - NEW inward rib geometry: count 3 ⇒ one rib arc per k ∈ {1,2,3} at
    centerline `radius − band/2 − (k−0.5)·3`, lineWidth 3, alphas `ribAlpha(k)`;
    count 50 ⇒ exactly 15 distinct rib centerlines.
  - NEW outside-dots: beat 0 with two candidates ⇒ dot center radius ==
    `radius + band/2 + 3 + dotRadius`, alpha 0.5; desktop cross-check keeps the
    inner radius.
  - NEW clamp: 100×100 margin 0 (radius 28, band 6) ⇒ count 50 paints exactly
    7 inward ribs, every rib's inner edge outside center.
  - Gap property, boundary continuity, color mixing, override precedence,
    growth-0 dot: unchanged apart from the rename.

## Gates

- `cd application/frontend && node zen-tests/run.mjs`
- `npm run lint`
- `npx tsc --noEmit`
- Manual: `npm run dev` (may already be running externally — do NOT restart),
  Zen at 390px devtools viewport on a real song: circle size fixed, ribs grow
  INWARD from the band's inner edge as beats replay, candidate dots outside
  the circle, band underneath still brightens with plays; desktop viewport
  unchanged (ribs outward, dots inside).
