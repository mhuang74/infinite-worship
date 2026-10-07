// PROTOTYPE — throwaway seed data for ticket #53's /prototype/catalog route.
// Not production; not fetched from anywhere. Mirrors the SOW catalog shape
// #50 expects the BFF to expose (songs + recordings display cols) plus the
// #52 imported-side state, in a font-derived fake.

export interface CatalogSong {
  /** SOW song id (stable across hash revisions, per #52's sow_recording_id story). */
  song_id: string;
  title: string;
  artist: string | null;
  /** Recording duration in seconds. */
  duration_seconds: number;
  /** Per-recording tempo from allin1/librosa (#50); null = not computed. */
  tempo_bpm: number | null;
  musical_key: string | null;
  /** A first LRC line, where lyrics exist, for the browse preview question. */
  lyrics_preview: string | null;
  /** The IW-side state per #52: null = not imported, 'selected' = pending,
   * 'ready' = analyzed, 'failed' = failed with reason. */
  imported_status: 'selected' | 'ready' | 'failed' | null;
  failure_reason?: string;
}

export const CATALOG_SEED: CatalogSong[] = [
  {
    song_id: 'sow_1',
    title: 'Way Maker',
    artist: 'Sinach',
    duration_seconds: 386,
    tempo_bpm: 76,
    musical_key: 'D',
    lyrics_preview: 'You are here, moving in our midst…',
    imported_status: null,
  },
  {
    song_id: 'sow_2',
    title: 'Goodness of God',
    artist: 'Bethel Music',
    duration_seconds: 341,
    tempo_bpm: 71,
    musical_key: 'G',
    lyrics_preview: 'I love You, Lord…',
    imported_status: null,
  },
  {
    song_id: 'sow_3',
    title: 'Build My Life',
    artist: 'Housefires',
    duration_seconds: 294,
    tempo_bpm: 83,
    musical_key: null,
    lyrics_preview: null,
    imported_status: null,
  },
  {
    song_id: 'sow_4',
    title: 'Reckless Love',
    artist: 'Cory Asbury',
    duration_seconds: 335,
    tempo_bpm: 150,
    musical_key: 'A',
    lyrics_preview: 'Before I spoke a word, You were breathing over me…',
    imported_status: null,
  },
  {
    song_id: 'sow_5',
    title: 'What A Beautiful Name',
    artist: 'Hillsong Worship',
    duration_seconds: 354,
    tempo_bpm: 136,
    musical_key: 'D',
    lyrics_preview: 'You were the Word at the beginning…',
    imported_status: null,
  },
  {
    song_id: 'sow_6',
    title: 'Amazing Grace',
    artist: 'Traditional',
    duration_seconds: 289,
    tempo_bpm: 92,
    musical_key: 'G',
    lyrics_preview: 'Amazing grace, how sweet the sound…',
    imported_status: 'ready',
  },
  {
    song_id: 'sow_7',
    title: 'How Great Thou Art',
    artist: 'Traditional',
    duration_seconds: 271,
    tempo_bpm: 65,
    musical_key: null,
    lyrics_preview: 'O Lord my God, when I in awesome wonder…',
    imported_status: null,
  },
];
