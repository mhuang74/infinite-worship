-- Migration 0002: columns backing SOW-catalog imports (#52, #55).
--
-- An Imported Song is a Song created by an Import (CONTEXT.md). Imports are
-- one row per SOW recording content hash, so identity/idempotency is carried
-- by columns on `songs`, not by the song_id format:
--
--   source            'upload' (default) or 'sow'; uploads untouched.
--   sow_recording_id  the SOW recording's full 64-hex content hash.
--                     Import song_id = 'imp_' + this hash. Partial unique
--                     index makes re-import idempotent (same row, no dup).
--   content_hash      bare-hex audio hash (upload: from the song_id suffix).
--                     Makes the dedupe fast path (HeadObject
--                     analysis/<content_hash>.json) an index scan instead of
--                     slicing song_id.
--   lyrics_url        public R2 custom-domain URL of the lyrics object
--                     (LRC copy for imports; NULL for uploads).
--
-- Apply to the Neon project AFTER 0001_add_failure_reason.sql:
--   psql "$NEON_CONNECTION_URI" -f sql/migrations/0002_add_sow_import.sql
--
-- Additive and idempotent: safe to re-run.

ALTER TABLE songs ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'upload'
  CONSTRAINT songs_source_valid CHECK (source IN ('upload', 'sow'));

ALTER TABLE songs ADD COLUMN IF NOT EXISTS sow_recording_id text;

-- The iff constraint replaces a previously deployed one-sided guard
-- (songs_sow_recording_id_only_for_imports); drop both names then re-add so
-- a re-run converges from either state.
ALTER TABLE songs DROP CONSTRAINT IF EXISTS songs_sow_recording_id_only_for_imports;
ALTER TABLE songs DROP CONSTRAINT IF EXISTS songs_sow_recording_id_iff_import;
ALTER TABLE songs ADD CONSTRAINT songs_sow_recording_id_iff_import
  CHECK ((source = 'sow') = (sow_recording_id IS NOT NULL));

ALTER TABLE songs ADD COLUMN IF NOT EXISTS content_hash text;

ALTER TABLE songs ADD COLUMN IF NOT EXISTS lyrics_url text;

CREATE UNIQUE INDEX IF NOT EXISTS songs_one_row_per_sow_recording
  ON songs (sow_recording_id) WHERE sow_recording_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS songs_content_hash
  ON songs (content_hash) WHERE content_hash IS NOT NULL;

COMMENT ON COLUMN songs.source IS
  'How the Song arrived: ''upload'' (browser upload) or ''sow'' (SOW Song Catalog import)';
COMMENT ON COLUMN songs.sow_recording_id IS
  'SOW recording content hash (64-hex) iff source = ''sow''; import song_id is ''imp_'' + this value';
COMMENT ON COLUMN songs.content_hash IS
  'SHA-256 hex of the audio; Analysis JSON is keyed analysis/<content_hash>.json for all Songs';
COMMENT ON COLUMN songs.lyrics_url IS
  'Public R2 custom-domain URL of the lyrics object (LRC copy); NULL for uploads';
