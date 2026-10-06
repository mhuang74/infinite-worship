# Infinite Worship — Stutter-Proof Playback Scheduling (Spec)

Status: **approved design brief, decided via structured interview, 2026-10-06. Not yet implemented.** Decisions: lookahead + UI alignment (no Worker); fully audio-aligned UI dispatch; instrumentation kept as dev-only permanent hook; root-cause re-confirmation skipped — the structural fix covers all observed stall magnitudes regardless of the (unidentified) stall source. Root cause and evidence from the live investigation of 2026-10-06 (22:14–22:31Z stutter incident, see `../local://iw-monitor-notes.md`-equivalent session notes; instrumented with in-page `AudioBufferSourceNode.start` slack logging).

## Problem Statement

During long remix sessions, playback audibly stutters. The measured mechanism:

- `AudioEngine.scheduleNextBeat` runs a `setTimeout(…, 25)` loop that schedules beats only **100 ms** ahead of the audio clock (`lookaheadSeconds = 0.1`, `src/lib/audio.ts:20`).
- The renderer main thread occasionally stalls **500–1000 ms** (measured: 21 longtasks/min totaling 12.5 s blocked; passive 50 ms timer probe p95 = 762 ms). Stalls are bimodal (p50 = 1 ms) and NOT caused by app JS: CPU profile 97.5% idle, max JS call 7 ms, GC/layout/paint all tiny, canvas repaint load ≈ 0.3% CPU.
- When a stall exceeds the 100 ms lookahead, the loop wakes after `nextBeatTime` is already in the past and calls `source.start(pastTime)` → the beat plays immediately, off-grid → audible glitch. During the incident, **54% of beats (107/198) were scheduled with negative lead time**, up to 888 ms late.
- The stall *source* itself was not conclusively identified (excluded: JS compute, GC, layout/paint, network, canvas). Suspects: macOS App Nap / QoS (window `hasFocus=false` throughout), system daemons (mediaanalysisd active in the window), transient OS-level interference. It stopped on its own after ~10 min and has not recurred — so the fix must not assume any particular stall cause; it must tolerate stalls of arbitrary length.

**Design conclusion:** the fragility is structural. ANY main-thread pause longer than the lookahead glitches audio. The fix is to decouple *audio scheduling* from main-thread timing: schedule far enough ahead that main-thread stalls cannot exhaust the buffer, and drive UI callbacks from the audio clock so a bigger lookahead doesn't desynchronize visuals from sound.

## Goals

1. Playback survives main-thread stalls of ≥ 2 s with zero audible glitch.
2. UI (beat counter, zen glow/arcs, jump flashes) stays audio-aligned: what you see pulses when you hear the beat, not when it was scheduled.
3. No change to the remix algorithm (jump probability, candidate weighting, crossfade lengths) or to any API surface used by `page.tsx`.
4. No new tooling or test framework (repo convention: `npm run lint` + `npx tsc --noEmit` + live dev-server verification via CDP instrumentation).

## Non-Goals

- Worker-based scheduling (bigger refactor; revisit only if this fix proves insufficient — see Risks).
- Changing jump/crossfade behavior.
- Fixing the (still unidentified) external stall source.

## Current Architecture (as-built, for reference)

- `AudioEngine` (src/lib/audio.ts): `AudioContext` + one `AudioBuffer` (whole song, already decoded in memory), `beats[]` from Analysis JSON.
- Scheduling: `scheduleNextBeat()` while-loop fills beats up to `currentTime + 100 ms`, calls `onBeatChange(beat)` + `playBeat()` (creates a `AudioBufferSourceNode` per beat, `start(time, offset, duration)`) inline, then re-arms via `setTimeout(25)`.
- Crossfade at array end: `scheduleCrossfade()` schedules final 16 beats fading out + first 16 beats fading in (two GainNodes), sets `nextBeatTime = fadeInPlayTime`, then resumes the 25 ms loop with a single long `setTimeout((fadeInPlayTime - currentTime) * 1000)`.
- UI: `onBeatChange`/`onJump` fire **at schedule time** (i.e. up to lookahead *before* the sound). Today that lead is ~0.1 s (imperceptible); it drives `page.tsx` state (`currentBeat`, `beatPlayCounts`, `totalJumps`, `jumpEvents`) and ZenMode repaints.

## Design

### Part 1 — Larger scheduling lookahead (audio.ts)

- Raise `lookaheadSeconds` from `0.1` to **2.0 s**.
- Raise the crossfade-resume `setTimeout` so it re-enters `scheduleNextBeat` at least `lookaheadSeconds` before the fade-in's final beat: replace `(fadeInPlayTime - currentTime) * 1000` with `(fadeInPlayTime - lookaheadSeconds - currentTime) * 1000`, clamped to ≥ 25 ms. (Otherwise the crossfade's own long timer recreates the same blind window the fix is meant to close.)
- `pause()`/`stop()`/`restart()`/`seekToTime()`/`jumpToBeat()` must cancel any pending re-arm timer before scheduling anew (currently re-entry happens only via the 25 ms chain; the crossfade timer is a second, unmanaged entry point — a `seekToTime` during a crossfade window can double-schedule). Add a `scheduleTimer: number | undefined` field; every path that starts scheduling does `clearTimeout(this.scheduleTimer)` first.
- Guard against runaway backfill: the while-loop now runs ~5 iterations per wake instead of ~0.25; that's fine, but cap iterations per wake (e.g. 64) and bail to the next timer tick if exceeded — protects against pathological beat arrays with near-zero durations.

### Part 2 — Audio-clock-aligned UI dispatch (audio.ts)

`onBeatChange(beat)` and the beat's `onJump` currently run inline at schedule time. Split them:

- **Audio events stay inline (must be exact):** `playBeat()` call, jump decision, `nextBeatTime` advance. These are pure scheduling state and must happen ahead of time.
- **UI events are deferred to the audio clock:** when scheduling a beat at time `when`, dispatch `onBeatChange` via `setTimeout(() => this.onBeatChange(beat), Math.max(0, (when - this.audioContext.currentTime) * 1000))`. Same for `onJump` (its event carries `from/to`; the arc/glow should fire when the *landing* beat sounds, so defer alongside the landing beat's `onBeatChange`).
- Cancellation: each deferred UI dispatch gets its handle stored in a `uiTimers` map keyed by an increasing schedule sequence. `pause()`/`stop()`/`restart()`/`seekToTime()`/`jumpToBeat()` clear all pending UI timers (the beats they were attached to are no longer audible) — otherwise a seek would replay stale UI flashes for up to 2 s.
- `onPlaybackStarted` keeps its existing semantic (fires when the first beat is *scheduled*); it's a one-shot state transition, timing skew is irrelevant.
- `page.tsx` needs **no changes**: the callbacks keep their signatures and fire-once-per-audible-beat semantics; only their wall-clock timing shifts by design.
- ZenMode beat-driven repaints then happen at sound time automatically (they're driven by `currentBeat` state).

### Part 3 — Instrumentation hook (dev-only permanent)

Keep the incident instrumentation reachable so the fix can be verified and future regressions diagnosed:

- Patch `AudioBufferSourceNode.prototype.start` in dev builds only (`process.env.NODE_ENV !== 'production'`), recording `ahead = when - ctx.currentTime` into a bounded ring buffer (e.g. last 512 entries) on `window.__iwSchedLog`.
- Optional: log a `console.warn` when `ahead < 0` occurs (late schedule) so a recurrence is visible in console without tooling.

(Implementation may live in `src/lib/audio.ts` behind the env check, or a tiny `src/lib/schedDebug.ts` imported only in dev — implementer's choice; keep it out of the prod bundle.)

## Alternatives Considered

- **Worker-driven scheduler:** move the while-loop into a Worker; main-thread stalls can't starve it. REJECTED by decision (2026-10-06): `AudioContext` is main-thread-only, so the Worker can only compute *decisions*, and the main thread would still have to execute `source.start()` — meaning a >lookahead main-thread stall still glitches. It shifts the problem rather than removing it; only worthwhile if post-verification shows stalls > 2 s.
- **Pre-scheduled source chains (schedule N beats at once):** subsumed by Part 1 — the while-loop already fills the entire lookahead window each wake.
- **Optimizing React/zen repaints:** measured at ~0.3% CPU with no long tasks; not the bottleneck. Skip.

## Acceptance Criteria

Verified against the live dev server (Chrome via CDP, the harness used during the incident investigation). No test framework is added — repo convention (AGENTS.md): `npm run lint` + `npx tsc --noEmit` + exercising the real dev server; the CDP instrumentation below IS the test harness.

1. `npx tsc --noEmit` and `npm run lint` clean.
2. With instrumentation active, load a song, play ≥ 10 min with zen mode on:
   - ≥ 99% of scheduled beats have `ahead` in `[0.05, 2.0]` s; zero beats with `ahead < 0`.
   - The `ahead` histogram's minimum stays > 0 even when artificial main-thread stalls are induced (see 3).
3. Stall tolerance, induced: run a `for(;;);`-style 1.5 s busy-loop from a CDP-injected `setTimeout` every ~5 s for a minute of playback. Playback must remain gapless (no `ahead < 0` entries, no audible stutter — user-confirmed).
4. UI alignment: beat counter / zen glow changes coincide with audible beats within ~100 ms (spot-check by toggling a beat highlight; no measurable 2 s lead).
5. Jump semantics unchanged: probabilistic jumps still ≥ 16 beats away, ≥ 8 beats apart, weighted toward earlier beats; jump arcs fire on the landing beat's sound.
6. Crossfade works end-to-end: song plays through the array end and loops without gaps or double-scheduled beats (verify by watching `sourcesStarted - sourcesEnded` stay ≤ ~2 and by listening).
7. Pause/seek/restart during a crossfade window: no residual UI flashes after the action, no double audio (this is the `scheduleTimer` cancellation fix in Part 1).
8. Watcher-based soak: the external 10-min sampler shows zero `schedNeg` across a ≥ 30 min session.

## Risks / Open Questions

- **Stall > 2 s:** if the OS ever stalls longer than the new lookahead, glitches return. Mitigation path (documented, not built): Worker-scheduled decisions with a dedicated `AudioWorklet` or a very large pre-scheduled ring of sources. Decide after soak data.
- **Deferred UI dispatch vs. React batching:** `setTimeout` callbacks outside React events each trigger their own render pass — same as today's schedule-time dispatches; no new render volume, just shifted in time. Verify with the React profiler during acceptance if suspicious.
- **Timer clamping in background tabs:** Chrome can clamp background `setTimeout` to ≥ 1 s, which would delay UI dispatch (visuals lag) — but audio stays correct because sources are pre-scheduled on the audio clock. If background-tab visual lag is observed, gate deferred dispatch on `document.visibilityState` (dispatch immediately when hidden; React state updates are invisible anyway). Open question for the implementer.
- **`beatPlayCounts` semantics:** counts increment at dispatch (now = sound time). Unchanged semantics, only timing shifts — the "played back several times" growth-ribs meaning is preserved.

## Implementation Notes

- Verification harness is the existing CDP setup from the incident: Chrome with `--remote-debugging-port=9222`, in-page slack logging on `AudioBufferSourceNode.start`, the external 10-min watcher (`~/tmp/iw-monitor/`). Reuse, don't rebuild.
- Timing constants live in one place (`lookaheadSeconds`); the crossfade-resume timer derives from it so future retuning stays consistent.
- Scheduling loop, UI dispatch, and cancellation interact — implement Part 1 and Part 2 together and verify with acceptance criteria 2–7 in one pass; a partial implementation (big lookahead without UI alignment) ships the visible-desync bug described above.

## Rollout

Single PR, frontend-only (`src/lib/audio.ts`, optional `src/lib/schedDebug.ts`). No infra, no worker, no API changes. Deployable independently; safe to revert.
