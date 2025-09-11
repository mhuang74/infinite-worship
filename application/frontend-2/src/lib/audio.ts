
import { Beat, Cluster } from './types';

export const createAudioBuffer = async (file: File, audioContext: AudioContext): Promise<AudioBuffer> => {
  const arrayBuffer = await file.arrayBuffer();
  return audioContext.decodeAudioData(arrayBuffer);
};

export class AudioEngine {
  private audioContext: AudioContext;
  private audioBuffer: AudioBuffer;
  private beats: Beat[] = [];
  private clusters: Cluster[] = [];
  private onBeatChange: (beat: Beat) => void;
  private jumpProbability = 0.5;
  private nextBeatTime = 0;
  private currentBeatIndex = 0;
  private isPlaying = false;
  private lookaheadSeconds = 0.1; // 100ms lookahead

  constructor(audioContext: AudioContext, audioBuffer: AudioBuffer, beats: Beat[], onBeatChange: (beat: Beat) => void) {
    this.audioContext = audioContext;
    this.audioBuffer = audioBuffer;
    this.beats = beats;
    this.onBeatChange = onBeatChange;
  }

  public setClusters(clusters: Cluster[]) {
    this.clusters = clusters;
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

  private scheduleNextBeat() {
    if (!this.isPlaying) {
      return;
    }

    while (this.nextBeatTime < this.audioContext.currentTime + this.lookaheadSeconds) {
      this.onBeatChange(this.beats[this.currentBeatIndex]);
      this.playBeat(this.currentBeatIndex, this.nextBeatTime);

      const currentBeat = this.beats[this.currentBeatIndex];
      const nextBeat = this.shouldJump()
        ? this.getRandomBeatInSameCluster(currentBeat)
        : this.beats[this.currentBeatIndex + 1];

      if (nextBeat) {
        this.nextBeatTime += currentBeat.duration;
        this.currentBeatIndex = this.beats.indexOf(nextBeat);
      } else {
        this.stop();
        break;
      }
    }

    setTimeout(() => this.scheduleNextBeat(), 25); // Check every 25ms
  }

  private playBeat(beatIndex: number, time: number) {
    const beat = this.beats[beatIndex];
    const source = this.audioContext.createBufferSource();
    source.buffer = this.audioBuffer;
    source.connect(this.audioContext.destination);
    source.start(time, beat.start, beat.duration);
  }

  private shouldJump(): boolean {
    return Math.random() < this.jumpProbability;
  }

  private getRandomBeatInSameCluster(beat: Beat): Beat {
    const cluster = this.clusters.find(c => c.beats.includes(beat.id));
    if (!cluster || cluster.beats.length <= 1) {
      return this.beats[this.currentBeatIndex + 1];
    }

    const otherBeatsInCluster = cluster.beats.filter(bId => bId !== beat.id);
    const randomBeatId = otherBeatsInCluster[Math.floor(Math.random() * otherBeatsInCluster.length)];
    return this.beats.find(b => b.id === randomBeatId) || this.beats[this.currentBeatIndex + 1];
  }
}
