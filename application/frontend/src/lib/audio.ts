
import { Beat, JumpEvent } from './types';
import { LyricLine } from './lrc';

export const createAudioBuffer = async (file: File, audioContext: AudioContext): Promise<AudioBuffer> => {
  const arrayBuffer = await file.arrayBuffer();
  return audioContext.decodeAudioData(arrayBuffer);
};

/**
 * Estimate the leading-silence offset δ between the worker's trimmed analysis
 * timeline (beat `start` values, `remixatron.py` `librosa.effects.trim`) and
 * the original recording (LRC line times, the full decoded buffer the player
 * plays). δ = the time of the first frame whose max |sample| exceeds the
 * global peak by −60 dB — approximating the trim's default `top_db=60`
 * frame-RMS trim — scanned over 1024-sample frames with a 512-sample hop
 * (channel 0 is enough). Frame accuracy ≈23 ms at 44.1 kHz, an order of
 * magnitude inside the 500 ms alignment windows. Returns 0 for exact-zero and
 * all-silence buffers (degenerate); trailing silence does not shift beat
 * starts and is ignored. Alignment-only: playback timing never uses δ.
 */
export function estimateLeadingSilenceOffset(audioBuffer: AudioBuffer): number {
  const data = audioBuffer.getChannelData(0);
  const frame = 1024;
  const hop = 512;
  const sampleRate = audioBuffer.sampleRate;
  let peak = 0;
  // Strided pass over frame maxima: peak = max frame max (the global peak can
  // only be ≥ any frame max, and a frame max > 0 implies the global peak > 0).
  const frameMaxes: number[] = [];
  for (let offset = 0; offset + frame <= data.length; offset += hop) {
    let m = 0;
    for (let i = offset; i < offset + frame; i++) {
      const a = Math.abs(data[i]);
      if (a > m) m = a;
    }
    frameMaxes.push(m);
    if (m > peak) peak = m;
  }
  if (peak === 0) {
    return 0; // exact zero or all-silence degenerate
  }
  const threshold = peak * Math.pow(10, -60 / 20); // global peak − 60 dB
  for (let f = 0; f < frameMaxes.length; f++) {
    if (frameMaxes[f] > threshold) {
      return f * hop / sampleRate;
    }
  }
  return 0; // content never exceeds the threshold (pure near-silence noise)
}

export class AudioEngine {
  private audioContext: AudioContext;
  private audioBuffer: AudioBuffer;
  private beats: Beat[] = [];
  private onBeatChange: (beat: Beat) => void;
  private onJump: (jump: JumpEvent) => void;
  private onPlaybackStarted: (() => void) | null = null;
  private jumpProbability = 0.15;
  private nextBeatTime = 0;
  private currentBeatIndex = 0;
  private isPlaying = false;
  private lookaheadSeconds = 2.0; // 2s lookahead: survives main-thread stalls up to 2s
  private beatsSinceLastJump = 0;
  private totalJumps = 0;
  private mainGain: GainNode;
  private hasPlaybackStarted = false;
  private epochGain: GainNode;
  private scheduleTimer: number | undefined;
  private watchdogTimer: number | undefined;
  private uiTimers = new Map<number, number>();
  private nextUiSeq = 0;
  private pendingJump: JumpEvent | undefined;
  // Lyric alignment (issue #69): immutable Lyrics; null short-circuits every
  // predicate so uploads behave exactly as before the feature existed.
  private lyrics: LyricLine[] | null;
  private lineTimes: number[] = [];
  private lineExtent = 0;
  private entryWindowMs = 500;
  private exitWindowMs = 500;
  private timelineOffsetSec = 0;

  constructor(
    audioContext: AudioContext,
    audioBuffer: AudioBuffer,
    beats: Beat[],
    onBeatChange: (beat: Beat) => void,
    onJump: (jump: JumpEvent) => void,
    onPlaybackStarted?: () => void,
    lyrics: LyricLine[] | null = null
  ) {
    this.audioContext = audioContext;
    this.audioBuffer = audioBuffer;
    this.beats = beats;
    this.onBeatChange = onBeatChange;
    this.onJump = onJump;
    this.onPlaybackStarted = onPlaybackStarted || null;
    this.lyrics = lyrics;
    this.mainGain = this.audioContext.createGain();
    this.mainGain.connect(this.audioContext.destination);
    this.epochGain = this.audioContext.createGain();
    this.epochGain.connect(this.mainGain);
    this.prepareLyricAlignment();
  }

  /**
   * Precompute every lyric-alignment constant once at construction (issue #69
   * spec Part 1): sorted line times, the LRC's own estimate of line duration
   * (median consecutive gap, capped at 8 s so a sparse LRC cannot
   * blanket-cover the song), the beat-scaled entry window (a fixed 0.5 s is
   * narrower than the beat grid on slow worship songs and would starve half
   * the Line Boundaries as landings), the fixed 0.5 s exit window, and the
   * leading-silence offset δ between the worker's trimmed timeline and the
   * original recording the LRC timestamps live on. Line times are compared
   * against beats as `beat.start + δ`. All lookups later are binary searches
   * — O(log n), no allocation, safe inside the 25 ms scheduling loop.
   * `lyrics === null` (uploads, LRC failures) short-circuits: no predicates,
   * no offset scan, behavior identical to a lyric-less engine.
   */
  private prepareLyricAlignment(): void {
    if (!this.lyrics || this.lyrics.length < 2) {
      this.lyrics = null;
      return;
    }
    this.lineTimes = this.lyrics.map(l => l.time);
    const gaps: number[] = [];
    for (let i = 1; i < this.lineTimes.length; i++) {
      gaps.push(this.lineTimes[i] - this.lineTimes[i - 1]);
    }
    gaps.sort((a, b) => a - b);
    const gapMid = gaps.length >> 1;
    const medianLineGap = gaps.length % 2 ? gaps[gapMid] : (gaps[gapMid - 1] + gaps[gapMid]) / 2;
    // Both in seconds: the 8 s cap keeps a sparse LRC (few section-marker
    // lines, huge gaps) from blanket-covering the whole song.
    this.lineExtent = Math.min(medianLineGap, 8);
    const durations = this.beats.map(b => b.duration).sort((a, b) => a - b);
    const durMid = durations.length >> 1;
    const medianBeatDuration = durations.length % 2
      ? durations[durMid]
      : (durations[durMid - 1] + durations[durMid]) / 2;
    this.entryWindowMs = Math.max(500, 1000 * medianBeatDuration);
    this.timelineOffsetSec = estimateLeadingSilenceOffset(this.audioBuffer);
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[lyric-align] leading-silence offset δ = ${(this.timelineOffsetSec * 1000).toFixed(1)} ms`);
    }
  }

  /**
   * Kill ALL audio already queued on the audio clock, instantly, by cutting the
   * generation's bus. Disconnected sources keep "playing" into nothing and
   * self-GC when their scheduled end time passes. Called on every control-plane
   * action (pause/stop/restart/seek/jump/play-from-idle) so no stale audio from
   * the previous generation survives the action.
   */
  private newEpoch(): void {
    this.epochGain.disconnect();
    this.epochGain = this.audioContext.createGain();
    this.epochGain.connect(this.mainGain);
  }

  /**
   * Defer a UI callback to an audio-clock time so visuals pulse when the beat
   * is heard, not when it was scheduled. Fires immediately when the tab is
   * hidden (background timers are clamped to ≥1s and the visuals are invisible
   * anyway — state stays roughly current on return).
   */
  private scheduleUiDispatch(when: number, cb: () => void): void {
    const delay = Math.max(0, (when - this.audioContext.currentTime) * 1000);
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      cb(); // clamped timers would lag ≥1s; state is invisible when hidden anyway
      return;
    }
    const seq = this.nextUiSeq++;
    this.uiTimers.set(seq, window.setTimeout(() => { this.uiTimers.delete(seq); cb(); }, delay));
  }

  /** Clear every pending scheduler/watchdog/UI timer. */
  private cancelTimers(): void {
    if (this.scheduleTimer !== undefined) {
      clearTimeout(this.scheduleTimer);
      this.scheduleTimer = undefined;
    }
    if (this.watchdogTimer !== undefined) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = undefined;
    }
    this.uiTimers.forEach(t => clearTimeout(t));
    this.uiTimers.clear();
    // A decided-but-undelivered jump must not fire into the next epoch: its
    // landing beat was just killed (the dispatch timer above is cleared with
    // it), so drop the carry.
    this.pendingJump = undefined;
  }

  public setJumpProbability(probability: number) {
    this.jumpProbability = probability;
  }

  public play() {
    if (this.isPlaying) {
      return;
    }
    this.cancelTimers();
    this.newEpoch();
    this.isPlaying = true;
    this.nextBeatTime = this.audioContext.currentTime;
    this.scheduleNextBeat();
  }

  public pause() {
    this.cancelTimers();
    this.newEpoch();
    // Rewind to the beat that was audible when the user hit pause. The
    // scheduling loop already queued beats ~lookaheadSeconds ahead, so
    // currentBeatIndex points ~2s past what was sounding; resuming from there
    // would skip that content.
    while (
      this.currentBeatIndex > 0 &&
      this.nextBeatTime - this.beats[this.currentBeatIndex].duration >= this.audioContext.currentTime
    ) {
      this.nextBeatTime -= this.beats[this.currentBeatIndex].duration;
      this.currentBeatIndex--;
    }
    this.nextBeatTime = Math.max(this.nextBeatTime, this.audioContext.currentTime);
    this.isPlaying = false;
    this.hasPlaybackStarted = false;
  }

  public stop() {
    this.cancelTimers();
    this.newEpoch();
    this.isPlaying = false;
    this.currentBeatIndex = 0;
    this.hasPlaybackStarted = false;
  }

  public restart() {
    this.stop();
    this.totalJumps = 0;
    // Zeroed event: the counter reset, not a jump — no beats were left or
    // landed on. Consumers that keep a jump LIST must filter count > 0.
    this.onJump({ count: 0, from: this.beats[0], to: this.beats[0] });
    this.play();
  }

  public seekToTime(time: number) {
    this.cancelTimers();
    this.newEpoch();

    // Find the beat that contains the target time
    const targetBeatIndex = this.beats.findIndex(beat => beat.start <= time && time < beat.start + beat.duration);

    if (targetBeatIndex === -1) {
      console.warn(`No beat found for time ${time}`);
      // Timers were already cancelled and the epoch cut above; a failed lookup
      // must not strand a playing engine in silence — resume scheduling from
      // where playback was.
      if (this.isPlaying) {
        this.scheduleNextBeat();
      }
      return;
    }

    // Update the current beat index
    this.currentBeatIndex = targetBeatIndex;

    // Set next beat time to current audio context time (immediate scheduling)
    this.nextBeatTime = this.audioContext.currentTime;

    // Update the UI with the new current beat
    this.onBeatChange(this.beats[targetBeatIndex]);

    // If playing, restart the scheduling from the new position
    if (this.isPlaying) {
      this.scheduleNextBeat();
    }
  }

  /**
   * Jump playback to a specific beat (Zen mode double-tap-on-tile). Fires the
   * real jump event (arc + energy beam + counter) exactly like a probabilistic
   * jump. No-op when the beat is unknown or playback is not running.
   */
  public jumpToBeat(beat: Beat): void {
    const targetIndex = this.beats.indexOf(beat);
    if (targetIndex === -1 || !this.isPlaying) return;
    this.cancelTimers();
    this.newEpoch();
    const from = this.beats[this.currentBeatIndex];
    this.currentBeatIndex = targetIndex;
    this.nextBeatTime = this.audioContext.currentTime;
    this.totalJumps++;
    this.onJump({ count: this.totalJumps, from, to: beat });
    this.onBeatChange(beat);
    // Drain nothing; next scheduled tick reschedules from the new index/time.
    this.scheduleNextBeat();
  }

  public getDuration(): number {
    return this.audioBuffer.duration;
  }

  /** Cap on beats scheduled per wake; protects against pathological beat arrays with near-zero durations. */
  private static readonly MAX_BEATS_PER_WAKE = 64;

  /** Fell off the beat array without a crossfade: stop and arm the restart watchdog. */
  private armEndOfArrayWatchdog(): void {
    this.isPlaying = false;
    this.watchdogTimer = window.setTimeout(() => this.restart(), 3000);
  }

  private scheduleNextBeat() {
    if (!this.isPlaying) {
      return;
    }

    // After any main-thread stall longer than the lookahead: skip forward to
    // the first beat whose start time is still in the future. Skipped beats are
    // silent (they were "played" during the stall in wall-clock terms) — do NOT
    // backfill them: backfilling means source.start(pastTime), the exact glitch
    // this redesign eliminates.
    while (this.nextBeatTime < this.audioContext.currentTime) {
      // The walk must honor the crossfade boundary exactly like the normal
      // loop: the fade times are recomputed from the (future) nextBeatTime, so
      // the wrap stays on-grid instead of running off the array.
      if (this.currentBeatIndex === this.beats.length - 16) {
        this.scheduleCrossfade();
        return;
      }

      const skipped = this.beats[this.currentBeatIndex];
      this.nextBeatTime += skipped.duration;
      this.currentBeatIndex++;
      // no playBeat, no onBeatChange: not audible, not visible
      if (this.currentBeatIndex >= this.beats.length) {
        // Ran off the array end during the skip walk (only reachable if the
        // boundary check above was bypassed by a jump landing past it).
        this.armEndOfArrayWatchdog();
        return;
      }
    }

    let scheduled = 0;
    while (this.nextBeatTime < this.audioContext.currentTime + this.lookaheadSeconds) {
      if (scheduled >= AudioEngine.MAX_BEATS_PER_WAKE) {
        // Pathological beat arrays: continue draining the lookahead next tick.
        break;
      }

      // Check if it's time to start the crossfade
      if (this.currentBeatIndex === this.beats.length - 16) {
        this.scheduleCrossfade();
        // The crossfade scheduling will take over from here
        return;
      }

      const currentBeat = this.beats[this.currentBeatIndex];
      // UI fires when the beat is heard, not when it is scheduled.
      this.scheduleUiDispatch(this.nextBeatTime, () => this.onBeatChange(currentBeat));

      // Trigger playback started callback on first beat
      if (!this.hasPlaybackStarted && this.onPlaybackStarted) {
        this.onPlaybackStarted();
        this.hasPlaybackStarted = true;
      }

      this.playBeat(this.currentBeatIndex, this.nextBeatTime, this.epochGain);
      this.beatsSinceLastJump++;
      scheduled++;

      if (process.env.NODE_ENV !== 'production') {
        console.log(
          `Adding beat ${this.currentBeatIndex} to buffer at ${this.nextBeatTime.toFixed(
            2
          )}s. Nominal time: ${currentBeat.start.toFixed(2)}s`
        );
      }

      const hasJumpCandidates = currentBeat.jump_candidates && currentBeat.jump_candidates.length > 0;
      const shouldJump = hasJumpCandidates && Math.random() < this.jumpProbability && this.beatsSinceLastJump >= 8;
      let nextBeat;

      if (shouldJump) {
        const jumpCandidate = this.getJumpCandidate(currentBeat);
        if (jumpCandidate) {
          nextBeat = jumpCandidate;
          this.beatsSinceLastJump = 0;
          this.totalJumps++;
          // The arc/glow fires when the landing beat sounds, so carry the
          // event to the next loop iteration (the landing beat's dispatch).
          this.pendingJump = { count: this.totalJumps, from: currentBeat, to: jumpCandidate };
        } else {
          nextBeat = this.beats[this.currentBeatIndex + 1];
        }
      } else {
        nextBeat = this.beats[this.currentBeatIndex + 1];
      }

      if (nextBeat) {
        this.nextBeatTime += currentBeat.duration;
        this.currentBeatIndex = this.beats.indexOf(nextBeat);
        if (this.pendingJump) {
          const jump = this.pendingJump;
          this.pendingJump = undefined;
          this.scheduleUiDispatch(this.nextBeatTime, () => this.onJump(jump));
        }
      } else {
        // This part should ideally not be reached due to the crossfade
        this.armEndOfArrayWatchdog();
        break;
      }
    }

    this.scheduleTimer = window.setTimeout(() => this.scheduleNextBeat(), 25);
  }

  private scheduleCrossfade() {
    if (process.env.NODE_ENV !== 'production') {
      console.log("Starting crossfade...");
    }
    // Never schedule the fade into the past: the skip-forward walk (Part 1b)
    // can hand off while nextBeatTime is still behind the audio clock; the
    // fade times recompute from here, so clamp to the audible present.
    const fadeStartTime = Math.max(this.nextBeatTime, this.audioContext.currentTime);
    let fadeTime = fadeStartTime;

    // 1. Create GainNodes for fade-out and fade-in
    const fadeOutGain = this.audioContext.createGain();
    fadeOutGain.connect(this.epochGain);
    const fadeInGain = this.audioContext.createGain();
    fadeInGain.connect(this.epochGain);

    // 2. Schedule the final 16 beats to fade out
    for (let i = 0; i < 16; i++) {
      const beatIndex = this.beats.length - 16 + i;
      const beat = this.beats[beatIndex];
      this.playBeat(beatIndex, fadeTime, fadeOutGain);
      fadeTime += beat.duration;
    }
    const fadeEndTime = fadeTime;

    // 3. Schedule the exponential fade-out
    fadeOutGain.gain.setValueAtTime(1.0, fadeStartTime);
    fadeOutGain.gain.exponentialRampToValueAtTime(0.0001, fadeEndTime);

    // 4. Schedule the first 16 beats to fade in simultaneously
    let fadeInPlayTime = fadeStartTime;
    for (let i = 0; i < 16; i++) {
      const beat = this.beats[i];
      this.scheduleUiDispatch(fadeInPlayTime, () => this.onBeatChange(beat));
      this.playBeat(i, fadeInPlayTime, fadeInGain);
      fadeInPlayTime += beat.duration;
    }

    // 5. Schedule a faster exponential fade-in over the first 8 beats
    const fadeInDuration = this.beats.slice(0, 8).reduce((acc, beat) => acc + beat.duration, 0);
    const fadeInEndTime = fadeStartTime + fadeInDuration;
    fadeInGain.gain.setValueAtTime(0.0001, fadeStartTime);
    fadeInGain.gain.exponentialRampToValueAtTime(1.0, fadeInEndTime);

    // 6. Continue playback from the 17th beat after the fade completes
    this.currentBeatIndex = 16;
    this.nextBeatTime = fadeInPlayTime; // Use the end time of the 16-beat fade-in

    // A jump that lands at the crossfade boundary: its landing beat is a
    // fade-in beat, so deliver the carried event on that beat's sound time.
    if (this.pendingJump) {
      const jump = this.pendingJump;
      this.pendingJump = undefined;
      this.scheduleUiDispatch(fadeStartTime, () => this.onJump(jump));
    }

    // 7. Resume normal scheduling a full lookahead before the fade-in's final
    // beat so the resumed loop re-enters while beats 16+ are still schedulable.
    // Beats 0-15 of the fade-in were already scheduled here (currentBeatIndex
    // is left at 16), so the resumed loop starts at beat 16 and never
    // double-schedules. If less than 25ms remains before that deadline, a 25ms
    // floor would fire late (past the deadline) and punch a silent hole in the
    // fade-in region — re-enter immediately instead.
    const resumeDelayMs = (fadeInPlayTime - this.lookaheadSeconds - this.audioContext.currentTime) * 1000;
    this.scheduleTimer = window.setTimeout(() => {
      this.scheduleNextBeat();
    }, resumeDelayMs <= 0 ? 0 : Math.max(25, resumeDelayMs));
  }

  private playBeat(beatIndex: number, time: number, destination: AudioNode) {
    const beat = this.beats[beatIndex];
    const source = this.audioContext.createBufferSource();
    source.buffer = this.audioBuffer;
    source.connect(destination);
    source.start(time, beat.start, beat.duration);

    // Dev-only instrumentation: lead time (audio-clock seconds) of every
    // scheduled beat, in a 512-entry ring on window.__iwSchedLog. Same data
    // shape as the 2026-10-06 incident probe, so the external CDP watcher
    // consumes it unchanged. placement: playBeat holds this.audioContext (a
    // prototype-patch of AudioBufferSourceNode.start could not) and sees
    // normal + crossfade beats uniformly.
    if (process.env.NODE_ENV !== 'production') {
      const ahead = time - this.audioContext.currentTime;
      const w = window as typeof window & { __iwSchedLog?: number[] };
      const log = (w.__iwSchedLog ??= []);
      log.push(ahead);
      if (log.length > 512) log.shift();
      if (ahead < 0) console.warn(`late schedule: ${(-ahead * 1000).toFixed(1)}ms`);
    }
  }

  /**
   * Binary search: the index of the last line time ≤ `t`, or −1. Mirrors
   * `lyricAt`'s lo/hi walk in lrc.ts — O(log n), no allocation.
   */
  private lineIndexAtOrBefore(t: number): number {
    let lo = 0;
    let hi = this.lineTimes.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.lineTimes[mid] <= t) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }

  /**
   * A moment `m` on the TRIMMED analysis timeline is lyric-covered iff, on the
   * original recording (`m + δ`), it lies within
   * `[l − exitWindow, l + lineExtent]` of some line time `l` (issue #69 Part
   * 2). Sung lines and their musical tails are covered; intro, mid-song
   * instrumental breaks, and the true outro (past the final line's extent) are
   * not — uncovered moments jump freely, exactly as a lyric-less song does.
   */
  private isLyricCovered(m: number): boolean {
    if (this.lyrics === null) {
      return false;
    }
    const t = m + this.timelineOffsetSec;
    const exitSec = this.exitWindowMs / 1000;
    const i = this.lineIndexAtOrBefore(t + exitSec); // latest line that could cover t
    return i !== -1 && t <= this.lineTimes[i] + this.lineExtent;
  }

  /**
   * A covered landing beat with source start `bs` is lyric-clean iff it starts
   * at or just-before a Line Boundary: `bs + δ ∈ [l − entryWindow, l]` for
   * some line `l`. A just-after landing would play the previous line's tail
   * with no beginning. Uncovered landings are instrumental — always clean.
   */
  private isEntryClean(bs: number): boolean {
    if (this.lyrics === null) {
      return true;
    }
    if (!this.isLyricCovered(bs)) {
      return true;
    }
    const t = bs + this.timelineOffsetSec;
    const entrySec = this.entryWindowMs / 1000;
    // First line AT OR AFTER t (lower bound): the boundary the landing sits at
    // or just-before. t ≤ l must hold; l − t ≤ entry makes it "just before".
    let lo = 0;
    let hi = this.lineTimes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.lineTimes[mid] < t) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo < this.lineTimes.length && this.lineTimes[lo] - t <= entrySec;
  }

  /**
   * A covered exit moment `m` (a beat's `start + duration`) is lyric-clean iff
   * it sits within the fixed exit window of some Line Boundary — just-started
   * and about-to-start cuts are both acceptable; only deep mid-line cuts are
   * suppressed. Uncovered exits are instrumental — always clean.
   */
  private isExitClean(m: number): boolean {
    if (this.lyrics === null) {
      return true;
    }
    if (!this.isLyricCovered(m)) {
      return true;
    }
    const t = m + this.timelineOffsetSec;
    const exitSec = this.exitWindowMs / 1000;
    const i = this.lineIndexAtOrBefore(t + exitSec);
    // i = latest line that could satisfy t ≥ l − exit; the remaining bound is
    // t ≤ l + exit (about-to-start side).
    return i !== -1 && t <= this.lineTimes[i] + exitSec;
  }

  private getJumpCandidate(beat: Beat): Beat | null {
    if (!beat.jump_candidates || beat.jump_candidates.length === 0) {
      console.log(`No jump candidates available for beat ${beat.id}.`);
      return null;
    }

    const currentIndex = this.beats.indexOf(beat);

    // Exit gate first (issue #69 Part 3): if this attempt's own exit cuts
    // mid-line, suppress before the roulette — no random draw is consumed and
    // the caller's fall-through keeps beatsSinceLastJump counting.
    if (!this.isExitClean(beat.start + beat.duration)) {
      return null;
    }

    const validCandidates = beat.jump_candidates.filter(beatId => {
      const candidateBeat = this.beats.find(b => b.id === beatId);
      if (!candidateBeat) return false;
      const candidateIndex = this.beats.indexOf(candidateBeat);
      if (Math.abs(candidateIndex - currentIndex) < 16) return false;
      // Lyric alignment: the landing must start at/just-before a Line
      // Boundary (or be instrumental). Unfiltered when lyrics are null.
      return this.isEntryClean(candidateBeat.start);
    });

    if (validCandidates.length === 0) {
      console.log(`No valid jump candidates at least 16 beats away for beat ${beat.id}.`);
      return null;
    }

    // Assign weights: higher weight for earlier beats (lower index)
    const candidatesWithWeights = validCandidates.map(beatId => {
      const candidateBeat = this.beats.find(b => b.id === beatId)!;
      const candidateIndex = this.beats.indexOf(candidateBeat);
      const weight = this.beats.length - candidateIndex; // Higher for lower index
      return { beatId, weight };
    });

    // Weighted random selection
    const totalWeight = candidatesWithWeights.reduce((sum, c) => sum + c.weight, 0);
    let random = Math.random() * totalWeight;
    let chosenBeatId: number;
    for (const candidate of candidatesWithWeights) {
      random -= candidate.weight;
      if (random <= 0) {
        chosenBeatId = candidate.beatId;
        break;
      }
    }

    const chosenBeat = this.beats.find(b => b.id === chosenBeatId!);

    if (chosenBeat) {
      console.log(
        `${validCandidates.length} jump candidates available for beat ${beat.id}. Probability: ${this.jumpProbability.toFixed(
          2
        )}. Chose beat ${chosenBeat.id}.`
      );
    }

    return chosenBeat || null;
  }
}
