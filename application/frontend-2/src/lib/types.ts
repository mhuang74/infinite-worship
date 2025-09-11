
export interface Beat {
  id: number;
  start: number;
  duration: number;
  cluster: number;
  segment: number;
  jump_candidates: number[];
}

export interface Cluster {
  id: number;
  beats: number[];
}
