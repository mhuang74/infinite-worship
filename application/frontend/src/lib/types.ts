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

/** One remix jump: the playback left `from` and landed on `to` (issue #39). */
export interface JumpEvent {
  /** Running count of jumps including this one. */
  count: number;
  from: Beat;
  to: Beat;
}

export type SongStatus = 'pending' | 'processing' | 'ready' | 'failed';

export interface Song {
  song_id: string;
  title: string;
  duration: number | null;
  status: SongStatus;
  audio_url: string | null;
  analysis_url: string | null;
  failure_reason?: string | null;
  /** How the Song arrived: 'upload' or 'sow' (migration 0002; uploads get 'upload'). */
  source: 'upload' | 'sow';
  /** SOW recording content hash (64-hex) iff source = 'sow'. */
  sow_recording_id: string | null;
  created_at: string;
}

/** Response of POST /api/uploads: everything the browser needs to PUT the file. */
export interface UploadTicket {
  song_id: string;
  /** Presigned R2 PUT URL; PUT the raw file to it with the signed Content-Type. */
  upload_url: string;
  /** Object key the file lands at in the bucket (e.g. `media/<song_id>`). */
  key: string;
  /** Final public URL of the audio once uploaded (null if no public base configured). */
  audio_url: string | null;
}

export interface UploadRequest {
  song_id: string;
  title: string;
  contentType: string;
}
