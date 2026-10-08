-- Migration 0003: per-user Libraries (issue #63).
--
-- A Library is a User's collection of Songs they chose to listen to: Songs
-- they Imported from the SOW Song Catalog and Songs they uploaded themselves
-- (CONTEXT.md "Library"). Song rows stay global and content-addressed —
-- Library membership is the only user-facing thing that is personal, so the
-- membership lives in its own table keyed by an opaque User ID:
--
--   users              one row per browser-scoped cookie ID; the ID is
--                      minted by the BFF (src/lib/user.ts), never a login.
--   library_entries    (user_id, song_id) membership; a Song can sit in any
--                      number of Libraries. ON DELETE CASCADE on song_id
--                      only — Song rows are never deleted by app code, so
--                      the cascade is a safety net, not a routine path.
--
-- Seeding: the first User to visit after this migration gets every existing
-- `ready` Song in their Library (the pre-#63 app had one shared Library);
-- see src/lib/user.ts ensureUser. Imports/uploads after that create entries
-- directly.
--
-- Apply to the Neon project AFTER 0002_add_sow_import.sql:
--   psql "$NEON_CONNECTION_URI" -f sql/migrations/0003_per_user_library.sql
--
-- Additive and idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS users (
    user_id    text PRIMARY KEY,              -- opaque 'u_' + 32-hex random
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS library_entries (
    user_id   text NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    song_id   text NOT NULL REFERENCES songs (song_id) ON DELETE CASCADE,
    added_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, song_id)
);

CREATE INDEX IF NOT EXISTS library_entries_by_song
  ON library_entries (song_id);

COMMENT ON TABLE users IS
  'One row per User (anonymous browser-scoped cookie ID minted by the BFF; no login)';
COMMENT ON TABLE library_entries IS
  'Library membership: a User''s Imported and self-uploaded Songs (CONTEXT.md "Library")';
