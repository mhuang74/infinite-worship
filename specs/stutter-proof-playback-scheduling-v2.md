# Infinite Worship — Stutter-Proof Playback Scheduling v2 (Spec)

Status: **approved design brief v2, 2026-10-06. Supersedes `stutter-proof-playback-scheduling.md` (v1) — do not edit v1. Not yet implemented.**

Decisions locked in this version (delta from v1, decided via review interview 2026-10-06):

1. **Epoch GainNode bus** for cancelling audio already scheduled on the Web Audio clock (v1 had no audio-cancellation mechanism at all — Gap 1).
2. **Skip-forward catch-up** on wake so stalls of *arbitrary* length degrade to an on-grid beat-skip, never a glitch (v1 only covered stalls ≤ lookahead — Gap 2).
3. Instrumentation records `ahead` **inside `playBeat()`** (engine holds the `AudioContext` reference; v1's prototype-patch of `AudioBufferSourceNode.start` cannot read `ctx.currentTime`).
4. Background-tab timer clamping: **resolved** — deferred UI dispatch fires immediately when `document.visibilityState === 'hidden'`.

Original decisions retained from v1: lookahead + UI alignment (no Worker); fully audio-aligned UI dispatch; instrumentation as dev-only permanent hook; root-cause re-confirmation skipped — the structural fix covers all observed stall magnitudes regardless of the (unidentified) stall source.

Evidence base unchanged from v1: live investigation of 2026-10-06 (22:14–22:31Z stutter incident; 54% of beats scheduled with negative lead time, up to 888 ms late; renderer stalls 500–1000 ms, bimodal, not caused by app JS; see incident session notes).

## Problem Statement

During long remix sessions, playback audibly stutters. The measured mechanism:

- `AudioEngine.scheduleNextBeat` runs a `setTimeout(…, 25)` loop that schedules beats only **100 ms** ahead of the audio clock (`lookaheadSeconds = 0.1`, `src/lib/audio.ts:20`).
- The renderer main thread occasionally stalls **500–1000 ms** (measured: 21 longtasks/min totaling 12.5 s blocked; passive 50 ms timer probe p95 = 762 ms). Stalls are bimodal (p50 = 1 ms) and NOT caused by app JS: CPU profile 97.5% idle, max JS call 7 ms, GC/layout/paint all tiny, canvas repaint load ≈ 0.3% CPU.
- When a stall exceeds the 100 ms lookahead, the loop wakes after `nextBeatTime` is already in the past and calls `source.start(pastTime)` → the beat plays immediately, off-grid → audible glitch. During the incident, **54% of beats (107/198) were scheduled with negative lead time**, up to 888 ms late.

The stall *source* was not conclusively identified (excluded: JS compute, GC, layout/paint, network, canvas). Suspects: macOS App Nap / QoS (window `hasFocus=false` throughout), system daemons (mediaanalysisd active in the window), transient OS-level interference. It stopped on its own after ~10 min and has not recurred — so the fix must not assume any particular stall cause.

**Design conclusion:** the fragility is structural. ANY main-thread pause longer than the lookahead glitches audio. The fix has three legs: (a) schedule far enough ahead that main-thread stalls cannot exhaust the buffer, (b) *never schedule into the past* — if a stall outruns the lookahead, skip forward instead of backfilling, and (c) drive UI callbacks from the audio clock so the bigger lookahead doesn't desynchronize visuals from sound.

## Goals

1. Playback survives main-thread stalls of **arbitrary length**: ≤ 2 s with zero interruption; > 2 s degrades to an on-grid beat-skip (a gap in beat dispatch, not overlapping glitch audio).
2. UI (beat counter, zen glow/arcs, jump flashes) stays audio-aligned: what you see pulses when you hear the beat, not when it was scheduled.
3. `pause()`/`stop()`/`restart()`/`seekToTime()`/`jumpToBeat()` actually silence everything already scheduled. With 2 s lookahead, v1's timer-only cancellation would leave up to 2 s of stale audio playing after pause and overlap audio after seek/jump.
4. No change to the remix algorithm (jump probability, candidate weighting, crossfade lengths) or to any API surface used by `page.tsx`.
5. No new tooling or test framework (repo convention: `npm run lint` + `npx tsc --noEmit` + live dev-server verification via CDP instrumentation).

## Non-Goals

- Worker-based scheduling (bigger refactor; revisit only if this fix proves insufficient — see Risks).
- Changing jump/crossfade behavior.
- Fixing the (still unidentified) external stall source.
- Gapless beat continuity across > 2 s stalls: a 5 s stall skips ~10 beats. Accepted; the alternative (backfill) is the bug being fixed.

## Current Architecture (as-built, reference for line numbers)

All references: `application/frontend/src/lib/audio.ts` (tag `#C011`).

- `AudioEngine`: `AudioContext` + one `AudioBuffer` (whole song, decoded in memory), `beats[]` from Analysis JSON.
- Scheduling: `scheduleNextBeat()` (line 116) while-loop fills beats up to `currentTime + lookaheadSeconds` (100 ms), calls `onBeatChange(beat)` + `playBeat()` (line 228: one `AudioBufferSourceNode` per beat, `source.start(time, beat.start, beat.duration)`, connected to `mainGain`) inline, then re-arms via `setTimeout(25)` (line 176).
- Crossfade at array end: `scheduleCrossfade()` (line 179) schedules final 16 beats fading out + first 16 beats fading in (two GainNodes connected directly to `mainGain`, lines 185–188), sets `nextBeatTime = fadeInPlayTime` (line 220), then resumes the 25 ms loop with a single long `setTimeout((fadeInPlayTime - currentTime) * 1000)` (lines 223–225). It also calls `onBeatChange` for the 16 fade-in beats inline (line 207).
- End-of-array watchdog: if `nextBeat` is falsy (fell off the array without crossfade), line 171 does `setTimeout(() => this.restart(), 3000)`.
- Scheduling entry points that must all be timer-managed: `play()` (48), `seekToTime()` (70), `jumpToBeat()` (99), the 25 ms chain (176), the crossfade timer (223), and the watchdog restart (171). Today only the 25 ms chain is self-consistent; the others can double-schedule.
- UI: `onBeatChange`/`onJump` fire **at schedule time** (i.e. up to lookahead *before* the sound). Today that lead is ~0.1 s (imperceptible); it drives `page.tsx` state (`currentBeat`, `beatPlayCounts`, `totalJumps`, `jumpEvents`) and ZenMode repaints.

## Design

### Part 1 — Scheduling core: lookahead, catch-up, timer management (audio.ts)

**1a. Lookahead.** Raise `lookaheadSeconds` from `0.1` to **2.0 s**.

**1b. Skip-forward catch-up (never schedule into the past).** At the top of the `scheduleNextBeat` while-loop's iteration (before the crossfade check), if `this.nextBeatTime < this.audioContext.currentTime`, advance through beats *without scheduling or dispatching UI* until `nextBeatTime ≥ currentTime`:

```ts
// After any main-thread stall longer than the lookahead: skip forward to
// the first beat whose start time is still in the future. Skipped beats are
// silent (they were "played" during the stall in wall-clock terms) — do NOT
// backfill them: backfilling means source.start(pastTime), the exact glitch
// this redesign eliminates.
while (this.nextBeatTime < this.audioContext.currentTime) {
  const beat = this.beats[this.currentBeatIndex];
  this.nextBeatTime += beat.duration;
  this.currentBeatIndex++;
  // no playBeat, no onBeatChange: not audible, not visible
}
```

Details the implementer must get right:

- If this walk reaches the crossfade boundary (`currentBeatIndex === beats.length - 16`), hand off to `scheduleCrossfade()` exactly as the normal loop does — the crossfade's own fade-time computation starts from `nextBeatTime`, which is now in the future, so it stays correct.
- If the walk runs off the array end (can't happen when the crossfade check is honored, but guard anyway): treat as the existing line 171 end-of-array case.
- `seekToTime`/`jumpToBeat` set `nextBeatTime = currentTime`, which already satisfies the invariant; the skip loop is a no-op for them.
- Beat-skip does mean a UI discontinuity (counter jumps by N). That is correct and visible feedback of what actually happened.

**1c. Timer management.** Add `private scheduleTimer: number | undefined` and `private watchdogTimer: number | undefined`. Every path that (re)starts scheduling — `play()`, the 25 ms chain re-arm, the crossfade-resume timer, the end-of-array watchdog, `seekToTime()`/`jumpToBeat()` when already playing — must first `clearTimeout(this.scheduleTimer)` (or `watchdogTimer` for line 171) and then store its own handle when it arms the next tick. Replace line 176's bare `setTimeout` with `this.scheduleTimer = setTimeout(...)`; same for line 223; line 171's `setTimeout(() => this.restart(), 3000)` becomes `this.watchdogTimer = setTimeout(...)`. Add one private `cancelTimers()` that clears `scheduleTimer`, `watchdogTimer`, and every pending UI timer (Part 3), and call it at the top of `pause()`, `stop()`, `restart()`, `seekToTime()`, and `jumpToBeat()`. The watchdog must die on `pause()` too, not just `stop()`/`restart()` — a pause during the 3 s watchdog window must not resurrect playback. Without this discipline, a seek during a crossfade window double-schedules (both the crossfade's long timer and the seek's immediate `scheduleNextBeat()` call run).

**1d. Runaway guard.** The while-loop now runs ~5–100 iterations per wake depending on tempo. Cap iterations per wake at 64; if exceeded, re-arm the 25 ms timer and continue next tick. Protects against pathological beat arrays with near-zero durations.

**1e. Crossfade-resume timing.** Raise the crossfade-resume `setTimeout` so it re-enters `scheduleNextBeat` at least `lookaheadSeconds` before the fade-in's final beat: replace `(fadeInPlayTime - currentTime) * 1000` (line 225) with `(fadeInPlayTime - lookaheadSeconds - currentTime) * 1000`, clamped to ≥ 25 ms. (Otherwise the crossfade's own long timer recreates the same blind window the fix is meant to close.) Note `fadeInPlayTime` (line 220) is the end time of the *16th* fade-in beat; `currentBeatIndex` is already 16, so resuming `lookaheadSeconds` early means the loop backfills beats 16..N of the fade-in region — those beats are **not** re-scheduled by the normal loop (`playBeat` on a beat twice would double audio). To avoid this: after the crossfade hands control back, the first `scheduleNextBeat` wake must rely on the skip-forward loop **not** firing (nextBeatTime is ≥ currentTime by construction — it is `fadeInPlayTime - 0` vs the resume happening at `fadeInPlayTime - lookaheadSeconds`, i.e. `nextBeatTime` is within `[now, now + 2 s]`, inside the lookahead window, so the while-loop correctly fills beats 16 onward without touching beats 0–15). Verify this reasoning holds in review: the invariant is *the normal loop never schedules a beat it has already scheduled*, and beats 0–15 of the fade-in were scheduled by `scheduleCrossfade` itself with `currentBeatIndex` left at 16.

### Part 2 — Epoch GainNode bus: cancelling scheduled audio (audio.ts)

All audible output currently flows `source → (fadeOutGain|fadeInGain|) → mainGain → destination`. Introduce a per-generation **epoch bus** between scheduling and `mainGain`:

```ts
private epochGain: GainNode; // created in constructor: createGain() → mainGain

private newEpoch(): void {
  // Kill ALL audio already queued on the audio clock, instantly.
  // Disconnected sources keep "playing" into nothing and self-GC when ended.
  this.epochGain.disconnect();
  this.epochGain = this.audioContext.createGain();
  this.epochGain.connect(this.mainGain);
}
```

- **Retarget the normal loop's `playBeat` call too (line 138):** `this.playBeat(this.currentBeatIndex, this.nextBeatTime, this.epochGain)` — v2's earlier draft named only the crossfade gains (lines 185–188); an implementer who changes only those leaves normal beats connected straight to `mainGain`, bypassing the bus entirely, and `pause()`/seek/jump still leak 2 s of audio while everything *looks* wired up. Post-change invariant: grep the file — the only `.connect(this.mainGain)` left must be inside `newEpoch()`; no `playBeat` call site passes `mainGain`.
- `scheduleCrossfade`'s `fadeOutGain`/`fadeInGain` connect to `this.epochGain` instead of `mainGain` (lines 185–188), so an epoch cut mid-crossfade kills the crossfade audio too.
- `newEpoch()` is called by: `pause()`, `stop()`, `restart()` (via `stop()`), `seekToTime()`, `jumpToBeat()`, and `play()` when starting from a paused/stopped state.
- **`pause()` must snap the resume position back to the audible present** (new requirement — otherwise every pause/resume skips ~lookahead of content): at pause time the loop has already scheduled through `currentBeatTime + lookaheadSeconds`, so `currentBeatIndex` points at the first *unscheduled* beat, ~2 s ahead of what is sounding. Resuming from there drops those 2 s. Fix: in `pause()`, walk `currentBeatIndex`/`nextBeatTime` back while `nextBeatTime - beats[currentBeatIndex].duration >= this.audioContext.currentTime` … i.e. land on the last beat whose start is ≤ `currentTime` (the beat the listener was hearing when they hit pause), and set `nextBeatTime = max(currentTime, beat.start…) ` — concretely:
  ```ts
  // pause(): rewind to the beat that was audible when the user hit pause
  while (this.currentBeatIndex > 0 &&
         this.nextBeatTime - this.beats[this.currentBeatIndex].duration >= this.audioContext.currentTime) {
    this.nextBeatTime -= this.beats[this.currentBeatIndex].duration;
    this.currentBeatIndex--;
  }
  this.nextBeatTime = Math.max(this.nextBeatTime, this.audioContext.currentTime);
  ```
  Caveat (edge case, acceptable to leave imperfect but must not *break*): if pause lands during a crossfade window, `currentBeatIndex` is 16 (looping-region start) and the walk-back only walks the first 16 fade-in beats, landing at the loop head — resume-from-head of the current wrap instead of the exact crossfade cut point. Audibly fine (a wrap restart), and strictly better than today's double-audio behavior. If the implementer wants exactness, snap `currentBeatIndex`/`nextBeatTime` from `currentTime` against the fade-in beat times (mirror of `seekToTime`'s finder) before the walk-back — optional, not required.
- `pause()` + `newEpoch()` is what makes pause actually pause: up to 2 s of lookahead audio would otherwise keep sounding.
- **`restart()`/`stop()` do NOT walk back** — they intentionally reset to the array head (`stop()` already does `currentBeatIndex = 0`).
- No per-source bookkeeping, no `Set<AudioSourceNode>`, no `onended` cleanup — disconnected sources end on their own scheduled times and are GC'd. (Audio param events on the dead crossfade gains are orphaned harmlessly.)

### Part 3 — Audio-clock-aligned UI dispatch (audio.ts)

`onBeatChange(beat)` and `onJump` currently run inline at schedule time. Split them:

- **Audio events stay inline (must be exact):** `playBeat()` call, jump decision, `nextBeatTime` advance, crossfade gain ramps. Pure scheduling state; must happen ahead of time.
- **UI events are deferred to the audio clock.** When scheduling a beat at time `when`, dispatch:

```ts
private scheduleUiDispatch(when: number, cb: () => void): void {
  const delay = Math.max(0, (when - this.audioContext.currentTime) * 1000);
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    cb(); // clamped timers would lag ≥1s; state is invisible when hidden anyway
    return;
  }
  const seq = this.nextUiSeq++;
  this.uiTimers.set(seq, setTimeout(() => { this.uiTimers.delete(seq); cb(); }, delay));
}
```

  - `onBeatChange(beat)` in the main loop: `scheduleUiDispatch(this.nextBeatTime, () => this.onBeatChange(currentBeat))` — note capture `currentBeat` in the closure, not `this.beats[this.currentBeatIndex]` (the index advances in the same iteration).
  - `onBeatChange` in `scheduleCrossfade` (line 207, the 16 fade-in beats): same deferral with `when = fadeInPlayTime` before it advances.
  - **`onJump`:** the jump decision happens when scheduling the *takeoff* beat, but the arc/glow should fire when the *landing* beat sounds. Carry the pending jump event out of the decision branch and defer it alongside the landing beat: when `shouldJump` resolves, set `pendingJump = { count, from, to }`; on the *next* loop iteration (the landing beat's iteration), `scheduleUiDispatch(this.nextBeatTime, () => { this.onJump(pendingJump); pendingJump = undefined; })`. Edge case: the jump lands at the crossfade boundary → the landing beat is a crossfade beat → defer with that beat's fade time in `scheduleCrossfade`, same mechanism.
  - `onJump` calls in `restart()` (line 66, the zeroed reset event) and `jumpToBeat()` (line 106) are **immediate, not deferred** — they are direct responses to user action, not audible-beat events. Same for `seekToTime()`'s `onBeatChange` (line 86).
- **Cancellation:** `pause()`/`stop()`/`restart()`/`seekToTime()`/`jumpToBeat()` clear all pending UI timers first (`for (const t of this.uiTimers.values()) clearTimeout(t); this.uiTimers.clear();`) — the beats they were attached to were just killed by `newEpoch()` and are no longer audible; otherwise a seek would replay stale UI flashes for up to 2 s. Clear *before* the immediate dispatches these methods fire, so ordering is: kill audio → kill pending UI → do own dispatch.
- **Skip-forward (Part 1b) never dispatches UI** for skipped beats — they are not audible.
- `onPlaybackStarted` keeps its existing semantic (fires when the first beat is *scheduled*); one-shot state transition, timing skew irrelevant.
- `page.tsx` needs **no changes**: callbacks keep signatures and fire-once-per-audible-beat semantics; only wall-clock timing shifts by design (plus the pause/resume seam, which Part 2's walk-back keeps content-continuous exactly as today's ~100 ms behavior). ZenMode beat-driven repaints then happen at sound time automatically (driven by `currentBeat` state).

### Part 4 — Instrumentation hook (dev-only, permanent)

Keep the incident instrumentation reachable so the fix can be verified and future regressions diagnosed:

- In `playBeat()`, dev builds only (`process.env.NODE_ENV !== 'production'`):

```ts
if (process.env.NODE_ENV !== 'production') {
  const ahead = time - this.audioContext.currentTime;
  pushSchedLog(ahead); // ring buffer, last 512 entries, on window.__iwSchedLog
  if (ahead < 0) console.warn(`late schedule: ${(-ahead * 1000).toFixed(1)}ms`);
}
```

- Rationale for placement (delta from v1): a prototype-patch of `AudioBufferSourceNode.prototype.start` **cannot read `ctx.currentTime`** — a `BufferSourceNode` exposes no reference to its context, so v1's patch had no way to compute `ahead`. `playBeat` holds the engine's `audioContext` and sees every scheduled beat, including crossfade beats, uniformly. Same data shape as the incident probe, so the existing CDP watcher (`~/tmp/iw-monitor/`) consumes it unchanged.
- Implementation may live inline in `audio.ts` behind the env check or in a tiny `src/lib/schedDebug.ts` imported only in dev — implementer's choice; keep it out of the prod bundle (guard the import itself, not just the call, if a separate module is used).

## Alternatives Considered

- **Worker-driven scheduler:** move the while-loop into a Worker; main-thread stalls can't starve it. REJECTED (decision 2026-10-06): `AudioContext` is main-thread-only, so the Worker can only compute *decisions* and the main thread would still execute `source.start()` — a >lookahead main-thread stall still glitches. Shifts the problem rather than removing it. Skip-forward catch-up (Part 1b) makes even that residual degrade gracefully, weakening the case for a Worker further; revisit only if soak data shows beat-skips are common enough to be musically objectionable.
- **Pre-scheduled source chains (schedule N beats at once):** subsumed by Part 1 — the while-loop fills the entire lookahead window each wake.
- **Tracked-source cancellation (`Set` of live `AudioBufferSourceNode`s + `stop()`):** more precise node reclamation but requires per-source bookkeeping plus separate handling of crossfade GainNodes. Epoch bus achieves the audible result (instant silence) in ~10 lines. REJECTED (decision 2026-10-06).
- **Optimizing React/zen repaints:** measured at ~0.3% CPU, no long tasks; not the bottleneck. Skip.

## Acceptance Criteria

Verified against the live dev server (Chrome via CDP, the harness used during the incident). No test framework is added — repo convention (AGENTS.md): `npm run lint` + `npx tsc --noEmit` + exercising the real dev server; the CDP instrumentation below IS the test harness.

1. `npx tsc --noEmit` and `npm run lint` clean.
2. With instrumentation active, load a song, play ≥ 10 min with zen mode on:
   - ≥ 99% of scheduled beats have `ahead` in `[0.05, 2.0]` s; **zero** beats with `ahead < 0`.
   - The `ahead` histogram's minimum stays > 0 even when artificial main-thread stalls are induced (see 3).
3. Stall tolerance, induced (two magnitudes):
   - **≤ lookahead:** run a 1.5 s busy-loop (`for(;;);` style) from a CDP-injected `setTimeout` every ~5 s for a minute of playback. Playback must remain gapless: no `ahead < 0` entries, no audible stutter, no skipped beats (beat counter is continuous), user-confirmed.
   - **> lookahead:** induce a single 3 s stall. Expected: a beat-skip — counter jumps by ~N beats, zero `ahead < 0` entries, no overlapping audio, no glitch sound. (This is the Part 1b contract; if it glitches, the skip loop is wrong.)
4. UI alignment: beat counter / zen glow changes coincide with audible beats within ~100 ms (spot-check by toggling a beat highlight; no measurable 2 s lead). **Check through the loop/crossfade boundary too** — the 16 fade-in beats' `onBeatChange` dispatches (deferred per Part 3) must fire at their fade-in sound times, not as a 2-s-early burst at wrap-scheduling time.
5. Jump semantics unchanged: probabilistic jumps still ≥ 16 beats away, ≥ 8 beats apart, weighted toward earlier beats; jump arcs fire on the landing beat's sound. The `restart()` count=0 reset event and the user-initiated `jumpToBeat`/`seekToTime` dispatches fire immediately (unchanged), not deferred.
6. Crossfade works end-to-end: song plays through the array end and loops without gaps, without double-scheduled beats (verify by watching `sourcesStarted - sourcesEnded` stay ≤ ~2, if the probe tracks it; otherwise by listening and the `ahead` log staying clean across the wrap), and beats 0–15 of the fade-in are not re-scheduled by the resumed loop (no double-audio flap during the wrap).
7. Pause/seek/restart/jump during a crossfade window: audio stops instantly on pause (no ≤ 2 s tail — this is the epoch bus), no residual UI flashes after any action, no double audio, no playback resurrection from the watchdog after `stop()` — or after `pause()` (the watchdog must die on both). Plus plain pause/resume mid-song: playback continues from the beat that was sounding at pause, not ~2 s ahead (the Part 2 walk-back; listen for dropped content at the seam).
8. Watcher-based soak: the external 10-min sampler shows zero `schedNeg` across a ≥ 30 min session.

## Risks / Open Questions

- **Beat-skips after > 2 s stalls:** a 5 s stall skips ~10 beats with no UI dispatch for them. Musically acceptable (better than glitching); if soak data shows frequent skips, either raise `lookaheadSeconds` or revisit the Worker. The skip is at least a *correct* jump-to-current-time, on-grid.
- **`mainGain` interplay:** `mainGain` is created once in the constructor and never mutated — nothing in `src/` touches `mainGain.gain` (no volume control exists), and the only connections to `mainGain` are `playBeat`'s sources and the two crossfade gains (verified by grep, 2026-10-06). The epoch bus slots in cleanly between them and `mainGain`; only the `destination` connection is permanent.
- **Deferred UI dispatch vs. React batching:** `setTimeout` callbacks outside React events each trigger their own render pass — same as today's schedule-time dispatches; no new render volume, just shifted in time. Verify with the React profiler during acceptance if suspicious.
- **Hidden-tab dispatch (resolved 2026-10-06):** deferred dispatch fires immediately when `document.visibilityState === 'hidden'`, avoiding Chrome's ≥ 1 s background-timer clamping. Visuals are invisible when hidden; state stays roughly current on return.
- **`beatPlayCounts` semantics:** counts increment at dispatch (now = sound time). Unchanged semantics, timing only — the growth-ribs meaning is preserved.
- **`beats.indexOf(nextBeat)` cost** (line 167): O(n) per beat with the full-array `beats`; with 64-iteration bursts after long crossfade gaps this is still trivial (thousands of entries, no allocation). Not in scope, not a risk — noted only so the implementer doesn't "optimize" it and change jump-index semantics.

## Implementation Notes

- Verification harness is the existing CDP setup from the incident: Chrome with `--remote-debugging-port=9222`, `window.__iwSchedLog` consumption, the external 10-min watcher (`~/tmp/iw-monitor/`). Reuse, don't rebuild.
- Timing constants live in one place (`lookaheadSeconds`); the crossfade-resume timer and acceptance thresholds derive from it, so future retuning stays consistent.
- Implementation order matters for reviewability, not runtime: Part 2 (epoch bus) + Part 1c (timer management) first — they are pure cancellation correctness with the 100 ms lookahead; then 1a/1b/1d/1e (lookahead + skip + crossfade timing); then Part 3 (UI deferral); then Part 4 (instrumentation). Verify acceptance 7 after the first slice, 2/3/6 after the second, 4/5 after the third. A partial ship of lookahead-without-UI-alignment still desyncs visuals by 2 s — don't deploy in between (see Rollout).
- `jumpToBeat` fires its `onJump`/`onBeatChange` **immediately** (user-action feedback, not audible-beat dispatch) — do not route these through `scheduleUiDispatch`.
- The dev-only `console.log` beat lines (141, 180) can be kept or dropped; if kept, they belong behind the same dev guard as Part 4 to keep prod console clean. Implementer's choice.

## Rollout

Single PR, frontend-only (`src/lib/audio.ts`, optional `src/lib/schedDebug.ts`). No infra, no worker, no API changes. Deployable independently; safe to revert. Ship Parts 1+2+3+4 together — the intermediate states each carry a visible defect (lookahead without UI alignment = 2 s desync; lookahead without epoch bus = unpausable playback).
