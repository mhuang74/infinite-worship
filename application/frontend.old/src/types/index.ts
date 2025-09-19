export interface Segment {
  id: number;
  start: number;
  duration: number;
  cluster: number;
  segment: number;
  is: number;
  amplitude: number;
  next: number;
  jump_candidates: number[];
}

export interface SongData {
  song_id: string;
  segments: Segment[];
  duration: number;
  tempo: number;
  sample_rate: number;
}

export interface PlaybackState {
  currentSegment: number;
  nextSegment: number;
  nextJumpFrom: number,
  nextJumpTo: number,
  beatsUntilJump: number;
  currentTime: number;
} 