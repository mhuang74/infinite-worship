# zen-mode-visual-upgrade (v2)

Version 2 of `specs/zen_mode_visual_upgrade.md` (v1, grill-approved 2026-10-05). v1 stays on
disk unmodified. All v1 Approved decisions carry forward — nothing re-opened unless listed:

- 2026-10-05 v2 review interview, four resolutions of details v1 left open or internally
  inconsistent:

  1. **Glow dot tracks the grown band's midline.** New constant `DOT_BASE_OFFSET = 9px`:
     dot center sits at `ringRadius − base/2 + min(9, base/2) + growth/2` — always centered on
     the band's midline whether the band is at base or fully grown (base/2 can reach 22px,
     deeper than any dot placement).
  2. **Spark is a white-hot bolt over a dimmed gold chord.** Stroke chord first (playhead
     color, alpha = 0.45 × beat-decay), then the jagged bolt in near-white `#FFFFFF` over it
     (halo 2.5px alpha 1.0 + core 1.0px alpha 0.95). Gold-only bolt rejected (reads flat).
  3. **Growth renders as stepped per-rep ribs.** Each rep contributes one 3px annulus stroke at
     radius `ringRadius + base/2 + (k−0.5)·PLAY_GROWTH_PX` (k = 1..min(count,6)); rib alpha ramps
     `0.9, 0.80, 0.70, 0.60, 0.50, 0.42` (inner = oldest/brightest). Outer ribs land flush against
     the base band's outer edge (shared edge at ringRadius + base/2). Contour-line look matching
     the EJ screenshot's lumpy bars; flat single-stroke rejected (invisible at these scales).
  4. **7th+ play on a capped beat re-triggers the glow-pulse pass** on that band only
     (alpha re-ramp 0.55→1.0 over 1s, no geometry change). Silent cap rejected (no feedback);
     overflow-rim rejected (extra constant, marginal value). Implementation needs a per-tile
     pulse-timestamp map fed through ZenViewState (see step 4c).

- v1 errors found in the 2026-10-05 code review, corrected in this version:
  - **`DrawTarget` needs `quadraticCurveTo` AND `fill`** — v1 step 1 mentions createRadialGradient
    but omits both interface additions. Gradient creation moves to the HOST (ZenMode.tsx), not
    DrawTarget (see step 1).
  - **Glow/arc draw order was inverted in v1** ("glow dot → arcs last"); halo extends inward over
    chords and would dim them every beat. v2 order: arcs → glow dot on top.
  - **v1's "band*2.5 and band*0.7" dot radii are the only scale anchors** — v2 pins dot color to
    `rgba(palette.playhead, α)` via host-created radial gradient; gradient STOPS are opaque to
    tests (asserted at the fill-call level only).
  - Reduced-motion + capped-beat pulse: pulse is a decaying alpha effect ⇒ **suppressed under
    reduced motion** (step 4c), consistent with the existing glow suppression.
  - v1's tail-7 justification accidentally says "worst case ~4 live arcs... tail 7 suffices":
    with a ≥8-beat engine gap, the 32-beat memory holds ≤4 arcs; tail 7 keeps headroom.
    Arithmetic verified; kept.

## Context

Four styling asks for Zen Mode (`application/frontend/src/components/ZenMode.tsx` + pure draw
module `application/frontend/src/lib/zen/draw.ts`, 240 lines, exports `LAYOUT_RING`,
`TILE_DIAMETER_FOR`, `PAINT_FRAME`, `DrawTarget`), referencing the EternalJukebox ring
(`REFERENCE/EternalJukebox/_web/_includes/go-js.html`, screenshot `~/tmp/eternal_jukebox_playback.png`):

1. **Prominent playhead cursor on the ring** — today: slightly thicker current band
   (×1.8 / ×1.35 reduced-motion) + a thin 2px sweep line from the CENTER toward the tile
   (draw.ts:184-196). Want: glow dot ON the ring at the current beat; center ray REMOVED;
   thick-band highlight KEPT, halo layered on top.
2. **Curved jump arcs with an electricity-spark flash** — today: each jump paints a 3px
   two-segment polyline tile→center→tile (draw.ts:198-213), fading ~1s time-based. Want:
   one smooth quadratic chord bowing toward the ring center, a jagged white-hot bolt riding it
   for the first 0.2s, then the chord lingers as beat-driven short-term memory: alpha 1.0 →
   0.15 over 16 beats, 0.15 → 0 over the following 16 beats (gone at 32).
3. **Smaller ring, larger beat marks** — today: radius = largest-square fit minus headroom
   (draw.ts:88-104), band thickness ≤ TILE_MAX_DIAMETER_PX (28). Want: radius = 0.35 ×
   min(viewport side), band clamp [6px, 44px], slot cap ×0.72 kept (no deliberate overlap).
4. **Playback-repetition visualization: repeated beats grow outward** — inner edge stays
   constant, outer edge grows with per-beat play count (EternalJukebox `redrawTiles`:
   `newWidth = minTileWidth + playCount * growthPerPlay`, capped with a global shrink factor;
   screenshot: lumpy radial bars). v2 renders growth as stepped per-rep ribs at full jewel
   color with outward alpha ramp (decision 3).

All geometry lives in draw.ts already; the component is a thin host (paintZenCanvas replays
draw.ts commands onto the real 2D context, ZenMode.tsx:73-102). Keep that structure: draw.ts
owns every new visual decision; ZenMode.tsx only feeds state + replays commands + creates the
one opaque object draw.ts cannot (the radial gradient). Keep the existing rendering model:
beat-change bursts + a bounded 1s fade pass; no continuous rAF loop (ZenMode.tsx:270-293). Arc
memory (32 beats) is sustained by the beat-change bursts themselves; the 50ms fade pass runs
only while a spark (0.2s), glow decay (<1s), or a capped-beat pulse (<1s) is live.

`Beat` currently has no play-count field (`src/lib/audio.ts` `playBeat` is engine-internal).
The engine's `onBeatChange` fires once per scheduled beat (`audio.ts` `scheduleNextBeat`), and
seek/crossfade paths call it too — counting at the page callback yields exactly one tally per
audible playback, which is the desired "played back several times" semantics. The page's
callback site is page.tsx:169-171 inside `createAudioBuffer`.

## Approach

Grouped by behavior; steps 1→2→3 are independent of each other except where noted; step 4's
count plumbing (4a) must land before/with its paint step (4b); 4c (cap pulse) rides on 4b's
paint-path change.

### 1. Glow-dot cursor on the ring (draw.ts + ZenMode.tsx + tiles test)

- `draw.ts`: DELETE the center-origin sweep block (draw.ts:184-196: `moveTo(center) …
  lineTo(tile)`); REPLACE with a glow dot drawn at the current tile's band midline:
  1. **Dot position**: `dotRadius = ringRadius − base/2 + min(DOT_BASE_OFFSET, base/2) +
     currentGrowth/2` at the current tile's angle (v2 decision 1 — dot always centered on the
     band's midline including grown bands; `currentGrowth` = min(count,6)·3 of the CURRENT beat,
     0 when beatPlayCounts absent — the paint path already computes per-beat growth in step 4b,
     so `PAINT_FRAME` has this value for free).
  2. **Halo**: radial-gradient fill centered at the dot point. Because `DrawTarget` is a
     hand-rolled interface replayed by a fake ctx in tests, the gradient object must be opaque:
     - Add to ZenViewState: `haloGradient?: unknown` — the HOST builds it each frame via
       `ctx.createRadialGradient(dot.x, dot.y, 0, dot.x, dot.y, band * 2.5)` with stops
       `rgba(playhead, 1) → rgba(playhead, 0)`, computed in `paintZenCanvas` (it has the real
       2D context). When `haloGradient` is absent (tests pass none), PAINT_FRAME falls back to
       stroke ring markers: outer stroke arc radius `band*2.5` + inner fill arc radius
       `band*0.7`, both `strokeStyle/fillStyle = palette.playhead`. Tests assert those marker
       calls; the real gradient path is host-side and verified in the browser smoke.
     - `fillStyle = view.haloGradient ?? palette.playhead`; `DrawTarget.fillStyle` widens from
       `string` to `string | unknown` (host casts the real ctx; the fake ctx stores it opaquely).
  3. **Core**: solid disk `fillStyle = palette.playhead`, radius `band * 0.7`, alpha 1.
- The thick-band highlight on the current tile STAYS unchanged (×1.8/×1.35 + decaying alpha).
- Draw order in `PAINT_FRAME` (v2 correction): clear → tiles → **arcs (step 2) → glow dot
  LAST** — arcs under the dot, so the halo (which extends inward over chords by up to
  ~1.25×band) never dims a chord mid-beat. v1's "glow dot → arcs last" order is reversed.
  The `currentBeatGlowTSec` band pulse remains. No dot before the first beat callback
  (`currentIndex < 0` ⇒ no halo/core — today's sweep suppression carried over).
- **DrawTarget additions** (v1 omission, corrected): `quadraticCurveTo(cpx, cpy, x, y)` (needed
  by step 2) and the widened `fillStyle` type. ZenMode.tsx replays both 1:1 onto the real ctx;
  `harness.mjs` fake ctx records path ops (it already records move/line/arc — add quad).
- Headroom: no stem, so reserved headroom = base/2 halo + max growth:
  `MAX_RING_HEADROOM = 44/2 + 18 = 40px` (draw.ts constant, consumed by LAYOUT_RING, step 3).
  Halo outer extent `band*2.5` can reach 110px on sparse songs but that's the HALO (fades to
  transparent radially), not hard geometry — only the 22px band half + 18px growth must clear
  the viewport edge.
- `SWEEP_STEM_RATIO` deleted (no remaining consumer).
- Tests (`tiles.test.mjs`): current-beat paint emits the halo marker (arc radius band*2.5,
  strokeStyle `palette.playhead`) + core fill (radius band*0.7); NO path containing
  `moveTo(center.x, center.y)`; no dot when `currentBeat = null`; halo radius scales with band
  (assert the band*2.5 relation at two beat counts, e.g. 96 and 450).

### 2. Curved jump arcs with electricity-spark flash (draw.ts + ZenMode.tsx + arcs test)

- **Arc geometry**: endpoints exactly `tiles[fromIndex]` / `tiles[toIndex]` (keeps the #39
  contract tests); control point = midpoint of endpoints pulled toward the center by
  `CURVE_INNER_PULL = 0.35` (quadratic; chord bows inward like the reference's `S 450 350`).
- **Beat-driven two-phase memory** (v1's interjected final decision, unchanged): ring order ==
  playback order (sequential, wraps), so `beatsSince = (currentBeatIndex − jump.fromIndex + N)
  % N`, where `currentBeatIndex` = ring index of `currentBeatRef.current` at paint time (−1
  before first callback). Phases evaluated per jump at each paint:
  - **Spark phase** (`nowSec − jump.eventTSec < 0.2`, TIME-based via the existing eventTSec
    stamp): TWO passes over the chord — (i) smooth quadratic chord stroke, playhead color,
    lineWidth 3.2, alpha = 0.45 × memAlpha (dimmed so the bolt reads as light over fire —
    v2 decision 2); (ii) jagged bolt: from endpoint A, 6 midpoints along the quadratic chord
    (sample the curve at t = k/6, k=1..5 implicit endpoints), each offset perpendicular by LCG
    jitter seeded by `(from.id, to.id)` with per-midpoint advance (deterministic per jump, stable
    across repaints — v1 assumption carried), bolt halo lineWidth 2.5 alpha 1.0 + bolt core
    lineWidth 1.0 alpha 0.95, both strokeStyle near-white `#FFFFFF`. The white is a literal in
    draw.ts with a comment (electricity is white; not a palette member).
  - **Memory phase** (0.2s → 16 beats): smooth chord only, lineWidth 3.2, playhead color,
    alpha = 1.0 − 0.85 × (beatsSince/16) (exactly 0.15 at beatsSince = 16).
  - **Ghost phase** (16 → 32 beats): alpha = 0.15 × (1 − (beatsSince−16)/16); at ≥32: SKIP (no
    stroke at all — not a zero-alpha paint).
  - During the spark phase the chord alpha uses `memAlpha` at the jump's current beatsSince
    (0 just after the jump) — one formula everywhere: chord alpha = dim-or-full × beat schedule.
  - Reduced motion: arcs AND sparks suppressed entirely (unchanged semantics).
  - **Fade pass**: `FADE_SECONDS` (1s) still bounds the spark flash + glow decay + cap pulse
    (4c); the 50ms interval keeps its stop condition (`stopAtRef` = now + FADE_SECONDS·1000,
    ZenMode.tsx:280-293). Memory-phase chords repaint once per beat-change burst (2–4 Hz), which
    steps the 16/16 schedule; between beats during a spark the 1s pass covers the only
    sub-second animation. NO new timer logic.
  - **Tail**: page keeps `[...prev.slice(-7), jump]` (page.tsx:187). Engine enforces ≥8 beats
    between jumps ⇒ the 32-beat window holds ≤4 live arcs + the spark's own ⇒ tail 7 has
    headroom. KEEP 7 (v1 arithmetic verified).
- **ZenMode.tsx plumbing**: PAINT_FRAME's `ZenViewState` gains `currentBeatIndex: number`
  (−1 before first callback) — computed in `repaint` via the same `indexById` map
  `buildZenJumps` already builds (refactor: hoist the map build so both use one map per repaint).
- Tests (`arcs.test.mjs`), rewritten assertions:
  - Arc = `moveTo(tiles[from])` + `quadraticCurveTo(ctrl, tiles[to])`, lineWidth 3.2.
  - Spark phase: jagged bolt = 1 moveTo + 5 lineTos (6-point path, strokeStyle `#FFFFFF`)
    + the dimmed chord (alpha ≤ 0.45) only when `nowSec − eventTSec < 0.2`; zero bolt polylines
    when ≥ 0.2; no-arc cases (missing indices) unchanged; reduced-motion ⇒ no arcs/sparks.
  - Beat-decay contract: alpha at beatsSince 0 = 1.0; 8 = 0.575; 16 = 0.15; 24 = 0.075;
    31 ≈ 0.009; ≥32 = no stroke; monotone decreasing; exactly 0.15 at the 16 boundary.
  - Wrap: jump fromIndex 40 of 48 beats, current at 2 ⇒ beatsSince = (2−40+48)%48 = 10 ⇒
    alpha ≈ 0.469 — assert the wrap math directly.
  - During spark phase at beatsSince b: chord alpha = 0.45 × memAlpha(b) — assert at b=0 and b=8.

### 3. Smaller ring + thicker bands (LAYOUT_RING + TILE_DIAMETER_FOR + geometry test)

- `TILE_MAX_DIAMETER_PX`: 28 → 44 (base ceiling; binds only on sparse songs).
- `LAYOUT_RING` (draw.ts:88-104): radius =
  `clamp(0.35 × min(viewport.width, viewport.height), MIN_RING_RADIUS = 64, box/2 − MAX_RING_HEADROOM)`
  where box = min(vw,vh) − 2·margin. Precedence (v1's stated rule, pinned as test): **ceiling
  wins over floor, floor wins over fraction** — at 100×100 margin 0: 0.35×100 = 35 < 64 floor,
  but box/2 − 40 = 10 < 64 ⇒ radius = 10 (ceiling wins; the floor never leaks outside the box).
  At 800×800 margin 32 ⇒ radius = 280 (fraction binds; v1 approved). Center stays viewport
  center. Replace `TILE_MAX_DIAMETER_PX/2 * SWEEP_STEM_RATIO` with the fixed
  `MAX_RING_HEADROOM = 40`.
- `TILE_DIAMETER_FOR` (draw.ts:228-232): floor 4 → 6px, ceiling via TILE_MAX_DIAMETER_PX
  28 → 44, slot cap ×0.72 UNCHANGED. Reference points at radius 280: 450 beats ⇒ slotArc 3.91 ⇒
  band 6 (floor binds); 96 beats ⇒ slotArc 18.3 ⇒ band 13.2; sparse songs approach 44.
- Tests (`geometry.test.mjs`): radius == 280 at 800×800 margin 32; SAME radius (== 0.35×min
  side) for 390×844 and 844×390 (min-side rule, centered); tiny-viewport precedence case above
  (radius = max(?) → assert ceiling-beats-floor: 100×100 margin 0 ⇒ radius == 10); band floor 6
  at ≥900 beats; band ceiling 44 on sparse; density loop [12, 60, 450, 900] with the relaxed
  invariants v1 spelled out: `thickness >= 6`, `thickness <= max(6, slotArc × 1.5)` (the 900-beat
  case exceeds the slot cap because the floor binds — accepted user tradeoff; pre-decided
  fallback if it looks bad on a real dense song: floor = min(6, slotArc)).

### 4. Playback repetition → outward band growth, stepped ribs (page.tsx + ZenMode.tsx + draw.ts + tests)

- **4a. page.tsx (count plumbing)** — in `createAudioBuffer`'s `onBeatChange` (page.tsx:169):
  `beatPlayCountsRef.current.set(beat.id, (get ?? 0) + 1)`; expose as state
  `beatPlayCounts: Map<number, number>` (counts drive paint — must trigger re-render; store the
  Map in state, mutate the ref mirror, or bump a version counter — pick the existing
  repo pattern: `useState<Map>` with `setBeatPlayCounts(new Map(prev))` per beat tick is ~2-4Hz
  Map copies of ≤N entries — acceptable, matches "all state in page.tsx via hooks" convention).
  Reset to an empty Map in `loadSongForPlayback` (new Song ⇒ fresh counts). NOT reset on engine
  Restart (counts kept across Restart, reset on new-song load — v1 approved; EternalJukebox
  parity). Also keep a `lastPlayCountRef: { beatId, count }` of the most recent tally so ZenMode
  can detect a 7th+ play without diffing Maps (see 4c). Pass `beatPlayCounts` + a
  `beatPlayTick` pair… simpler: pass `beatPlayCounts` and let ZenMode derive cap-pulses itself
  (4c needs the per-beat previous count — ZenMode keeps a prev-counts ref and diffs on prop
  change; page stays dumb).
- **4b. ZenMode.tsx**: new OPTIONAL props `beatPlayCounts?: Map<number, number>` (default
  `new Map()`). New useEffect mirroring jumps' pattern: on prop change, repaint burst (counts
  change at exactly beat-change time, so the beat burst already repaints — the effect is a
  belt-and-braces no-op under the same tick; keep it for prop-driven repaints). Handed to
  PAINT_FRAME via ZenViewState.
- **4c. draw.ts paint changes**:
  - `ZenViewState` gains `beatPlayCounts?: Map<number, number>` and
    `capPulseTSecByIndex?: Map<number, number>` (ring-index → pulse-start seconds; only entries
    for beats whose count is > PLAY_MAX_REPS at their latest tally).
  - ZenMode owns a `prevPlayCountsRef` and `capPulseTSecRef: Map<number, number>`: on props
    change, for each beat whose count increased beyond 6, stamp `performance.now()/1000`.
    Entries expire naturally (paint reads `decay(nowSec − stamp)`; delete the entry when decay
    hits 0 to bound the map). Reduced motion ⇒ no cap pulse (suppressed like the glow — v2
    correction note).
  - **Base annulus** (per tile): `ctx.arc(center, ringRadius, …)` with lineWidth = band —
    unchanged center-radius; inner edge = ringRadius − band/2 for EVERY band (invariant).
  - **Ribs** (v2 decision 3): for `k = 1..min(count, PLAY_MAX_REPS)`, stroke one arc at radius
    `ringRadius + band/2 + (k − 0.5) × PLAY_GROWTH_PX`, lineWidth = PLAY_GROWTH_PX = 3,
    strokeStyle = the tile's cluster color (full jewel, NOT dimmed), alpha =
    `RIB_ALPHAS[k−1]` = `[0.9, 0.80, 0.70, 0.60, 0.50, 0.42]` (innermost rib = brightest;
    matches EJ's brightest-at-base contour). Rib 1's inner edge = ringRadius + band/2 = flush
    against the base band's outer edge; rib 6's outer edge = ringRadius + band/2 + 18.
  - **Growth cap**: PLAY_MAX_REPS = 6, PLAY_GROWTH_PX = 3 ⇒ max extension 18px; reserved by
    MAX_RING_HEADROOM (22 + 18 = 40 ≤ 40 ✓ — exactly saturates the reservation; bump
    headroom constant if either knob changes).
  - **Current beat == repeated beat**: glow multiplier applies ONLY to the base annulus
    (lineWidth band ×1.8/1.35) — ribs stay put (they're history, not attention; multiplying
    them would break the inner-edge invariant). Glow-dot position uses this beat's growth
    (step 1).
  - **Cap pulse paint**: if `decay(nowSec − capPulseTSecByIndex.get(i)) > 0`, re-apply the
    current-beat-style alpha ramp `0.55 + 0.45 × decay` to the base annulus + ribs of that
    tile only (no geometry change). If the tile is ALSO the current beat, max() the two alphas.
- Tests (new `application/frontend/zen-tests/repeats.test.mjs`; `run.mjs` auto-discovers
  `*.test.mjs` — no npm test script exists, runner invoked directly):
  - Base annulus UNCHANGED by counts: arc at `layout.radius`, lineWidth = band — for counts
    0 through 50.
  - Inner-edge invariance: arcs for a beat with count 0 vs count 5 — base arc radius and
    lineWidth identical; ribs never paint at or below `ringRadius + band/2 − 3` (i.e., nothing
    intrudes past the shared flush edge inward).
  - Rib geometry: count 3 ⇒ exactly 3 rib arcs at radii `radius + band/2 + (k−0.5)·3`,
    lineWidth 3, alphas [0.9, 0.8, 0.7] in order; count 50 ⇒ exactly 6 ribs (cap).
  - Alpha ramp monotone decreasing outward; first rib alpha == 0.9 (base-band alpha) ⇒ no
    brightness discontinuity at the flush edge.
  - No beatPlayCounts ⇒ identical command stream to today (zero rib arcs).
  - Dot-position coupling: current beat with count 4 ⇒ halo marker arc centered at
    `ringRadius − band/2 + min(9, band/2) + 6` (DOT_BASE_OFFSET + growth/2) — assert via the
    fake-ctx arc coordinates.
  - Cap pulse: beat with a stamped `capPulseTSecByIndex` entry at now−0.5s ⇒ its base-annulus
    alpha = 0.55 + 0.45×0.5 = 0.775 (same curve as the current-beat glow); expired stamp (≥1s)
    ⇒ normal 0.9 alpha and the entry would be deleted.

### 5. Docs touch (`specs/zen-mode.md`)

- Line 60 layout bullet: "largest square" → "radius = 0.35 × min(viewport side), clamped
  [64, box/2 − 40px headroom]".
- Line 61 playhead bullet: halo glow dot centered on the current band's midline (tracks
  repetition growth) + thickened band; no center ray.
- Line 62 jump feedback: curved chord bowing toward center + white-hot jagged spark for 0.2s,
  then beat-driven memory: alpha 1.0 → 0.15 over 16 beats, → 0 by 32.
- New bullet: repetition — per-beat play counts grow stepped outward ribs (6 × 3px, alpha
  ramp, inner edge fixed); counts kept across Restart, reset on song load; 7th+ play re-pulses
  the band (suppressed under reduced motion).

## Critical files & anchors

- `application/frontend/src/lib/zen/draw.ts` — all geometry/paint decisions: glow dot (halo
  marker or host gradient + core), quadratic/spark/memory arcs, ring fraction, band floor/ceiling,
  stepped growth ribs, cap pulse. Every knob single-sourced here: `TILE_MAX_DIAMETER_PX`,
  `MAX_RING_HEADROOM`, `MIN_RING_RADIUS`, `CURVE_INNER_PULL`, `DOT_BASE_OFFSET`,
  `PLAY_MAX_REPS`, `PLAY_GROWTH_PX`, `RIB_ALPHAS`, spark white literal. Interface changes:
  `DrawTarget` += `quadraticCurveTo`, `fillStyle: string | unknown`; `ZenViewState` +=
  `currentBeatIndex`, `beatPlayCounts?`, `capPulseTSecByIndex?`, `haloGradient?`.
- `application/frontend/src/components/ZenMode.tsx` — build `currentBeatIndex` (hoist the
  indexById map from buildZenJumps:140-156 so repaint + arcs share it), create the halo radial
  gradient per frame in paintZenCanvas (real ctx only), own `prevPlayCountsRef` + cap-pulse
  stamps, pass `beatPlayCounts` through; replay `quadraticCurveTo` in the DrawTarget→ctx cast.
- `application/frontend/src/app/page.tsx` — `beatPlayCounts` state at onBeatChange
  (page.tsx:169-171), reset in `loadSongForPlayback`, pass to ZenMode (page.tsx:583-592).
  Keep the jump tail at 7 (page.tsx:187).
- `application/frontend/zen-tests/{geometry,tiles,arcs}.test.mjs` — updated assertions;
  new `repeats.test.mjs`; `harness.mjs` fake ctx += record `quadraticCurveTo` (+ opaque
  fillStyle storage). Runner: `node zen-tests/run.mjs` (discovers `*.test.mjs`; there is no
  npm test script).
- `specs/zen-mode.md:60-64` — bullets per step 5.

## Verification

1. `cd application/frontend && node zen-tests/run.mjs` — 4 suites pass (3 updated + repeats).
2. `cd application/frontend && npx tsc --noEmit` clean (strict tsconfig).
3. `cd application/frontend && npm run lint` clean.
4. End-to-end smoke: `npm run dev` (AGENTS.md: a server may already run — check :3000 free or
   use `-p 3001`), upload/play a song from `music/` (e.g. count_on_me.mp3), wait for `ready`,
   enter Zen Mode via the fullscreen button:
   - **Playhead**: glowing gold halo dot riding the current band's midline — sits higher on
     grown (repeated) bands; NO center ray anywhere.
   - **Jump arcs**: quadratic chords bowing toward the ring center; white-hot jagged bolt in
     the first ~0.2s over a dimmed gold chord; chord then persists and visibly dims over the
     next ~16 beats and is gone by ~32 (set jump probability high to force several jumps; count
     beats on-screen).
   - **Ring**: visibly smaller (0.35×min side ⇒ 280px at 800×800 viewport) with chunkier bands.
   - **Repetition**: set the jump-probability slider to 0 ⇒ no jumps ⇒ beats replay
     sequentially; bands visited repeatedly grow stepped outward ribs within ~10 beats of a
     loop; inner edge stays a clean circle; after the 6th replay a band stops growing and
     re-pulses its brightness on each further repeat.
   - **Reduced motion** (DevTools rendering emulation): no sparks, no arcs, no decaying pulse,
     static highlight + ribs still render.
5. Screenshot the ring at 800×800 and visually diff against the v1 mockup
   (`zen-upgrade-mockup.png`, local://) and `~/tmp/eternal_jukebox_playback.png` — expect
   deviations vs the v1 mockup at exactly the decision points: dot midline position, white
   bolt, stepped ribs.

## Assumptions & contingencies

- Spark jitter: deterministic LCG seeded by `(from.id, to.id)`, per-midpoint advance (stable
  across fade-pass repaints within the 0.2s window; a Math.random-per-frame fallback would
  shimmer). Carried from v1.
- Dot-on-grown-band lookup: PAINT_FRAME computes the current beat's growth inside the tile loop
  anyway (one Map lookup per tile); the dot pass reuses `min(count,6)·3` — no extra plumbing.
- Halo gradient through the host (opaque `unknown` in DrawTarget) instead of a real gradient in
  tests: gradient internals are untestable through the fake ctx regardless; host-side creation
  keeps 100% of geometry in draw.ts and only color-stop trivia in ZenMode.tsx. If the gradient
  fill renders blank in some browser (mis-cast), the marker-ring fallback (absent gradient ⇒
  stroked rings) is already the test-verified path — flip by having the host pass NO gradient.
- Cap-pulse map growth: entries live ≤1s and are deleted on expiry; a pathological 450-beat
  song all at cap adds ≤450 stamp entries ~2-4Hz-churned — trivially bounded.
- Arc memory BEAT-counting assumes ring order == playback order (wraps via modulo). If a future
  change decouples them, switch beatsSince to an explicit per-jump position ledger (counter
  stamped on the jump event, incremented per onBeatChange) — named failure mode + fix, carried
  from v1.
- v1 remains the approvals record; this v2 is the build target. Any v1/v2 disagreement:
  v2 wins (decisions 1-4 + the five review corrections listed at top).
