
import { Beat } from './types';

export const createAudioBuffer = async (file: File, audioContext: AudioContext): Promise<AudioBuffer> => {
  const arrayBuffer = await file.arrayBuffer();
  return audioContext.decodeAudioData(arrayBuffer);
};

export class AudioEngine {
  private audioContext: AudioContext;
  private audioBuffer: AudioBuffer;
  private beats: Beat[] = [];
  private onBeatChange: (beat: Beat) => void;
  private jumpProbability = 0.15;
  private nextBeatTime = 0;
  private currentBeatIndex = 0;
  private isPlaying = false;
  private lookaheadSeconds = 0.1; // 100ms lookahead
  private beatsSinceLastJump = 0;
  private mainGain: GainNode;

  constructor(audioContext: AudioContext, audioBuffer: AudioBuffer, beats: Beat[], onBeatChange: (beat: Beat) => void) {
    this.audioContext = audioContext;
    this.audioBuffer = audioBuffer;
    this.beats = beats;
    this.onBeatChange = onBeatChange;
    this.mainGain = this.audioContext.createGain();
    this.mainGain.connect(this.audioContext.destination);
  }

  public setJumpProbability(probability: number) {
    this.jumpProbability = probability;
  }

  public play() {
    if (this.isPlaying) {
      return;
    }
    this.isPlaying = true;
    this.nextBeatTime = this.audioContext.currentTime;
    this.scheduleNextBeat();
  }

  public pause() {
    this.isPlaying = false;
  }

  public stop() {
    this.isPlaying = false;
    this.currentBeatIndex = 0;
  }

  public restart() {
    this.stop();
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
      this.scheduleNextBeat();
    }
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
        setTimeout(() => this.restart(), 3000);
        break;
      }
    }

    setTimeout(() => this.scheduleNextBeat(), 25);
  }

  private scheduleCrossfade() {
    console.log("Starting crossfade...");
    const fadeStartTime = this.nextBeatTime;
    let fadeTime = fadeStartTime;

    // 1. Create GainNodes for fade-out and fade-in
    const fadeOutGain = this.audioContext.createGain();
    fadeOutGain.connect(this.mainGain);
    const fadeInGain = this.audioContext.createGain();
    fadeInGain.connect(this.mainGain);

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
      this.onBeatChange(beat);
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

    // 7. Resume normal scheduling after the crossfade duration
    setTimeout(() => {
      this.scheduleNextBeat();
    }, (fadeInPlayTime - this.audioContext.currentTime) * 1000);
  }

  private playBeat(beatIndex: number, time: number, destination: AudioNode) {
    const beat = this.beats[beatIndex];
    const source = this.audioContext.createBufferSource();
    source.buffer = this.audioBuffer;
    source.connect(destination);
    source.start(time, beat.start, beat.duration);
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
