
import { Beat, JumpEvent } from './types';
import type { TelemetryHooks } from './smoothness';

/** Entry points that spawn a fresh scheduler chain (telemetry's suspect-8 set). */
type ChainOrigin = 'play' | 'seekToTime' | 'jumpToBeat' | 'crossfadeResume';

export const createAudioBuffer = async (file: File, audioContext: AudioContext): Promise<AudioBuffer> => {
  const arrayBuffer = await file.arrayBuffer();
  return audioContext.decodeAudioData(arrayBuffer);
};

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
  private lookaheadSeconds = 0.1; // 100ms lookahead
  private beatsSinceLastJump = 0;
  private totalJumps = 0;
  private mainGain: GainNode;
  private hasPlaybackStarted = false;
  /** Telemetry hooks (only when ?debug); null in normal playback. */
  private telemetry: TelemetryHooks | null = null;
  /** Outstanding chain re-arm timers — telemetry's live-chain count source. */
  private chainTimers = new Set<NodeJS.Timeout>();

  constructor(audioContext: AudioContext, audioBuffer: AudioBuffer, beats: Beat[], onBeatChange: (beat: Beat) => void, onJump: (jump: JumpEvent) => void, onPlaybackStarted?: () => void) {
    this.audioContext = audioContext;
    this.audioBuffer = audioBuffer;
    this.beats = beats;
    this.onBeatChange = onBeatChange;
    this.onJump = onJump;
    this.onPlaybackStarted = onPlaybackStarted || null;
    this.mainGain = this.audioContext.createGain();
    this.mainGain.connect(this.audioContext.destination);
  }

  public setJumpProbability(probability: number) {
    this.jumpProbability = probability;
  }

  /** The engine's output bus — telemetry's in-chain gap tap splices after it. */
  public get outputNode(): GainNode {
    return this.mainGain;
  }

  /**
   * Attach telemetry after construction: the telemetry module needs the
   * engine's mainGain (created in the constructor) to splice its worklet
   * tap, so pages construct the engine first and attach hooks here — before
   * any play() call, so no beat is missed.
   */
  public setTelemetry(hooks: TelemetryHooks | null) {
    this.telemetry = hooks;
  }

  public play() {
    if (this.isPlaying) {
      return;
    }
    this.isPlaying = true;
    this.nextBeatTime = this.audioContext.currentTime;
    this.spawnChain('play');
    this.scheduleNextBeat();
  }

  /**
   * Register a scheduler-chain entry point for telemetry (suspect 8): the
   * timer chain's own re-arm does NOT go through here — only fresh chains
   * spawned from play/seek/jump/restart/crossfade-resume count as EXTRA.
   */
  private spawnChain(origin: ChainOrigin) {
    this.telemetry?.onExtraChain(origin);
    this.telemetry?.onChainCount(this.chainTimers.size + 1);
  }

  public pause() {
    this.isPlaying = false;
    this.hasPlaybackStarted = false;
    // Telemetry: disarm the gap tap — silence across a pause is idle.
    this.telemetry?.onPlaybackPaused();
  }

  public stop() {
    this.isPlaying = false;
    this.currentBeatIndex = 0;
    this.hasPlaybackStarted = false;
    // Telemetry: disarm the gap tap — silence across a stop is idle.
    this.telemetry?.onPlaybackPaused();
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
    // Find the beat that contains the target time
    const targetBeatIndex = this.beats.findIndex(beat => beat.start <= time && time < beat.start + beat.duration);

    if (targetBeatIndex === -1) {
      console.warn(`No beat found for time ${time}`);
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
      this.spawnChain('seekToTime');
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
    const from = this.beats[this.currentBeatIndex];
    this.currentBeatIndex = targetIndex;
    this.nextBeatTime = this.audioContext.currentTime;
    this.totalJumps++;
    this.onJump({ count: this.totalJumps, from, to: beat });
    this.onBeatChange(beat);
    // Drain nothing; next scheduled tick reschedules from the new index/time.
    this.spawnChain('jumpToBeat');
    this.scheduleNextBeat();
  }

  public getDuration(): number {
    return this.audioBuffer.duration;
  }

  private scheduleNextBeat() {
    if (!this.isPlaying) {
      return;
    }

    while (this.nextBeatTime < this.audioContext.currentTime + this.lookaheadSeconds) {
      // Check if it's time to start the crossfade
      if (this.currentBeatIndex === this.beats.length - 16) {
        this.scheduleCrossfade();
        // The crossfade scheduling will take over from here
        return;
      }

      const currentBeat = this.beats[this.currentBeatIndex];
      this.onBeatChange(currentBeat);

      // First beat: fire the page callback and arm telemetry's gap detection
      // at the first audible beat — silence before playback is not a dropout.
      if (!this.hasPlaybackStarted) {
        this.telemetry?.onPlaybackArmed(this.nextBeatTime);
        this.onPlaybackStarted?.();
        this.hasPlaybackStarted = true;
      }

      this.playBeat(this.currentBeatIndex, this.nextBeatTime, this.mainGain);
      this.beatsSinceLastJump++;

      console.log(
        `Adding beat ${this.currentBeatIndex} to buffer at ${this.nextBeatTime.toFixed(
          2
        )}s. Nominal time: ${currentBeat.start.toFixed(2)}s`
      );

      const hasJumpCandidates = currentBeat.jump_candidates && currentBeat.jump_candidates.length > 0;
      const shouldJump = hasJumpCandidates && Math.random() < this.jumpProbability && this.beatsSinceLastJump >= 8;
      let nextBeat;

      if (shouldJump) {
        const jumpCandidate = this.getJumpCandidate(currentBeat);
        if (jumpCandidate) {
          nextBeat = jumpCandidate;
          this.beatsSinceLastJump = 0;
          this.totalJumps++;
          this.telemetry?.onJumpCount(this.totalJumps);
          this.onJump({ count: this.totalJumps, from: currentBeat, to: jumpCandidate });
        } else {
          nextBeat = this.beats[this.currentBeatIndex + 1];
        }
      } else {
        nextBeat = this.beats[this.currentBeatIndex + 1];
      }

      if (nextBeat) {
        this.nextBeatTime += currentBeat.duration;
        this.currentBeatIndex = this.beats.indexOf(nextBeat);
      } else {
        // This part should ideally not be reached due to the crossfade
        this.isPlaying = false;
        this.telemetry?.onRestartWithoutCrossfade(this.currentBeatIndex, this.beats.length);
        setTimeout(() => this.restart(), 3000);
        break;
      }
    }

    this.rearmChainTimer(25);
  }

  /**
   * Arm one scheduler-chain timer: fires scheduleNextBeat after `delayMs`,
   * tracks the outstanding timer so telemetry's live-chain count is
   * engine-authoritative (suspect 8 accounting).
   */
  private rearmChainTimer(delayMs: number) {
    const timer = setTimeout(() => {
      this.chainTimers.delete(timer);
      this.scheduleNextBeat();
    }, delayMs);
    this.chainTimers.add(timer);
    this.telemetry?.onChainCount(this.chainTimers.size);
  }

  private scheduleCrossfade() {
    console.log("Starting crossfade...");
    this.telemetry?.onCrossfadeStart();
    const fadeStartTime = this.nextBeatTime;
    let fadeTime = fadeStartTime;

    // 1. Create GainNodes for fade-out and fade-in
    const fadeOutGain = this.audioContext.createGain();
    fadeOutGain.connect(this.mainGain);
    const fadeInGain = this.audioContext.createGain();
    fadeInGain.connect(this.mainGain);
    // Telemetry (suspect 3): count the pair on creation — observation only;
    // cleanup is a Phase-4 fix gated on before-fix captures.
    this.telemetry?.onCrossfadeGainsCreated();

    // 2. Schedule the final 16 beats to fade out
    for (let i = 0; i < 16; i++) {
      const beatIndex = this.beats.length - 16 + i;
      this.playBeat(beatIndex, fadeTime, fadeOutGain, 'crossfadeOut');
      fadeTime += this.beats[beatIndex].duration;
    }
    const fadeEndTime = fadeTime;

    // 3. Schedule the exponential fade-out
    fadeOutGain.gain.setValueAtTime(1.0, fadeStartTime);
    fadeOutGain.gain.exponentialRampToValueAtTime(0.0001, fadeEndTime);

    // 4. Schedule the first 16 beats to fade in simultaneously
    let fadeInPlayTime = fadeStartTime;
    for (let i = 0; i < 16; i++) {
      const beat = this.beats[i];
      this.onBeatChange(beat);
      this.playBeat(i, fadeInPlayTime, fadeInGain, 'crossfadeIn');
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

    // 7. Resume normal scheduling after the crossfade duration
    const resumeDelayMs = (fadeInPlayTime - this.audioContext.currentTime) * 1000;
    this.spawnChain('crossfadeResume');
    this.rearmChainTimer(resumeDelayMs);
  }

  private playBeat(beatIndex: number, time: number, destination: AudioNode, leg: 'main' | 'crossfadeOut' | 'crossfadeIn' = 'main') {
    const beat = this.beats[beatIndex];
    const source = this.audioContext.createBufferSource();
    source.buffer = this.audioBuffer;
    source.connect(destination);
    source.start(time, beat.start, beat.duration);
    // Telemetry: drift = lookahead slack at scheduling; late = start time
    // already passed. Both crossfade legs get the crossfade-tagged hook —
    // one record per scheduled beat, never two.
    if (this.telemetry) {
      const ct = this.audioContext.currentTime;
      const drift = time - ct;
      const late = time <= ct;
      if (leg === 'main') this.telemetry.onBeatScheduled(beat, drift, late);
      else this.telemetry.onCrossfadeLegBeat(beat, drift, late);
    }
    this.telemetry?.onNodeCreated(source);
  }

  private getJumpCandidate(beat: Beat): Beat | null {
    if (!beat.jump_candidates || beat.jump_candidates.length === 0) {
      console.log(`No jump candidates available for beat ${beat.id}.`);
      return null;
    }

    const currentIndex = this.beats.indexOf(beat);
    const validCandidates = beat.jump_candidates.filter(beatId => {
      const candidateBeat = this.beats.find(b => b.id === beatId);
      if (!candidateBeat) return false;
      const candidateIndex = this.beats.indexOf(candidateBeat);
      return Math.abs(candidateIndex - currentIndex) >= 16;
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
