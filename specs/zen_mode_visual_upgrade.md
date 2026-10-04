# zen-mode-visual-upgrade

## Approved decisions (grill-me interview, 2026-10-05)

- Cursor: **glow dot on the ring** (halo + bright core), centered on the current band — NOT a
  stem/ray. The existing thicker-band highlight stays and gains the halo dot on top.
- Ring size: **radius = 0.35 × min(viewport dimension)** (mockup-verified against the reference's
  measured proportion: reference ring diameter ≈ 1010px of a 1204px min side ⇒ radius ≈ 0.42×min;
  user chose 0.35×min — slightly smaller than reference).
- Mark scale: **moderate** — band clamp [6px, 44px], slot cap ×0.72 kept (no deliberate overlap
  at any density).
- Jump arc: **spark 0.2s then smooth curved-arc fade** over the rest of the 1s window.
  **SUPERSEDED by user interjection (2026-10-05):** the smooth chord does NOT fade over 1s — it
  holds as short-term memory for recent jumps: alpha decays from 1.0 to 0.15 over the next
  **16 beats**, then from 0.15 to 0 over the **following 16 beats** (fully gone at 32 beats).
  Decay unit is BEATS (playback progress), not seconds; the spark flash alone remains time-based
  (0.2s).
- Repetition: **growth capped at 6 replays**, counts **kept across engine Restart**,
  **reset on new-song load**.
- Palette: **keep the app's jewel palette** (no EternalJukebox pastel adoption).
- Mockup: `zen-upgrade-mockup.png` (this session's local:// store) — rendered from the plan's
  constants via Chromium: 800×800, 96 beats, ring radius 280 (0.35×800), halo dot, curved chords,
  spark bolt, chorus growth bars. Mockup arc alphas don't reflect the 16/16-beat memory fade
  (static render); the memory schedule is beat-driven and verified in arcs.test.mjs.

## Context

Four styling asks for Zen Mode (`application/frontend/src/components/ZenMode.tsx` + pure draw module
`application/frontend/src/lib/zen/draw.ts`), referencing the EternalJukebox ring
(`REFERENCE/EternalJukebox/_web/_includes/go-js.html`, screenshot `~/tmp/eternal_jukebox_playback.png`):

1. **Prominent playhead cursor on the ring** — today the current beat is signaled by a slightly
   thicker annulus band (×1.8/1.35) + a thin 2px sweep line drawn from the CENTER toward the tile.
   User chose: a glow dot (radial halo + bright core) drawn ON the ring at the current beat; the
   center ray is REMOVED and the thick-band highlight is KEPT, halo layered on top.
2. **Curved jump arcs with an electricity-spark flash** — today arcs are two 3px straight polylines
   tile→center→tile. EternalJukebox draws quadratic-curve chords bowing toward the center
   (`paper.path('M x1 y1 S 450 350 x2 y2')`, screenshot: pastel curved chords). Want: one curved arc
   per jump, plus a jagged lightning flash riding the same chord in the first ~0.2s (time-based),
   after which the smooth chord lingers as short-term memory: alpha 1.0 → 0.15 over the next
   16 beats, 0.15 → 0 over the following 16 beats (see Approved decisions).
3. **Smaller ring, larger beat marks** — today radius = largest-square-fit and band thickness ≤
   TILE_MAX_DIAMETER_PX (28). Ring should be a bounded fraction of the viewport, and bands thicker
   relative to ring radius.
4. **Playback-repetition visualization: beats played repeatedly grow outward** — inner edge stays
   constant, outer edge grows with per-beat play count (EternalJukebox: `redrawTiles` →
   `newWidth = minTileWidth + tile.playCount * growthPerPlay`, capped by `maxTileWidth` with a
   global shrink factor when a tile overflows; screenshot: lumpy radial bars). Play counts must be
   maintained somewhere. The page (`application/frontend/src/app/page.tsx` ~L171-186) already
   receives `onBeatChange` per played beat — extending it to also tally counts is contract-additive
   (new optional prop, no existing consumer breaks).

All geometry lives in draw.ts already; the component is a thin host. Keep that structure: draw.ts
owns every new visual decision; ZenMode.tsx only feeds state and replays commands. Keep the
existing rendering model: beat-change bursts + a bounded fade pass, no continuous rAF loop.
Arc memory (32 beats) is sustained by the beat-change bursts themselves; the 50ms fade pass runs
only while a spark (0.2s) or glow decay (<1s) is live.

`Beat` currently has no play-count field (`application/frontend/src/lib/audio.ts` `playBeat` is
engine-internal). The engine's `onBeatChange` fires once per scheduled beat (beat cadence), so
counting at the page callback yields exactly one tally per audible playback. Note the engine
`scheduleNextBeat` fires `onBeatChange` once per beat tick — seek/crossfade paths also call it, so
counts follow what the listener hears, which is the desired "played back several times" semantics.

## Approach

Grouped by behavior; steps 1→2→3 are independent of each other except where noted; step 4's
count plumbing (4a) must land before/with its paint step (4b).

### 1. Glow-dot cursor on the ring (draw.ts + draw.ts tests)

- `draw.ts`: DELETE the center-origin sweep (moveTo(center) … lineTo(tile)); REPLACE with a glow
  dot drawn ON the ring at the current tile's angle:
  1. **Halo**: radial gradient fill (canvas `createRadialGradient`) centered at the tile point,
     inner color `palette.playhead` at full alpha → transparent, radius `band * 2.5`
     (createRadialGradient must be added to DrawTarget; gradient object is opaque to the fake ctx —
     tests assert the fill call's arc radius = band*2.5 and strokeStyle/fillStyle markers instead
     of gradient internals).
  2. **Core**: solid disk, fillStyle `palette.playhead`, radius `band * 0.7`, alpha 1.
- The thick-band highlight on the current tile STAYS (unchanged ×1.8 glow / ×1.35 reduced-motion
  multiplier + decaying alpha) — the halo dots the band's position.
- Draw order in `PAINT_FRAME`: clear → tiles → glow dot (was sweep) → arcs last. The
  `currentBeatGlowTSec` band pulse remains (unchanged behavior). No dot before the first beat
  callback (`currentIndex < 0` ⇒ no halo/core, matching today's sweep suppression).
- Headroom: with no stem, reserved headroom = base band/2 + max repetition growth (step 4):
  `MAX_RING_HEADROOM = 44/2 + 18 = 40px` constant in draw.ts, used by LAYOUT_RING; growth paints
  clamp against it.
- Tests (tiles.test.mjs): current-beat paint emits one halo fill (arc radius band*2.5, fillStyle
  marker) + one core fill (radius band*0.7); NO stroke with moveTo(center); no dot when
  currentBeat null; halo radius scales with band (assert band*2.5 relation at two densities).
  SWEEP_STEM_RATIO constant is deleted (no remaining consumer).

### 2. Curved jump arcs with electricity-spark flash (draw.ts + arcs test)

- Draw.ts arc geometry: keep endpoints exactly `tiles[fromIndex]`, `tiles[toIndex]` (spec keeps the
  #39 contract tests). Curve control point: midpoint of the two endpoints pulled toward the center
  by factor CURVE_INNER_PULL = 0.35 (quadratic curve; chord bows inward like the reference's
  `S 450 350`, whose control point sits between the endpoints and inside the ring).
- Per-jump frame, the fade is **beat-driven two-phase memory (user interjection, final)**:
  playhead order == ring order (sequential, wraps at ring end), so playback distance since a
  jump is `beatsSince = (currentPos - jump.startPos + N) % N` where `currentPos` = index of
  `currentBeatRef.current` at paint time and `jump.startPos` = index of the jump's `from` beat.
  Phases:
  - **Spark phase** (first 0.2s, TIME-based via `nowSec - eventTSec`, using the existing
    `eventTSec` stamp): jagged polyline along the chord — from endpoint A, 6 midpoints each
    offset perpendicular by LCG jitter, lineWidth 2.5, alpha 1.0, plus thin bright core
    lineWidth 1.0 alpha 0.95.
  - **Memory phase** (0.2s → 16 beats): smooth quadratic chord stroke, lineWidth 3.2,
    alpha = 1.0 − 0.85 × (beatsSince/16), i.e. exactly 15% at the 16-beat boundary.
  - **Ghost phase** (16 → 32 beats): alpha = 0.15 × (1 − (beatsSince−16)/16); gone at 32 beats.
  - **beatsSince ≥ 32**: no stroke at all (skip, don't paint at alpha 0).
  - Reduced motion: entire arc+spark suppressed (unchanged).
  - Fade pass: FADE_SECONDS (1s) still bounds the SPARK flash + glow-dot decay; the fading pass
    (50ms tick) keeps its existing stop condition (`stopAtRef` = now + FADE_SECONDS·1000). Arc
    memory needs NO interval repainting: its alpha steps are keyed to beat-change bursts (each
    `onBeatChange` repaints, 2-4Hz), so the piecewise 16/16-beat schedule updates once per beat.
    One nuance: the arc alpha changes BETWEEN beats only during the 0.2s spark — covered by the
    1s fade pass. No new timer logic beyond what exists.
  - **Tail size**: page keeps `setJumpEvents((prev) => [...prev.slice(-7), jump])`. Memory window
    is 32 beats; jumps arrive ≥8 beats apart (engine enforces beatsSinceLastJump ≥ 8, prob 0.15 ⇒
    avg ~50 beats between jumps) — worst case ~4 live arcs inside 32 beats ⇒ tail 7 suffices. KEEP 7.
- Tests (arcs.test.mjs): rewrite arc assertions. The beatsSince inputs: per jump,
  `startPos = jump.fromIndex` (a jump leaves `from` — buildZenJumps already maps beat ids →
  ring indices, so no new stamp is needed); `currentPos` = view-state field
  `currentBeatIndex: number` (index of currentBeat via the same map, −1 before first callback;
  computed in ZenMode.tsx). Contract:
  - Arc = `moveTo(tiles[from])`, `quadraticCurveTo(ctrl, tiles[to])` (lineWidth 3.2).
  - Spark phase: jagged moveTo + 5 lineTos (6-point path) only when `nowSec - eventTSec < 0.2`;
    zero polylines when ≥ 0.2; no-arc cases unchanged; reduced-motion unchanged (no arcs/sparks).
  - NEW beat-decay contract: `beatsSince = (currentBeatIndex - jump.fromIndex + N) % N`;
    alpha at beatsSince 0 = 1.0; at 8 = 1.0 − 0.85×(8/16) = 0.575; at 16 = 0.15; at 24 = 0.075;
    at 31 ≈ 0.009; at 32+ = no stroke. Assert the piecewise schedule exactly (monotone down,
    0.15 at the 16-beat boundary, zero strokes at ≥32).
  - Wrap case: jump at index 40 of 48 beats, 10 beats later current = 2 ⇒ beatsSince =
    (2−40+48)%48 = 10 ⇒ alpha = 0.469. Assert wrap math directly.
- **page.tsx bounded tail interplay**: unchanged from the analysis above (tail 7 suffices for
  ≤5 live 32-beat arcs at worst-case jump cadence). jumpEpoch stamping already correct.

### 3. Smaller ring + thicker bands (LAYOUT_RING + TILE_DIAMETER_FOR + geometry tests)

- Draw.ts `TILE_MAX_DIAMETER_PX`: raise 28 → 44 (chunkier marks; ceiling binds only on sparse
  songs).
- Draw.ts `LAYOUT_RING`: radius = `clamp(0.35 * Math.min(viewport.width, viewport.height), 64,
  box/2 - headroom)` where box = min(vw,vh) − 2·margin (approved 0.35 fraction; user rejected the
  larger 0.42 attempt in round 1 of review). At 800×800, margin 32 ⇒ radius 280 (vs ~336 today).
  Headroom reservation becomes the fixed `MAX_RING_HEADROOM = 40px` constant (band 22 + growth 18;
  see step 1) — replaces `TILE_MAX_DIAMETER_PX/2 * SWEEP_STEM_RATIO`; SWEEP_STEM_RATIO deleted.
  Center stays viewport center.
- `TILE_DIAMETER_FOR`: floor 4 → 6px; ceiling 28 → 44 (the constant above); slot cap ×0.72
  UNCHANGED — bands never deliberately overlap at any density (user decision: moderate scale).
  At 800×800 with radius 280: 450 beats ⇒ slotArc = 3.9px ⇒ band = 6px (floor binds, dense-song
  bands at the floor); 96 beats ⇒ slotArc 18.3 ⇒ band 13.2px; sparse songs grow toward 44px.
- Tests (geometry.test.mjs): radius bounds — at 800×800 margin 32, radius == 280 exactly (0.35
  fraction binds, ceiling not); radius == 280 for both portrait (390×844) and landscape (844×390)
  (same min side ⇒ same radius, centered); floor-64 case: tiny viewport 100×100 margin 0 ⇒
  radius = max(64, min(35, …)) = 64? — 0.35×100 = 35 < 64 floor ⇒ radius 64 but that leaks past
  box/2 = 50: the floor applies ONLY when it doesn't exceed the box ceiling, else radius =
  box/2 - headroom (state precedence: ceiling wins over floor, floor wins over fraction).
  `TILE_DIAMETER_FOR` tests: 6px floor at ≥900 beats; 44px ceiling on sparse; slot cap ×0.72
  preserved (density loop [12,60,450,900] asserts thickness ≤ max(6, slotArc×1.5) — at 900,
  thickness = 6 > slotArc 5.6·0.72 cap, so the loop's ceiling assertion becomes
  `thickness <= Math.max(6, slotArc * 1.5)` and the floor assertion `thickness >= 6`; the
  900-beat case exceeds the slot cap by floor binding — accepted user tradeoff, chunky marks win
  over separation at extreme density).
- `specs/zen-mode.md` line 60 (layout bullet: "largest square" → "0.35×min-side radius"), line 61
  (playhead: halo glow dot on the ring + thickened band, no center ray), line 62 (jump feedback:
  curved chord + jagged spark in first 0.2s), add play-count outward-growth bullet.

### 4. Playback repetition → outward band growth (page.tsx + ZenMode.tsx + draw.ts + tests)

- **page.tsx**: in the `createAudioBuffer` `onBeatChange` callback (page.tsx L171):
  maintain `beatPlayCountsRef: Map<number, number>` (keyed by `beat.id`), increment on each
  onBeatChange; on song load (`loadSongForPlayback`) reset to empty Map.
  Pass `beatPlayCounts: Map<number, number>` as a new OPTIONAL prop to ZenMode (default empty ⇒
  every band at base thickness — other consumers unaffected; nothing else consumes ZenMode).
- **ZenMode.tsx**:
  - new prop `beatPlayCounts?: Map<number, number>`, default `new Map()`; passed through into the
    view-state object handed to PAINT_FRAME (new field `beatPlayCounts`).
  - `beatPlayCountsRef` mirror + updated on prop change (pattern matches jumpsRef handling).
- **draw.ts**:
  - `ZenViewState` gains `beatPlayCounts?: Map<number, number>` (optional, default empty).
  - Band rendering: inner edge fixed, outer edge grows with the play count:
    `growth = min(playCount, PLAY_MAX_REPS) * PLAY_GROWTH_PX`, PLAY_MAX_REPS = 6, PLAY_GROWTH_PX = 3
    (18px max extension; approved cap: 6 reps kept on Restart, reset on new song). Inner edge stays
    at `ringRadius - baseBand/2` for ALL bands (repeated beats grow only outward — user ask).
    Implement as annulus band via ctx.arc with lineWidth = baseBand + growth centered on
    `ringRadius + growth/2` — inner edge lands at ringRadius - baseBand/2 (canvas centers the
    stroke on the given radius; keeping inner edge invariant ⇒ radius shifts by growth/2).
    Growth clamped by MAX_RING_HEADROOM (40px constant) — headroom reserved at layout time;
    18px max growth + 22px base/2 = 31px < 40 ✓ never binds in practice.
  - Current beat may ALSO be a repeated beat: glow multiplier applies on top (lineWidth computed
    base band + growth, then ×1.35/1.8 glow multiplier as today).
  - draw.ts `LAYOUT_RING` needs the headroom bound even when playCounts unknown at layout time:
    the MAX_RING_HEADROOM = 40px constant reserves worst-case at layout (growth cap 18px is the
    only variable outer extension; no stem).
- Tests (new file `application/frontend/zen-tests/repeats.test.mjs` — sibling test files exist;
  `run.mjs` picks up any `*.test.mjs`):
  - repeated beat: arc call radius = layout.radius + growth/2, lineWidth = baseBand + growth.
  - repeated beat INNER EDGE invariance: for two beats same cluster with counts 0 and 5, assert
    `arcRadius - lineWidth/2` equal to within 1e-9 (inner edges coincide).
  - playCount capped at 6 reps: count 5 vs 50 identical lineWidth (cap).
  - unpainted (no playCounts) → base geometry, identical to today.
  - spark test addition: none needed here (arcs.test.mjs covers).
- **page.tsx**: `beatPlayCountsRef` reset on song change (`loadSongForPlayback`) so a new Song
  starts fresh. Reset also on Restart? EternalJukebox keeps counts across restart — keep counts
  (jumpEpoch already handles arcs); counts on Restart are kept: a re-play of the same beat in the
  SAME song session is the very rep-growth signal the user asked for.

## Critical files & anchors

- `application/frontend/src/lib/zen/draw.ts` — all geometry/paint decisions (glow dot,
  curved/spark/memory arcs, ring fraction, band growth); every knob single-sourced here.
- `application/frontend/src/components/ZenMode.tsx` — feed `beatPlayCounts` prop +
  `currentBeatIndex` (indexById lookup of currentBeat for the arc memory fade) into the
  PAINT_FRAME view state; update the paint call (ZenMode.tsx:73-102 `paintZenCanvas` signature).
- `application/frontend/src/app/page.tsx` — new beatPlayCounts tally at `onBeatChange`
  (page.tsx:171), pass to ZenMode (page.tsx:583-592), reset on song load.
- `application/frontend/zen-tests/{geometry,tiles,arcs,repeats}.test.mjs` — update assertions to
  new geometry; new repeats suite; runner `run.mjs` picks up new files automatically.
- `specs/zen-mode.md:62` — doc touch: curved/chord arc replaces "single transient arc fading
  ~1s": describe spark (0.2s) + the 16-beat decay-to-15% + 16-beat decay-to-0 beat-driven memory,
  glow-dot cursor (line 61), layout fraction (line 60), play-count outward growth.

## Verification

1. `cd application/frontend && node zen-tests/run.mjs` — all suites pass (existing 3 updated + new
   repeats suite).
2. `cd application/frontend && npx tsc --noEmit` clean.
3. `npm run lint` clean.
4. End-to-end smoke: `npm run dev` (dev server :3000; AGENTS.md warns servers may already run —
   check :3000 free or use -p 3001), load a song (e.g. from `music/` — count_on_me.mp3),
   enter Zen Mode via the fullscreen button:
   - playhead: glowing gold halo dot on the ring at the current band (no center ray).
   - jump arcs: curved chords bowing toward the ring center; jagged spark flash in the first ~0.2s,
     then a lingering translucent chord that dims over ~16 beats and vanishes by 32.
   - ring visibly smaller (radius 0.35×min side) with visibly thicker beat marks.
   - repeated playback: sections that loop (e.g. chorus) show lumpy outward-growing bands; inner
     edge stays a clean circle; jump-probability slider at 0 → no jumps → reps accumulate fast:
     verify growth appears within ~10 beats of a chorus loop.
   - reduced-motion OS setting: no sparks/arcs, static highlight (spot-check via DevTools
     emulation); beat-count growth still renders (playback state, not motion).
5. Screenshot the ring for a visual diff against the mockup (`zen-upgrade-mockup.png`, local://)
   and reference `~/tmp/eternal_jukebox_playback.png` at an 800×800 viewport.

## Assumptions & contingencies

- Play counts live in page.tsx state (page owns playback-derived UI state per repo convention; all
  page state via hooks — AGENTS.md). Alternative (engine-internal counts + widened callback) rejected:
  would change the AudioEngine public contract and ripple into tests beyond ask.
- Spark jitter derived deterministically (LCG seeded by (from.id,to.id), per-midpoint LCG advance) —
  stable across repaints within one jump; different jumps differ. If the LCG jitter looks too
  regular on smoke (repeating zigzag pattern), a single Math.random() draw per jump PER FRAME is
  the fallback — but that re-randomizes on every fade-tick repaint (paints during the 0.2s spark),
  causing a shimmering spark — the deterministic LCG seed avoids that while still random per jump.
- The density-loop ceiling relaxation at ≥900 beats (6px floor exceeds the slot arc ⇒ tiny band
  overlap) is a deliberate deviation from the existing geometry test invariant — user chose
  "moderate" (NO slot-capped overlap), but the 6px floor still wins at ≥900-beat rings; flagged
  since it changes a previously-passing test's meaning. If overlap proves ugly on a real dense
  song, fallback: scale the floor down by slot arc (floor = min(6, slotArc)) — pre-decided.
- Reduced-motion keeps today's semantics: no arcs/sparks, static highlight; play-count growth
  STILL renders (it's playback state, not motion — and reduced-motion spec only suppresses pulse
  and arcs).
- Arc memory is BEAT-counted, assuming the ring order == playback order (sequential tiles;
  wraps handled via modulo, `currentPos − fromIndex (mod N)`). If a future change makes playback
  order deviate from ring order, beatsSince must switch to an explicit per-jump position ledger
  (a counter incremented on each onBeatChange, stored on the jump event) — identified failure
  mode with its fix, not an open question.