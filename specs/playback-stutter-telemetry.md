# Playback Stutter Investigation & Telemetry — Spec

**Status:** Approved plan, not yet implemented.
**Source:** Grilling session, 2026-10-05.
**Symptom:** Audible audio glitches (dropouts/stutter) after ~5 minutes of playback; degradation worsens over the session. Observed on macOS Chrome, foreground tab, wired output, DevTools closed, visualization (Zen mode) active. Periodicity unknown.

## Settled decisions

| Decision | Value |
|---|---|
| Reproduction strategy | Headless Chrome harness first (Linux, this box) → Mac capture second via Vercel preview deploy |
| Symptom character | Audible glitches (not just visual jank) — audio-scheduler / audio-graph / main-thread-starvation class |
| Test data | Hand-built beat grid over a real mp3 (local harness run); an already-`ready` R2 song's `audio_url`/`analysis_url` for the Mac capture |
| Harness shape | Separate `/playtest` debug route; takes `?audio=<url>&analysis=<url>` URL params |
| Telemetry signals | (1) scheduling drift, (2) late starts + `outputLatency`/`baseLatency`, (3) long tasks + GC pressure, (4) live audio-node counts |
| Telemetry output | In-page ring buffer + Download JSON button (Mac transport) |
| Telemetry lifetime | Kept permanently behind a `?debug` flag (user decision — exception to cleanup rule) |
| Capture cadence | Short 2–3 min probes to validate instrumentation, then 1–2 runs of 10–15 min |
| Fix scope | Fix all telemetry-confirmed causes in-session, with before/after telemetry proof; includes `page.tsx` if implicated |

## Known constraints

- `bruno.mp3` (4.2 MB, `music/`) is gitignored (`*.mp3`) — never commit it. Headless run serves it (and the hand-built JSON) from the local dev server via the URL params.
- The Mac capture runs against a Vercel preview deploy of the branch; audio/analysis come from R2 URLs of an existing `ready` song (listed via `GET /api/songs`), since the mp3 can't ship in the deploy.
- No test framework exists in the frontend; QA signal for prod-code changes is `npm run lint` + `npx tsc --noEmit` + real headless-Chrome observation. Harness may add its own throwaway checks.
- Web Audio user-gesture: `AudioContext` needs `resume()`; headless uses `--autoplay-policy=no-user-gesture-required`.

## Suspects ranked (from code audit)

1. **25 ms `setTimeout` scheduling chain with only 100 ms lookahead** (`src/lib/audio.ts` L116–177, reschedule at L176). Any main-thread busy period delays beat scheduling; beats scheduled after their start time → audible gaps. Main-thread pressure grows over the session → degradation matches. **Prime suspect.**
2. **Per-beat Map copy + React re-render** (`src/app/page.tsx` L165–178: `new Map(prev)` per scheduled beat, consumers incl. ZenMode canvas repaint per beat). Steady allocation/render pressure from t=0; cost grows with session. Feeds suspect 1.
3. **Crossfade `GainNode`s never disconnected** (`audio.ts` L184–187; `scheduleCrossfade` L179–226). One connected pair leaks per loop pass; also ~32 crossfade BufferSources never stopped/disconnected. Audio-render-thread cost accumulates — matches *audible* degradation.
4. **O(N) `beats.indexOf`/`beats.find` per jump candidate** (`audio.ts` L241–276, `getJumpCandidate`). Multi-ms long-task spike on each jump for large beat arrays; only fires on ~15% of eligible beats (≥8 apart) → quasi-periodic.
5. **Per-beat `console.log`** (`audio.ts` L141–146). Measurable only with DevTools open (was closed — low prior, but the Mac capture must run DevTools-free; hence Download-JSON transport).
6. **Finished `BufferSourceNode`s never explicitly `disconnect()`ed** (`audio.ts` L228–234, `playBeat`). Relies on GC; node churn rate ~60–300/min. Could interact with macOS Chrome GC pauses.

## Implementation plan (build phase)

### Phase 1 — Telemetry (`/playtest` route + `?debug` flag on main player)

1. New route `src/app/playtest/page.tsx` (or `playtest` under the app dir):
   - Parses `?audio=&analysis=`; fetches both, decodes audio, renders via `AudioEngine` directly (bypass `loadSongForPlayback`'s R2 coupling).
   - Starts playback without UI chrome; shows a minimal status line + **Download JSON** button.
   - Accepts a beat-grid JSON in the same shape `src/lib/types.ts` defines (`segments: Beat[]` with `id/start/duration/cluster/jump_candidates`).
2. Telemetry module (new `src/lib/smoothness.ts`, wired only when `?debug` present):
   - **Drift:** in `scheduleNextBeat`, record `(nextBeatTime - audioContext.currentTime)` per scheduled beat (attach point `audio.ts` L138). Track trend over time.
   - **Late starts:** count beats where scheduled start ≤ `currentTime` at `.start()` call; sample `audioContext.outputLatency`/`baseLatency` every ~1 s.
   - **Jank/GC:** `PerformanceObserver` for `longtask` (>50 ms); `performance.memory` snapshots every ~1 s (Chrome-only; guard).
   - **Node accounting:** in `playBeat`, register each created `BufferSourceNode` with an `onended` handler that decrements a live-node refcount — **observation only, no `disconnect()`** (disconnecting during instrumentation would silently fix suspects 3/6 and mask the accumulation signal in the capture). Track live count; count crossfade `GainNode` pairs on creation (`scheduleCrossfade`), again without disconnecting. Actual cleanup is Phase 4 work only, applied after the before-fix captures are done.
   - Also record per-beat `onBeatChange` callback execution time and inter-beat interval jitter.
   - All samples → bounded ring buffer (e.g. last ~30 min at per-beat + 1 Hz resolution); Download JSON button serializes `{song, session meta, signals}`.
3. `?debug` gating on the main player route uses the same telemetry module (kept permanently per user decision; inert without the flag).

### Phase 2 — Headless probes (Linux, this box)

1. Serve `music/bruno.mp3` + hand-built beat grid JSON from a throwaway static server or the dev server's public dir.
2. Generate the beat grid: regular ~0.5 s beats over the decoded duration, a few clusters, `jump_candidates` per repo semantics (≥16-beat reach), so jumps and crossfades occur.
3. Headless Chrome (`--autoplay-policy=no-user-gesture-required`, `--headless=new`) opens `/playtest?audio=…&analysis=…&debug=1`; harness script (CDP or the browser tool) waits N minutes, then triggers the JSON download and dumps it locally.
4. **Short probes (2–3 min)**: validate all four signals populate, jumps and at least one crossfade occur, ring buffer drains to JSON.
5. **Long runs (10–15 min)**: look for — drift trending toward 0, late-start count rising, long-task clusters correlating with jump/crossfade events, live-node count climbing, `performance.memory` heap growth.

### Phase 3 — Mac capture (user-assisted)

1. Push branch → Vercel preview URL.
2. User opens `previewURL/playtest?audio=<ready song's audio_url>&analysis=<analysis_url>&debug=1`, plays 10–15 min, clicks Download JSON, hands the file back.
3. Capture must be DevTools-closed (matches original observation; keeps per-beat `console.log` out of the measurement).

### Phase 4 — Diagnosis & fixes

- Cross-correlate signals to pin cause(s) from the suspect list; compare Linux-harness vs Mac capture profiles.
- Fix only telemetry-confirmed causes; candidates by suspect:
  1. Scheduler: widen lookahead and/or move scheduling off a 25 ms `setTimeout` chain; ensure late-scheduling can't produce gaps (reschedule catch-up).
  2. page.tsx: stop copying the whole `beatPlayCounts` Map per beat (incremental update or refs for consumers that don't re-render).
  3. Crossfade: `disconnect()` fade gains and stop/disconnect crossfade sources when the fade completes (track via `onended`/`setTimeout` at fade end). **Apply only after before-fix captures are complete** — the baseline runs must observe the unfixed accumulation (suspects 3/6).
  4. Jump selection: precompute beat index/id maps once at engine construction; replace `indexOf`/`find` with O(1) lookups.
  5. Node hygiene: explicit `disconnect()` in `onended` for all per-beat sources (also the telemetry hook's natural home).
- Verify each fix with before/after long-run telemetry from the headless harness; lint + `tsc --noEmit`; smoke the real dev server surface.
- Update this spec's status and (if behavioral changes land) the relevant docs per repo conventions.

## Out of scope

- Worker-side analysis changes (no evidence analysis quality drives the stutter).
- Test framework introduction for the frontend.
- ZenMode visual design changes (only its per-beat repaint cost as a *contributor*, if telemetry implicates it).
