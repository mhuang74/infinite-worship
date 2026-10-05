# Playback Stutter Investigation & Telemetry — Spec v2

**Status:** In implementation (2026-10-05). Phase 1 build DONE (`src/lib/smoothness.ts`, `?debug` wiring on the main player, `/playtest` route with `?audio=&analysis=&p=&zen=` + `?control=element|loop`); Phase 2 DONE — instrumentation validated (incl. gap-tap stall survival with an injected 400 ms main-thread block) and the arm matrix run (A/B/C + B-zen, 720 s each; results appended below). Phase 3 Mac capture is user-assisted and pending; Phase 4 fixes gated on captures per this plan. (v1 at `specs/playback-stutter-telemetry.md` was the approved plan.)
**Source:** Spec v1 (grilling session, 2026-10-05) + external review, 2026-10-05.
**Supersedes:** `specs/playback-stutter-telemetry.md` (kept unchanged as the reviewed artifact).
**Symptom:** Audible audio glitches (dropouts/stutter) after ~5 minutes of playback; degradation worsens over the session. Observed on macOS Chrome, foreground tab, wired output, DevTools closed, Zen mode active. Periodicity unknown.

## What changed vs v1 (and why)

1. **Soundness gap in v1's premise: no suspect actually explains *monotonic* worsening.** Every in-page accumulator is bounded: `beatPlayCounts` Map ≤ N entries, `jumpEvents` ≤ 8, crossfade GainNode growth ~2 nodes per wrap (~minutes apart — negligible). Per-beat source churn is GC'd, not a growing live set. Suspect 1's "main-thread pressure grows over the session" was asserted, not derived. The progressive-degradation driver may be environmental/platform (audio-render-thread state, GC pressure history, macOS/Chrome/device) rather than in-page accumulation. v2 reframes suspect 1 as *the mechanism that converts any main-thread delay into an audible gap* (25 ms chain + 100 ms lookahead is a real fragility worth fixing regardless), while admitting the *growth* mechanism is unexplained until telemetry says otherwise.
2. **Ground truth added — on the render thread.** v1's four signals are all scheduler/graph *proxies*; nothing ties data to the actually-heard dropout. v2 measures the rendered signal in an `AudioWorkletNode` on the audio render thread (in-chain, `mainGain → worklet → destination`), posting gap events to the main thread — it survives main-thread stalls, which a main-thread analyser poller (the earlier v2 draft's shape) would not. Plus a from-the-start `MediaRecorder` capture as final arbiter. Together: the one fork that separates main-thread/scheduler causes (1/2/4) from render-thread/graph causes (3/6) and platform causes.
3. **Control conditions added — two, not one.** Without controls and an OS-interruption watch, stutter cannot be attributed to the app vs Chrome/macOS/environment. The v1-era idea of a plain `<audio>` element control only exercises the media-element pipeline, not the Web Audio render path the app uses — a clean element control leaves a platform/Web-Audio-render-thread cause unexcluded. v2 adds both: (a) a plain `<audio>` element baseline (isolates OS/device) and (b) a continuous looping Web Audio `BufferSource` through the app's own `mainGain`→destination (shares the render path, isolates scheduler/graph from render thread). Plus `AudioContext.state` transition / `interrupted` watching — a classic macOS dropout cause, invisible to v1's design.
4. **Harness fidelity fixed.** v1's `/playtest` runs without ZenMode and without `page.tsx`'s `onBeatChange` wiring — i.e., neither the Linux harness nor the Mac capture measured the *observed* configuration (symptom was Zen-mode-active). ZenMode's per-beat full-canvas repaint (~500 tiles), ~1 s post-beat 20 fps fade pass, and per-repaint `readZenPalette` forced-style-recalc were the real suspect-2 cost, not the µs-scale Map copy v1 overweighted. v2 adds a `?zen=1` arm and a main-route Zen capture.
5. **Crossfade reachability fixed.** v1's short probes could never satisfy "at least one crossfade occurs": bruno.mp3 is 222.5 s (~445 beats @ 0.5 s); crossfade triggers only at index N−16 = 429; jump weighting is backward-biased (`beats.length − candidateIndex`) so the index random-walk equilibrates around ~N/3 and may never reach 429; even a pure linear walk needs ~215 s > the 2–3 min window. v2 exposes `?p=` and uses a dedicated `p=0` arm.
6. **Headless confounds called out.** Chrome throttles timers in non-visible pages with ~5 min onset — the *same onset as the symptom*; an unmitigated headless run would manufacture a false positive. Headless also uses a null/silent output sink, so Linux runs are valid for instrumentation validation and main-thread signals only, **not** audio-glitch reproduction.
7. **Two code suspects v1 missed** (found by review): end-of-loop `===` fragility (jump past N−16 → no crossfade → `setTimeout(restart, 3000)` → guaranteed ~3 s dead air) and scheduler-chain leak (`seekToTime`/`jumpToBeat` spawn extra permanent 25 ms chains).
8. **`performance.memory` caveat noted** (bucketized, lazily updated — a flat line is not evidence of no growth) and drift/late-start interpretation limits stated up front.

## Settled decisions

| Decision | Value |
|---|---|
| Reproduction strategy | Headless Chrome harness first (Linux, this box) for instrumentation validation + main-thread signals → Mac capture for audio-glitch reproduction (headless has a null output sink) |
| Symptom character | Audible glitches (not just visual jank) — audio-scheduler / audio-graph / main-thread-starvation / **platform-or-device** class; attribution open until ground-truth tap says otherwise |
| Test data | Hand-built beat grid over `music/bruno.mp3` (local harness run); an already-`ready` R2 song's `audio_url`/`analysis_url` for the Mac capture |
| Harness shape | Separate `/playtest` debug route; `?audio=&analysis=&p=&zen=` URL params; **`?zen=1` mounts real ZenMode** so the observed configuration is measurable |
| Telemetry signals | (1) scheduling drift, (2) late starts + `outputLatency`/`baseLatency`, (3) long tasks + GC pressure, (4) live audio-node counts, (5) **ground-truth rendered-signal gap detection**, (6) **`AudioContext` state transitions / OS interruptions** |
| Control conditions | Two controls sharing the same audio and platform: (a) plain `<audio>` element — media-element pipeline baseline, isolates OS/device; (b) continuous Web Audio `BufferSource` looping the whole file through `mainGain`→destination — shares the app's render path minus the scheduler/graph/Zen, isolates scheduler/graph. Plus `p=0` and zen-on/zen-off arms on the harness |
| Telemetry output | In-page ring buffer + `window.__telemetry` for CDP extraction (headless) + Download JSON button (Mac transport) |
| Telemetry lifetime | Kept permanently behind a `?debug` flag (user decision — exception to cleanup rule) |
| Capture cadence | Short 2–3 min probes to validate instrumentation, then the arm matrix (below), 10–15 min each |
| Fix scope | Fix all telemetry-confirmed causes in-session, with before/after telemetry proof; includes `page.tsx`/ZenMode if implicated; includes the two review-added code defects if telemetry trips over them |

## Known constraints

- `bruno.mp3` (222.5 s, 4.2 MB, `music/`) is gitignored (`*.mp3`) — never commit it. Headless run serves it (and the hand-built JSON) from a **dedicated throwaway server on a fresh port** (never restart a possibly-running dev server; repo gotcha); if the dev server's `public/` dir is used for the copy, remove the copy after the run.
- The Mac capture runs against a Vercel preview deploy of the branch; audio/analysis come from R2 URLs of an existing `ready` song (listed via `GET /api/songs`), since the mp3 can't ship in the deploy. Note: `/playtest` (incl. both control modes) is then publicly reachable on the preview/prod domain — acceptable (all modes require explicit URLs to do anything), recorded here deliberately.
- No test framework exists in the frontend; QA signal for prod-code changes is `npm run lint` + `npx tsc --noEmit` + real headless-Chrome observation. Harness may add its own throwaway checks.
- Web Audio user-gesture: `AudioContext` needs `resume()`; headless uses `--autoplay-policy=no-user-gesture-required`.
- **Headless flags (mandatory for Phase 2 long runs):** `--autoplay-policy=no-user-gesture-required`, `--headless=new`, `--disable-background-timer-throttling`, `--disable-features=IntensiveWakeUpThrottling`; keep the target page foregrounded (single-tab, no other focus). Timer throttling in non-visible pages has a ~5 min onset — identical to the symptom's onset; skipping these flags would manufacture a false positive that "confirms" suspect 1.
- **Headless output sink is null/silent:** Linux runs validate instrumentation and measure main-thread signals; they cannot reproduce or rule out audible output-path behavior. Audio-glitch reproduction happens only on the Mac (Phase 3).
- **`performance.memory` is bucketized and lazily updated** (privacy buckets, coarse steps — possibly only a few distinct values over 10–15 min). It is a tertiary signal. A flat memory line is NOT evidence of absence of growth; node counts and late-start trends are the stronger growth evidence. `longtask` attribution already captures GC pauses.

## Suspects ranked (from code audit + review)

1. **25 ms `setTimeout` scheduling chain with only 100 ms lookahead** (`audio.ts` `scheduleNextBeat`, reschedule at its tail). Any main-thread busy period ≥ lookahead delays beat scheduling; beats scheduled after their start time → audible gaps. **Reframed: this is the *amplifier* that converts any main-thread delay into an audible gap — a real fragility worth fixing regardless — but v1's "main-thread pressure grows over the session" is asserted, not derived. The monotonic *growth* mechanism is unexplained by any in-page accumulator (see "What changed" #1); it may be environmental.** Prime *fragility*; unproven *cause*.
2. **Per-beat React state churn + ZenMode repaint per beat** (`page.tsx` `onBeatChange`: `new Map(prev)` per scheduled beat — µs-scale, itself negligible — **but it triggers**: full ZenMode canvas repaint per beat (~500 tiles), ~1 s 20 fps fade pass after each beat/jump, `readZenPalette` forced style recalc per repaint (`ZenMode.tsx` `repaint`/`paintZenCanvas`, beat-change and fade-pass effects). Steady per-beat cost from t=0; whether cost *grows* with session is exactly what the longtask drift + GC signals must answer. Feeds suspect 1 when it does.
3. **Crossfade `GainNode`s never disconnected** (`scheduleCrossfade` fades). One connected pair leaks per loop pass; ~32 crossfade BufferSources never stopped/disconnected. Render-thread cost accumulates per wrap — ~2 nodes/wrap is quantitatively small, so treat as low-magnitude unless node-count telemetry says otherwise.
4. **O(N) `beats.indexOf`/`beats.find` per jump candidate** (`getJumpCandidate`). Multi-ms long-task spike on each jump for large beat arrays; fires on ~15 % of eligible beats (≥8 apart) → quasi-periodic.
5. **Per-beat `console.log`** (`scheduleNextBeat` body). Measurable only with DevTools open (was closed — low prior; the Mac capture must run DevTools-free; hence Download-JSON transport).
6. **Finished `BufferSourceNode`s never explicitly `disconnect()`ed** (`playBeat`). Relies on GC; node churn ~60–300/min. Could interact with macOS Chrome GC pauses.
7. **NEW — end-of-loop `===` fragility:** crossfade triggers only at `currentBeatIndex === beats.length − 16`. A jump landing past N−16 skips the crossfade entirely → playback runs to the last beat → `isPlaying = false` + `setTimeout(restart, 3000)`: **guaranteed ~3 s of dead air**, recurring per wrap whenever it happens. Audible, mechanical, unlogged. Telemetry must count this path; fix list includes `>=`-based triggering with immediate crossfade.
8. **NEW — scheduler-chain leak:** `seekToTime` and `jumpToBeat` call `scheduleNextBeat()` while the existing 25 ms chain is still pending — each call spawns a permanent extra chain; in Zen mode every double-tap-on-tile adds one. Chains share state so they mostly no-op, but wake-up pressure grows with user interaction. Telemetry counts live chains.
9. **NEW — platform/environment (open hypothesis, not code):** macOS Chrome audio-render thread, OS-initiated output interruption (`AudioContext.state === 'interrupted'`), device/thermal state. Invisible to every in-page proxy; the ground-truth tap + context-state watch + the two controls (element: OS/device via the media pipeline; loop: Web Audio render path minus app code) exist to separate this from the in-page suspects.

## Implementation plan (build phase)

### Phase 1 — Telemetry (`/playtest` route + `?debug` flag on main player)

1. New route `src/app/playtest/page.tsx`:
   - Parses `?audio=&analysis=&p=&zen=`; fetches both, decodes audio, renders via `AudioEngine` directly (bypass `loadSongForPlayback`'s R2 coupling).
   - `?p=<0..1>` maps to `engine.setJumpProbability` (engine API already exists); default = engine default (0.15).
   - **`?zen=1` mounts the real `ZenMode` component** (same props the main route passes: `beats`, `currentBeat`, `jumps`, `jumpEpoch`, `beatPlayCounts`, `isPlaying`, plus the toggle/jump/exit handlers wired to the engine) so the observed Zen-mode load is measurable in the harness. Default off for isolation arms.
   - Starts playback without other UI chrome; minimal status line + **Download JSON** button.
   - Accepts a beat-grid JSON in the shape `src/lib/types.ts` defines (`segments: Beat[]` with `id/start/duration/cluster/segment/jump_candidates`).
   - Exposes `window.__telemetry` (getter returning the current ring-buffer snapshot) for CDP extraction; Download JSON stays the Mac transport.
2. Telemetry module (new `src/lib/smoothness.ts`, wired only when `?debug` present):
   - **Drift:** in `scheduleNextBeat`, record `(nextBeatTime − audioContext.currentTime)` per scheduled beat (attach point: the `playBeat` call in `scheduleNextBeat`). Track trend over time.
   - **Late starts:** count beats where scheduled start ≤ `currentTime` at `.start()` call; sample `audioContext.outputLatency`/`baseLatency` every ~1 s.
   - **Jank/GC:** `PerformanceObserver` for `longtask` (>50 ms, with attribution); `performance.memory` snapshots every ~1 s (Chrome-only; guard; **tertiary signal — see caveat in Known constraints**).
   - **Node accounting:** in `playBeat`, register each created `BufferSourceNode` with an `onended` handler that decrements a live-node refcount — **observation only, no `disconnect()`** (disconnecting during instrumentation would silently fix suspects 3/6 and mask the accumulation signal). Count crossfade `GainNode` pairs on creation (`scheduleCrossfade`), again without disconnecting. Actual cleanup is Phase 4 only, after before-fix captures.
   - **Ground truth (new) — render-thread RMS, NOT a main-thread poller:** a main-thread poller (rAF / `setInterval`) goes blind exactly during main-thread stalls — the very class it's meant to detect: while the thread blocks ~100–150 ms, the poller is blocked too, and on resume the analyser's ~2048-sample last-window buffer no longer shows the gap, yielding a false "signal continuous ⇒ render-thread/OS" conclusion that would misclassify suspects 1/2/4. So: an `AudioWorkletNode` inserted **in-chain** (`mainGain → worklet → destination`, replacing the direct `mainGain → destination` connection — a parallel tap would double the audible signal) computes per-quantum RMS on the audio render thread and posts gap events (window below a near-silence threshold **during nominal playback** — engine `isPlaying`, not inside a legitimate inter-beat gap of the source material) to the main thread via `port.postMessage`; the main thread only timestamps and buffers what the worklet already observed. Each gap: onset/offset timestamps, duration, plus what the scheduler-side signals showed at the same moment. This localizes the fault: rendered-signal gap present ⇒ scheduler/graph side (suspects 1/2/4/3); signal continuous while glitches are heard on the Mac ⇒ render-thread/device/OS side (suspect 9). Limitation: the tap sees the graph up to the destination, not the physical output — it separates graph-internal from graph-downstream, not from all OS behavior. Belt-and-braces: also wire a `MediaStreamAudioDestinationNode → MediaRecorder` recording of the same chain **from the start** of every debug run (not a Phase-4 escalation), retained in memory (bounded, e.g. ring of last N minutes) or discarded after each run's JSON confirms the worklet path — it is the final arbiter when in-page signals and hearing disagree.
   - **`AudioContext` state watch (new):** log every `context.state` transition via `onstatechange` (and the non-standard-but-present `interrupted` state on macOS Safari/Chrome if observed) with timestamps; log `context.resume()` calls and their durations. An OS-initiated interruption is a classic macOS dropout cause and invisible to every other signal.
   - **Path counters (new):** count (a) restart-without-crossfade events (suspect 7's dead-air path — hook where `isPlaying` is set false + the 3000 ms restart timer fires), (b) live scheduler-chain count (suspect 8 — increment on each `scheduleNextBeat` entry that isn't from the timer chain's own re-arm; simplest: count chains created from `seekToTime`/`jumpToBeat`/`play` and log total), (c) crossfade count, (d) jump count.
   - Also record per-beat `onBeatChange` callback execution time and inter-beat interval jitter.
   - All samples → bounded ring buffer (e.g. last ~30 min at per-beat + 1 Hz resolution); Download JSON button serializes `{song, session meta, arms (p/zen), signals}`; `window.__telemetry` returns the same shape.
3. `?debug` gating on the main player route uses the same telemetry module (kept permanently per user decision; inert without the flag).
4. **Controls — two routes, used on the Mac only** (an `<audio>` element control alone exercises only the media-element pipeline, not the Web Audio render path the app uses; a clean element control leaves a platform/Web-Audio-render-thread cause unexcluded):
   - **`src/app/playtest/control/page.tsx` (or `?control=element` on `/playtest`):** a plain `<audio>` element playing the same `audio_url`. Carries only the main-thread telemetry (longtask, memory, context-state watch) + user glitch notes — NOT the render-thread gap tap: routing the element through Web Audio (`createMediaElementSource` → worklet) would change what this control tests (media-element pipeline). Isolates OS/device/environment.
   - **`?control=loop` on `/playtest`:** a single continuous Web Audio `BufferSource` (`loop = true`) playing the whole decoded file through the app's `mainGain` → (worklet tap when `?debug`) → destination — no scheduler, no per-beat sources, no Zen. Shares the app's render pipeline and context; isolates the scheduler/graph (app code) from the Web Audio render thread + output path. Carries the full telemetry module (render-thread gap tap, context-state watch, longtask, memory).

### Phase 2 — Headless probes (Linux, this box) — instrumentation validation + main-thread signals only

**Not audio-glitch reproduction** (null output sink — see Known constraints).

1. Dedicated throwaway static server on a fresh port serving `music/bruno.mp3` + hand-built beat grid JSON (do not touch any running dev server).
2. Beat-grid design (this determines whether the loop ever wraps — see "What changed" #5):
   - ~0.5 s beats over the decoded 222.5 s duration; a few clusters.
   - `jump_candidates` per repo semantics (≥16-beat reach), **spread so the walk visits both early and late indices**; note the engine's weighting (`beats.length − candidateIndex`) is backward-biased — the random walk equilibrates around ~N/3, so do not rely on jumps to reach the wrap point.
   - The **`p=0` arm is the wrap/crossfade guarantee**: linear playback reaches index N−16 in ~215 s, so any probe that must observe a crossfade runs ≥4 min.
3. Headless Chrome (flags per Known constraints) opens `/playtest?audio=…&analysis=…&debug=1&p=<…>&zen=<0|1>`; harness script (CDP: `Runtime.evaluate` against `window.__telemetry`) samples periodically and dumps the final JSON locally.
4. **Short probes (2–3 min, any arm):** validate all signals populate — drift, late starts, longtask observer, node counts, worklet gap tap (including its main-thread-stall survival: inject a deliberate ~150 ms main-thread block mid-probe and confirm the gap still registers), context-state watch, path counters; jumps occur; ring buffer drains to `window.__telemetry`/Download JSON. Crossfade validation is explicitly deferred to the `p=0` long arm (v1's 2–3 min criterion was unreachable).
5. **Arm matrix (10–15 min each, ≥1 run each):**

| Arm | p | zen | What it isolates |
|---|---|---|---|
| A | 0.15 | 0 | Realistic jump walk; scheduler + jump-path longtasks (suspects 1/4) |
| B | 0 | 0 | Pure linear: wrap + crossfade every ~song length; crossfade/node accumulation (suspects 3/6/7) isolated from jump-path noise |
| C | 0.15 | 1 | Zen repaint load on top of the realistic walk (suspect 2 feeding 1) |

   Compare A vs C for zen cost; B vs A for wrap-path costs. Add B-zen if A vs C shows meaningful zen cost.
6. **Long-run read-outs:** drift trending toward 0, late-start count rising, longtask clusters correlating with jump/crossfade/repaint events, live-node count climbing, restart-without-crossfade counter > 0 (suspect 7), chain count > 1 (suspect 8), worklet gap-tap windows, context-state transitions. **Interpretation limits:** scheduler-side signals are proxies — a clean Linux profile does NOT rule out a Mac-side cause (null sink, different GC/thread behavior); it validates instrumentation and measures main-thread effects only.

### Phase 3 — Mac capture (user-assisted) — the reproduction phase

1. Push branch → Vercel preview URL.
2. **Mac arms, tiered** (DevTools closed — matches original observation, keeps per-beat `console.log` out of the measurement; 10–15 min each):
   - **Essential (run always — 2 runs ≈ the v1 "1–2 runs" budget):**
     - **E1 — Main route, Zen mode active, normal p, `?debug`** — the literal symptom environment; requires the `?debug` flag on the main player (Phase 1 item 3) with a `ready` song loaded through the normal library flow.
     - **E2 — element control** (`/playtest?control=element&audio=<ready song's audio_url>&debug=1`): plain `<audio>`, same audio, same platform. Stutters ⇒ environment implicated (OS/device/media pipeline), app code exonerated; clean ⇒ app or Web Audio render path still suspect (element control alone doesn't cover the app's render path).
   - **Conditional (run only on the stated trigger):**
     - **C1 — loop control** (`/playtest?control=loop&audio=<audio_url>&debug=1`): single looping Web Audio BufferSource through the app's `mainGain`→destination. Trigger = E2 clean and E1 glitching — the decisive fork between scheduler/graph (clean C1 + glitching E1 ⇒ in-app) and Web Audio render thread/output path (glitching C1 ⇒ platform render path, app code exonerated). Also run if E2 stutters and the question is whether the Web Audio path is a victim too.
     - **C2 — `/playtest?audio=<audio_url>&analysis=<analysis_url>&debug=1&p=0.15&zen=1`** (harness, realistic p, zen): trigger = in-page signals in E1 worth isolating from library-flow/main-route noise.
     - **C3 — `/playtest?…&p=0&zen=1`** (wrap/crossfade isolation on real hardware): trigger = C2 ran and wrap-path signals (suspects 3/6/7) look implicated.
   Tiers keep the capture executable by one user (essential pair first) while preserving the discriminating power; conditional arms escalate only when the data asks for them.
3. User clicks Download JSON after each run, hands the files back.
4. Each run records: audible glitches noticed? (yes/no, rough times — user notes, cross-checked against worklet gap-tap events and context interruptions afterward).

### Phase 4 — Diagnosis & fixes

- Cross-correlate signals across the full arm matrix (Linux + Mac controls). The decisive forks:
  - Worklet gap-tap events present when glitches heard ⇒ scheduler/graph side; absent ⇒ render-thread/device/OS side.
  - Element control (E2) stutters ⇒ environmental (OS/device/media pipeline); stop blaming app code, report to user with evidence.
  - E2 clean + loop control (C1) stutters ⇒ Web Audio render thread / output path on this platform — app code exonerated, platform-level finding.
  - Both controls clean + E1 (main-route Zen) glitching ⇒ in-app (scheduler/graph); proceed down the suspect fixes.
  - `AudioContext` `interrupted`/state transitions align with glitches ⇒ OS interruption; fix is UX (resume/restart-on-state-change), not DSP.
  - Drift/late-start trends rising ⇒ suspect 1's amplifier confirmed (fix regardless — see below).
- Fix only telemetry-confirmed causes, PLUS these two regardless-of-attribution robustness fixes (they are mechanical defects, confirmed by code, cheap to fix, and logged by path counters):
  - Scheduler: widen lookahead and/or move scheduling off a 25 ms `setTimeout` chain; reschedule catch-up so late scheduling can't produce gaps. (Fix even if telemetry is inconclusive — the 100 ms lookahead + 25 ms chain is a proven fragile shape.)
  - End-of-loop: trigger crossfade at `>= beats.length − 16` (with immediate crossfade from the actual current index) so a jump past the trigger point can't produce the 3 s dead-air restart (suspect 7).
- Candidates by suspect, applied **only after before-fix captures are complete** (baselines must observe the unfixed accumulation for 3/6):
  1. page.tsx/ZenMode: stop copying the whole `beatPlayCounts` Map per beat (incremental update or refs for consumers that don't re-render); if the longtask data shows the repaint (not the Map copy) is the cost, address repaint cost (batching, skipping fade passes) — design per data.
  2. Crossfade: `disconnect()` fade gains and stop/disconnect crossfade sources when the fade completes (track via `onended`/`setTimeout` at fade end).
  3. Jump selection: precompute beat index/id maps once at engine construction; replace `indexOf`/`find` with O(1) lookups.
  4. Node hygiene: explicit `disconnect()` in `onended` for all per-beat sources (also the telemetry hook's natural home).
  5. Scheduler-chain leak: guard `seekToTime`/`jumpToBeat`/`restart` against spawning a second timer chain (chain token/epoch cancel).
- Verify each fix with before/after long-run telemetry from the headless harness (arms A/B/C) **and** one Mac confirmation run for any fix that targeted a Mac-reproduced signal; lint + `tsc --noEmit`; smoke the real dev server surface.
- If the Mac still hears glitches with clean in-page telemetry (no tap gaps, no state interruptions) and both controls clean — i.e., the app is not exonerated but no in-page signal localizes it: retrieve the from-the-start `MediaRecorder` capture (Phase 1, belt-and-braces) and listen to the actual graph output around the user-reported glitch times; report platform-level findings to the user rather than blind-fixing.
- Update this spec's status and (if behavioral changes land) the relevant docs per repo conventions.

## Out of scope

- Worker-side analysis changes (no evidence analysis quality drives the stutter).
- Test framework introduction for the frontend.
- ZenMode visual design changes (only its per-beat repaint cost as a *contributor*, if telemetry implicates it).
- Fixing Chrome/macOS/platform-level causes if the control run implicates them (report with evidence instead).

## Phase 2 results (2026-10-05, this box, headless Chrome — main-thread signals only)

Environment: HeadlessChrome/154 (`google-chrome` headless-new), flags per Known constraints; throwaway static
server on :39471 serving `music/bruno.mp3` + hand-built grid (443 beats × 0.5 s, bidirectional
jump candidates, beat 0 at file t=1.0 s to skip the file's 0.63 s leading silence); Next dev
server on :3000; probe script drove `window.__telemetry` via Playwright CDP.

### Instrumentation validation (short probes, 30–60 s)

- All signals populate: drift per beat, late starts, `longtask` observer (0 in short probes,
  fires when a loop-control `decode` stalls main thread), node refcount, 1 Hz samples
  (memory/outputLatency/baseLatency/state), context watch, path counters, ring buffer drains to
  `window.__telemetry`.
- **Gap-tap stall survival: confirmed.** A deliberate 400 ms main-thread block mid-probe produced
  exactly one worklet gap event (`durationSec 0.027`, `stallOverlapped: true`) and two late
  starts (`drift −0.028`) — the render-thread tap saw the audible gap the scheduler missed, and
  the main-thread stall-watch annotated it. A 150 ms block (inside the 100 ms lookahead) produced
  NO gap — consistent with the 25 ms chain recovering inside lookahead.
- Gap arming: tap only counts silence after the first scheduled beat (`armAt`); pre-playback
  silence is not reported. (`gaptap.armed` event logged.)
- `beatCbMs`: measured via start/end marks around the page's `onBeatChange`; p50 0.1 ms, p99
  0.3–0.5 ms — the callback itself is µs-scale, as v2 predicted; the cost it *triggers*
  (repaint) shows in later frames, not in the callback.
- Test-data artifacts found and handled: bruno's 0.63 s leading silence read as a 0.56 s "gap"
  when beat 0 sat on it (grid moved to t=1.0 s); bruno has a quiet stretch at file 213.7–214.1 s
  that reads as a ~0.38 s gap every wrap (see arm B).

### Arm matrix (720 s each)

| Arm | beats | late >5 s | longtasks | renderGaps | mem first→last | nodes last | chains max | restartNoXf | extraChains |
|---|---|---|---|---|---|---|---|---|---|
| A p=0.15 | 1442 | 0 | 0 | 0 | 34.5→33.2 MB | 2 | 1 | 0 | 1 (play) |
| B p=0 | 1490 | 2 | 0 | 3 | 34.5→33.0 MB | 1 | 1 | 0 | 4 (3× wrap) |
| C p=0.15 zen=1 | 1441 | 0 | 0 | 0 | 36→40.1 MB | 2 | 1 | 0 | 1 (play) |
| B-zen p=0 zen=1 | 1489 | 2 | 0 | 3 | 37.5→35.7 MB | 1 | 1 | 0 | 4 (3× wrap) |

Read-outs:

**B-zen deviation from plan:** spec line 101 says "Add B-zen if A vs C shows meaningful zen
cost" — the A-vs-C comparison showed none (beatCb p99 0.4 vs 0.5 ms, zero longtasks, memory
slope ≈ 0 MB/min in C), so B-zen was NOT triggered by that criterion. It was run anyway (one
extra 12-min pass) as a cheap control for the wrap path under repaint load, since the p=0 arm
exercises crossfades the p=0.15 walk under-weighted; its results matched B exactly and are
reported in the matrix below.

1. **Drift does NOT trend toward 0 on Linux:** first-30 ≈ 0.082–0.084 s, last-30 ≈ 0.086–0.088 s
   across arms — the scheduler rides the 100 ms lookahead top consistently for 12 min; no
   degradation of scheduling health on this platform. Late starts: only the first beat (arm A/C)
   and the crossfade resume boundary (arm B, drift −0.003/−0.001 — sub-frame, likely the
   25 ms-timer granularity of the crossfade resume; audibly negligible).

2. **Zero longtasks in 4×12 min, including zen=1 arms.** On this box the ZenMode per-beat repaint
   (~500-tile canvas + fade pass) does NOT produce >50 ms main-thread tasks. (V8 flags off in
   prod build could differ; headless dev build is what we can run here.)
3. **Node accumulation: none.** Per-beat sources are GC'd (`nodesCreated ≈ nodesEnded` throughout;
   liveNodes ≤2 steady-state). At each wrap, liveNodes spikes to 32 (the crossfade's 32 fade-leg
   sources) and decays to 1 over ~8 s — bounded, no per-wrap residue over 3 wraps
   (`crossfadeGainPairs: 3`, nodes back to 1). Suspects 3/6 show NO accumulation signal here.
4. **Scheduler-chain leak (suspect 8):** `extraChains` = 1 per arm (the initial `play()`); arm B's
   +3 = the 3 crossfade resume chains (counted by design). `liveChains` never exceeded 1 in any
   1 Hz sample: the extra chains from seek/jump DO spawn, but they exit by the next tick (shared
   state no-ops), so the steady-state wake-up pressure does NOT grow on these arms. No
   double-tap jumps were exercised (no user); `jumpToBeat` spawns are counted but unexercised.
5. **Restart-without-crossfade (suspect 7): 0 in all arms.** With this grid the walk never landed
   past N−16 in arm A/C (backward-biased weighting kept indices low, jumps=105/97), and arm B
   hits the crossfade trigger exactly. The defect path exists in code (review-confirmed) but was
   NOT observed in 4×12 min; the `>=`-trigger fix remains justified as a robustness fix, and the
   counter is in place to catch it on the Mac.
6. **Render-gap tap:** arm A/C zero gaps; arm B's 3 gaps align exactly with the 3 wraps and with
   bruno's file-quiet stretch at 213.7–214.1 s (verified with ffprobe per-frame RMS) — source
   material, not graph dropouts. `AudioContext` state: `running` throughout, zero transitions,
   zero `interrupted` (Linux headless; the macOS watch is the one that matters).
7. **Memory:** flat/declining on non-zen arms; arm C (zen) +4.1 MB over 12 min with 99 distinct
   bucket values — small but the only positive trend in the matrix; tertiary signal only (bucketed,
   lazily updated), and 4 MB/12 min is nowhere near a dropout mechanism by itself.

**Bottom line for Phase 3:** on Linux/headless the main-thread scheduler and graph show NO
degradation over 12-minute sessions in any arm — consistent with v2's reframing that the growth
mechanism (if in-page at all) is not visible in scheduler/graph proxies here. The Mac capture
(E1/E2 + conditionals) carries the attribution burden: ground-truth tap vs user-heard glitches,
context interruptions, and the two controls.
