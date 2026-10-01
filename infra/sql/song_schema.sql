-- Song table for Infinite Worship (serverless migration)
-- Per ADR-0001/0002: metadata lives in serverless Postgres (Neon);
-- audio + Analysis JSON live in Cloudflare R2, referenced by URL here.
--
-- Song Status lifecycle (CONTEXT.md): pending -> processing -> ready | failed
-- Only `ready` Songs are playable.

CREATE TABLE songs (
    song_id      text PRIMARY KEY,               -- base64(filename) + '_' + sha256(contents)
    title        text NOT NULL,
    duration     real,                           -- seconds
    status       text NOT NULL DEFAULT 'pending'
                 CONSTRAINT songs_status_valid CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
    audio_url    text,
    analysis_url text,
    created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN songs.song_id IS 'base64(filename) + ''_'' + sha256(contents); content-addressed, immutable once ready';
COMMENT ON COLUMN songs.audio_url IS 'Public R2 custom-domain URL of the uploaded audio object';
COMMENT ON COLUMN songs.analysis_url IS 'Public R2 custom-domain URL of the Analysis JSON object';
