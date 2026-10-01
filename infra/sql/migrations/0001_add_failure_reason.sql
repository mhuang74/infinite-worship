-- Migration 0001: additive failure-reason column for the analysis worker.
--
-- Base schema (sql/song_schema.sql) has no column recording WHY a Song went
-- to status='failed'; the analysis Lambda (worker/handler.py) needs one for
-- oversized/wrong-type/>10-minute rejections (ADR-0001).
--
-- Apply to the Neon project AFTER sql/song_schema.sql:
--   psql "$NEON_CONNECTION_URI" -f sql/migrations/0001_add_failure_reason.sql
--
-- Additive and idempotent: safe to re-run.

ALTER TABLE songs ADD COLUMN IF NOT EXISTS failure_reason text;

COMMENT ON COLUMN songs.failure_reason IS
  'Why analysis failed (e.g. ''audio exceeds 10 minute limit''); NULL unless status = ''failed''';
