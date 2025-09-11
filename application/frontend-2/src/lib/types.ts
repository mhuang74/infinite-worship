
export interface Beat {
  id: number;
  start: number;
  duration: number;
  cluster: number;
}

export interface Cluster {
  id: number;
  beats: number[];
}
