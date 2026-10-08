# Infinite Worship — Lyric-Aligned Jump Points (Spec)

Status: **reviewed design, revision 2, 2026-10-08. Supersedes the implementation plan in issue #69 (review round 1: critical outro-boundary flaw + two listening-experience issues; review round 2: mid-song-gap exemption + vacuous probe replaced). Not yet implemented. The issue body is NOT edited — this spec is the new version of record.**

Decisions locked in this version (delta from the issue #69 plan; round 1 decided via review interview, round 2 from post-review advisories, 2026-10-08):

1. **Coverage-based lyric exemption, replacing the span-based OR-clause.** The plan's `[lines[0].time, lines[last].time]` OR-clause had two holes. (a) CRITICAL: the upper bound is the START of the final line, which sings for seconds after — the whole final line was treated as jump-free outro. (b) HIGH: a beat deep inside a mid-song instrumental break (inside the span, >T from any line) was suppressed, contradicting the plan's own "lyric-less stretches behave exactly as today" and its OR-clause rationale — gap placeholders (story 7) only exist in some LRCs. Fix: a moment is **lyric-covered** iff it lies within `[l − exitWindow, l + lineExtent]` of some line time `l`, where `lineExtent = min(medianLineGap, 8 s)` (median of consecutive line-time gaps; capped so a sparse LRC can't blanket the song). Moments outside every line's covered span are instrumental — intro, mid-song break, or true outro — and jump freely. All sung moments (covered) stay subject to the boundary windows.
2. **Beat-scaled entry window, fixed exit window.** A fixed T = 0.5 s is narrower than the beat grid on slow worship songs (~0.9 s beats at 65 BPM), making roughly half of all line boundaries unreachable as landings — multi-fold jump-rate starvation on ballads. Entry window widens to `max(0.5 s, 1 median beat duration)`; exit stays fixed at 0.5 s so cuts remain tight. Two constants instead of one.
3. **User-initiated jumps exempt.** `jumpToBeat()` (Zen double-tap) and `seekToTime()` are deliberate user choices of destination; alignment constrains only the engine's automatic probabilistic jumps.
4. **Client-side leading-silence offset, replacing the bias probe.** `beat.start` lives on the worker's `librosa.effects.trim`-ed timeline (`remixatron.py:221`) while LRC times are on the original recording — a systematic offset δ would silently eat the alignment windows, and the round-1 realized-jump probe was vacuous for detecting it (landings are admitted by the entry predicate computed from the same line times, so logged deltas are bounded to `[−entryWindow, 0]` by construction). Fix: estimate δ at engine construction by scanning the already-decoded AudioBuffer for the first near-silence→content transition (first window whose max |sample| exceeds the global peak by −60 dB, approximating `librosa.effects.trim`'s top_db=60 frame-RMS trim), then compare beats against line times as `beat.start + δ`. Alignment-only; playback timing untouched.

All other decisions from issue #69 are retained: client playback-time only (Worker/Analysis untouched); Lyrics as an immutable constructor parameter (no setter); Line Boundary glossary entry in CONTEXT.md; suppression without counter reset; all spacing/distance/weighting mechanics untouched; null-lyrics short-circuit; external-behavior tests over the real engine via a plain-Node harness with new window/AudioContext/Math.random/NODE_ENV stubs.

## Problem Statement

When playing an Imported Song with Lyrics, probabilistic jumps sometimes fire mid-line: the outgoing audio cuts a sentence mid-word, or the landing starts mid-sentence. Even acoustically seamless, the lyric reads as a fragment — the remix audibly breaks the worship flow exactly where the Lyrics say a thought is in progress.

## Goals

1. Jump attempts fire only when BOTH ends are lyric-clean: the leaving moment is near a Line Boundary, and the landing beat starts just before a Line Boundary.
2. No candidate satisfying both → the attempt is suppressed with NO audible glitch and NO counter reset; retries happen naturally on later beats.
3. Songs without Lyrics (all uploads), lyric-less stretches (intro / estimated outro / instrumental gaps), and LRC load/parse failures behave exactly as today — alignment never degrades playback.
4. Listening smoothness preserved: the alignment filter must not starve jump energy on slow-tempo songs beyond intent, and must not introduce scheduling-timing risk into the 25 ms scheduling loop.
5. Existing jump spacing, distance, weighting, probability, and the seamless next-beat fallback are unchanged; Zen lyric display sync (issue #60) is unchanged.

## Non-Goals

- No Worker, Analysis JSON, analysis pipeline, LRC parsing, or lyric display changes.
- No re-analysis of any Song (Analysis stays shared per content hash).
- No weighting/distance/probability retuning — alignment only narrows the eligible pool.
- No upload-side lyrics support; no new UI, settings, or visual feedback for alignment.

## Current Mechanics (as-built reference)

All references: `application/frontend/src/lib/audio.ts`.

- **Jump decision** (`scheduleNextBeat`, line 276–294): per scheduled beat, `shouldJump = hasCandidates && Math.random() < jumpProbability && beatsSinceLastJump >= 8`. On success `getJumpCandidate(beat)` picks a weighted candidate; **on null it falls through to the next beat with no state change** (line 289–291) — this is the exact seam suppression plugs into: a lyric-unclean candidate set returns null, and the counter reset (line 284) never runs. Suppression semantics fall out for free.
- **`getJumpCandidate`** (line 406): filters candidates to ≥16-beat index distance, weights earlier candidates higher, one `Math.random()` roulette draw per *attempt* (line 435). The engine has `beats`, `jumpProbability`, and per-beat `jump_candidates` at decision time; the filter pipeline is pure array logic — adding a lyric predicate there adds no Web Audio interaction.
- **Engine construction** (line 32): plain constructor args; `page.tsx:236` constructs the engine after `loadSongForPlayback` resolved, with `loaded.lyrics` already in state scope (`page.tsx:106/324`) — an extra constructor parameter is trivially wireable. A setter is rejected: Lyrics are known before the engine exists.
- **Lyrics** (`player.ts:26`, `lrc.ts`): `LyricLine[] | null`, sorted by time, ≥2 lines or null; `lyricAt` (last line ≤ sourceTime) drives Zen display. LRC timestamps are on the original recording's timeline.
- **Worker beat times** (`worker/jukebox/remixatron.py:220-221`): `librosa.load` then `librosa.effects.trim` (default `top_db=60`) — beat `start` values are on the TRIMMED timeline, while playback slices the FULL decoded buffer (`source.start(time, beat.start, beat.duration)`) and LRC timestamps are on the original recording. Any leading silence the trim removed is a systematic offset δ shared by every beat; the design measures it client-side (Part 4) rather than trusting it to be small.
- **Jumps are hard cuts.** On a jump, `scheduleNextBeat` sets `currentBeatIndex` to the landing beat and plays it into the same `epochGain` — no fade nodes, no overlap (the 16-beat exponential crossfade is ONLY the end-of-array wrap, `scheduleCrossfade`, reached at `beats.length − 16`). AGENTS.md's "16-beat exponential crossfade" wording overstates it. Consequence: the exit cut is instantaneous at a beat boundary — which is exactly why the exit window matters — and the landing line's first beats are NOT blended with outgoing audio.

## Design

### Part 1 — Lyric alignment data and derived constants (audio.ts)

The engine accepts parsed Lyrics as an **immutable constructor parameter**: `lyrics: LyricLine[] | null` (page wiring: `new AudioEngine(ctx, buffer, beats, onBeatChange, onJump, onPlaybackStarted, loaded.lyrics)` — parameter order implementer's choice, documented in the constructor).

At construction, when `lyrics !== null`, precompute once and cache as private fields:

- `lineTimes: number[]` — the sorted line times (they are already sorted by `parseLrc`).
- `medianLineGap` — median of `lineTimes[i+1] − lineTimes[i]` (≥1 gap guaranteed by the ≥2-line validity bar). The LRC's own estimate of "how long a line runs" in this song.
- `lineExtent = min(medianLineGap, 8000)` — how far past a line's start that line (and its musical tail) plausibly still "owns" the moment. The 8 s cap keeps a sparse LRC (few section-marker lines) from blanket-covering the whole song and suppressing everything.
- `entryWindowMs = max(500, 1000 × medianBeatDuration)` where `medianBeatDuration` = median of `beats[i].duration` (already available). At 120 BPM this stays 500 ms; at 65 BPM (~0.92 s beats) it widens to ~920 ms so every line boundary has a beat start within reach. `exitWindowMs` stays a fixed 500 ms constant.
- `timelineOffsetSec (δ)` — the leading-silence offset between the trimmed analysis timeline and the original recording (Part 4). Line times are compared against beats as `beat.start + δ`.
- All line-time lookups are binary search over `lineTimes` (mirroring `lyricAt`'s `lo/hi` walk in `lrc.ts:89`): O(log n), no allocation, negligible cost inside the 25 ms scheduling loop.

`lyrics === null` short-circuits: every predicate returns true and no offset scan runs (behavior identical to today, no added load-time work for uploads).

### Part 2 — Lyric-clean predicates (audio.ts)

All moments are compared in **original-recording time**: a beat-derived moment `m` (a beat's `start`, or an exit moment `be.start + be.duration`) is first shifted by the trim offset, `m + δ`, before comparing against `lineTimes`.

**Lyric-covered moment:** `covered(m)` = some line time `l` satisfies `m + δ ∈ [l − exitWindowMs, l + lineExtent]`. Sung lines and their musical tails are covered; intro, mid-song instrumental breaks, and true outro are not. This subsumes the plan's intro/outro OR-clause AND extends it to mid-song gaps — the plan's span `[lines[0].time, lines[last].time]` left every deep-gap moment covered by nothing yet subject to the windows (suppressed), contradicting the issue's own "lyric-less stretches behave exactly as today" and relying on gap placeholders that not every LRC has.

**Entry (landing beat with source start `bs`)** — lyric-clean iff:

- `covered(bs)` **AND** some line time `l` satisfies `bs + δ ∈ [l − entryWindowMs, l]` (at/just-before a boundary keeps the line heard whole), **OR**
- `¬covered(bs)` — instrumental (intro, mid-song break, true outro); jump freely (stories 5/6).

**Exit (leaving moment `be.start + be.duration`)** — lyric-clean iff:

- `covered(m)` **AND** some line time `l` satisfies `|m + δ − l| ≤ exitWindowMs` (symmetric: just-started and about-to-start are both acceptable; only deep mid-line cuts are suppressed), **OR**
- `¬covered(m)`.

Both ends must be clean for a candidate to remain eligible. The coverage exemption is load-bearing: without it, instrumental gaps would be suppressed, contradicting the interlude-energy decision. **The final line is covered only up to `lineTimes[last] + lineExtent`** — NOT to infinity — otherwise mid-final-line cuts would be permitted exactly where they're most audible (the regression case for the round-1 flaw).

Gap-placeholder lines (empty text) count as Line Boundaries like any other (story 7): they make section gaps jump-friendly.

### Part 3 — Suppression in the jump pipeline (audio.ts)

In `getJumpCandidate`, add the entry predicate to the existing `validCandidates` filter (line 413–418) and check the exit predicate on the attempt beat *before* the roulette: if the attempt beat's own exit is not clean, return null (no roulette draw is consumed). If the exit is clean but no candidate passes the entry filter, return null.

Then, in `scheduleNextBeat`, the existing fall-through (line 289–291: `getJumpCandidate → null → nextBeat = beats[currentBeatIndex + 1]`) IS the suppression path: `beatsSinceLastJump` was already incremented this iteration (line 265) and is **not** reset, so the very next scheduled beat re-rolls the gate — retries are immediate and natural (story 4). No new state, no new timers, no scheduling-timing changes: the predicates are pure functions evaluated at decision time inside the existing loop, so there is no risk to playback smoothness from this feature's scheduling-side changes.

Unchanged: jump probability (0.15 default, `setJumpProbability` live-tunable as today), min-8-beats spacing, ≥16-beat candidate distance, earlier-beat weighting roulette, the seamless next-beat fallback, the 16-beat crossfade, and the epoch/timer machinery from the stutter-proof redesign.

**Exempt:** `jumpToBeat()` (Zen double-tap, line 181) and `seekToTime()` (line 143) are user-initiated deliberate jumps — no alignment gating (review decision 3). `restart()`'s wrap and the end-of-array crossfade are continuation, not jumps — already exempt by structure.

### Part 4 — Leading-silence timeline offset δ (audio.ts)

The worker trims leading silence before beat tracking (`remixatron.py:220-221`) and discards the offset, so `beat.start` is on the trimmed timeline while LRC times and the played buffer are on the original recording. A round-1 idea — logging `(landing start − nearest line time)` for realized jumps — was vacuous for measuring this: landings are admitted by the entry predicate computed from the same `lineTimes`, so logged deltas are bounded to `[−entryWindow, 0]` by construction and say nothing about a global offset.

Instead, estimate δ directly from data the engine already holds. At construction (lyrics present only), scan the decoded `AudioBuffer` (channel 0 is enough):

- Compute the global peak amplitude over strided windows (e.g. 1024-sample frames, 512-step hop — cheap O(n/512) pass).
- δ = the time of the first frame whose max |sample| exceeds `peak × 10^(−60/20)` — the first non-near-silence content — approximating `librosa.effects.trim`'s default `top_db=60` frame-RMS trim.
- Predicates compare `beat.start + δ` against `lineTimes` (Part 1/2). Alignment-only: playback timing (`source.start(time, beat.start, …)`) is untouched — fixing the pre-existing display offset is out of scope (issue #60 behavior stays as shipped).
- Dev-only diagnostic (`process.env.NODE_ENV !== 'production'`): log δ once at construction, so the acceptance check can distinguish "offset small, windows honest" from "offset corrected".
- Trailing silence the trim also removed does not shift beat starts and is ignored.

Accuracy target: ±1 frame (≈23 ms at 44.1 kHz / 1024 samples) — an order of magnitude inside the 500 ms windows. Unit-testable as a pure function over synthetic buffers (exact zero, known δ, all-silence degenerate).

### Part 5 — CONTEXT.md glossary

Add one entry, **Line Boundary**: the moment a Lyrics line begins on the source recording. Lyric-clean cuts and landings coincide with Line Boundaries (within the alignment windows). All parsed line times count — including gap-placeholder lines with empty text. No ADR: the change is client-side and reversible.

## Alternatives Considered

- **Worker-side lyric-aware jump candidates** (annotate `jump_candidates` with boundary flags at analysis time): REJECTED — user directive: keep changes in the Frontend, Worker untouched; also breaks Analysis sharing (issue #69 story 14) since candidate quality would depend on lyric availability.
- **Lyrics as a settable engine property:** REJECTED — Lyrics are known before the engine exists (loader resolves them before page constructs the engine); immutability avoids mid-session realignment edge cases.
- **Suppress-by-rewriting the jump attempt in `scheduleNextBeat` directly** (e.g. pre-check before the gate): REJECTED — the `getJumpCandidate → null` fall-through already implements suppression with correct counter semantics; touching the gate order would change which `Math.random()` draws are consumed and couple the feature to the gate internals.
- **Fixed shared 0.5 s windows (plan as written):** REJECTED — beat-grid starvation on slow songs; the exit side keeps the strict 0.5 s so cut looseness doesn't scale with tempo.
- **Span-based OR-clause `[lines[0], lines[last]]` (plan as written):** REJECTED — two holes: final-line treated as outro (critical), mid-song instrumental breaks suppressed (high).
- **Realized-jump bias probe (`__iwLyricBias`, round 1):** REJECTED as a bias instrument — vacuous by construction (deltas bounded to `[−entryWindow, 0]` because landings were filtered by the same line times the probe compares against). Replaced by direct δ estimation (Part 4).
- **Correcting playback timing with δ (fix the pre-existing display offset too):** REJECTED — touches every `source.start` and Zen display path for a pre-existing condition outside this issue's scope; alignment-only use keeps the blast radius at the new predicates.

## Acceptance Criteria

Static gates first: `npx tsc --noEmit` and `npm run lint` clean.

1. **Engine tests (new harness, plain Node, repo zen-tests conventions).** Compile `audio.ts` from TypeScript, no Web Audio/window stubs exist yet — build once:
   - `window` stub with controllable `setTimeout`/`clearTimeout` (numeric handle return required — `uiTimers` is a `Map<number, number>` and `cancelTimers` clears by handle);
   - `NODE_ENV=production` so dev probes (`__iwSchedLog`, dev chatter) are skipped;
   - scriptable `Math.random` (gate pass/fail + roulette draws deterministic);
   - fake `AudioContext`: manually advanceable `currentTime`, `createGain`/`createBufferSource` recording `start`/`stop`/gain automation;
   - `document` left undefined (the `typeof document !== 'undefined'` guard in `scheduleUiDispatch` handles it).
2. **Case coverage:**
   - Lyrics present vs `null` (null path byte-identical behavior: same beats scheduled, same jump outcomes under the same random script);
   - Entry window edges: landing exactly at `l`, at `l − entryWindow`, `l − entryWindow − ε` (suppressed), `l + ε` (suppressed — just-after is a bad landing: the previous line's tail plays with no beginning);
   - Exit window edges: exit at `l ± 500ms` clean, `l ± (500ms + ε)` suppressed (symmetric);
   - **Coverage exemption:** intro moment (before `lines[0] − exitWindow`) allowed; outro moment (after `lines[last] + lineExtent`) allowed; **mid-song instrumental break** (between two lines, > `lineExtent` past the earlier line and > `exitWindow` before the later one) allowed on BOTH ends — the regression case for the round-2 gap bug; **inside the final line** (`lines[last] + lineExtent/2`) suppressed on both ends — the regression case for the round-1 flaw;
   - **Sparse-LRC cap:** with line gaps ≫ 8 s, moments beyond `l + 8 s` are uncovered and jump freely (the `lineExtent` cap does its job);
   - Gap-placeholder boundary counts as a Line Boundary;
   - **δ correction:** with a synthetic leading-silence offset, a landing beat that is boundary-clean only after `+δ` is admitted (and rejected without it) — pins the offset direction;
   - Suppression-without-reset: a suppressed attempt leaves `beatsSinceLastJump` incremented (next beat immediately re-eligible);
   - Fallback/spacing/weighting untouched: with lyrics clean everywhere (or uncovered everywhere), the same candidate is chosen as a no-lyrics run under the same random script;
   - `jumpToBeat`/`seekToTime` unaffected by unclean destinations;
   - Leading-silence estimator as a pure function: exact-zero, known-δ, all-silence degenerate synthetic buffers.
3. **δ sanity (dev server, real imported Song with Lyrics):** the logged construction δ is plausible (typically ≲ a few hundred ms; wildly large values indicate the scan misfired). Manual check that the Zen lyric line switches on the sung word for the same song — the end-to-end validation of the whole timeline chain.
4. **Manual listening (dev server):** mid-line cuts/landings no longer occur on the imported song; suppressed beats introduce no audible artifact (playback continues seamlessly); Zen lyric display stays correct across jumps.
5. **Jump-rate sanity (dev server, manual count via the jump counter UI):** ~5 min on a real imported song with lyrics vs. a lyric-less run of the same Song's analysis (e.g. an upload of identical audio, which shares the Analysis and runs unaligned). Expect noticeably fewer but clearly non-zero jumps in verse regions; zero jumps across a full verse-heavy song means the windows over-suppress and need widening — the documented two-constant tuning path, not a silent acceptance.

## Risks / Open Questions

- **Trim-timeline offset δ (measured, not assumed):** the leading-silence estimate has frame-level accuracy (~23 ms) and is applied alignment-only; if the scan misfires on a real song (e.g. quiet intro mistaken for silence), the logged δ makes it visible immediately and the correction is one constant. The pre-existing #60 display offset is NOT touched (out of scope).
- **`lineExtent` heuristic:** median gap underestimates a long final line (sustained tag) → mild over-suppression near the very end (invisible: fewer jumps, never a glitch). The 8 s cap trades the opposite risk (sparse LRC blanket-covering the song) for slightly earlier outro frees on songs with long lines. Both tunable via two constants.
- **Jump timing distribution shifts toward Line Boundaries — by design.** Suppression delays attempts until a clean beat exists, so realized jumps cluster near boundaries rather than at uniformly random moments. This is the feature's stated intent (stories 1/2), not a violation of story 12 (which preserves the gate/spacing/weighting MECHANICS — all unchanged). Note the gate stays memoryless (p = 0.15 per eligible beat): a clean beat fires with 15% probability, not deterministically, so jumps do not lock onto every boundary.
- **Jump-energy reduction on lyric-dense songs:** intended by design (that's the feature), but the beat-scaled entry window keeps it bounded, and acceptance criterion 5 measures it explicitly (verse-region jump count vs. a lyric-less run of the same Analysis). Zero jumps in verse-heavy material = windows over-suppress → widen via the two constants; never accept silence silently.
- **Scheduling-loop cost:** binary searches + median precompute + a one-time O(n/512) buffer scan at construction are trivial vs the 25 ms loop budget; no Web Audio interaction changes. No smoothness risk from this design.

## Rollout

Single PR, frontend-only: `src/lib/audio.ts` (predicates + suppression + leading-silence offset), `src/app/page.tsx` (one constructor argument), `CONTEXT.md` (Line Boundary glossary entry), new engine test harness (plain Node, zen-tests conventions). No infra, no worker, no API changes. Safe to revert. Issue #69 is updated with review/revision comments pointing at this spec; the issue body itself is left unedited (history).
