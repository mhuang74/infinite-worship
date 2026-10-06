# Infinite Worship

A web app that plays worship songs as a seamless, endless remix by jumping probabilistically between acoustically similar beats.

## Language

**Song Source**:
How a Song came to exist: the user's own upload, or a selection from the SOW Song Catalog.
_Avoid_: import type, origin

**SOW Song Catalog**:
The collection of songs and recordings managed by the Stream of Worship app. A catalog Song is metadata only; its audio is a Recording, content-addressed by the SHA-256 of its audio.
_Avoid_: SOW library, catalog DB

**Import**:
The act of selecting a song from the SOW Song Catalog, making it a Song from that source. Importing the same recording twice is free: the Analysis already exists.
_Avoid_: SOW song (as a noun), catalog song (as a noun)

**Song**:
An audio track plus its metadata (title, duration, status), from upload or import. Immutable once ready.
_Avoid_: track, file, upload (as a noun)

**Song ID**:
The identity of a Song. Identical audio arriving the same way is the same Song; identical audio arriving through different sources is two Songs that share their audio-derived artifacts.
_Avoid_: upload id, file hash

**Analysis**:
The computed remix structure of a Song's audio: beats with cluster, segment, and jump-candidate assignments. Consumed by the player as JSON. Identical audio is analyzed once regardless of source.
_Avoid_: pickle, jukebox object, segments file

**Song Status**:
Lifecycle of a Song through the analysis pipeline: `pending` (awaiting analysis, after upload or import) → `processing` → `ready` | `failed`. Only `ready` Songs are playable.
_Avoid_: state, job state

**Player**:
The client-side Web Audio scheduler that plays a ready Song forever by jumping between similar beats.
_Avoid_: engine, frontend

**Worker**:
The component that runs audio analysis on a pending Song and produces its Analysis.
_Avoid_: backend, server (the old Flask app is "the legacy backend")

**Content Hash**:
The SHA-256 of a Song's audio. The key under which the Analysis is stored; identical audio from any source shares one Analysis.
_Avoid_: song hash, file hash (ambiguous with Song ID)

**Lyrics**:
Time-synced lyric lines for a Song's original linear recording, displayed one line at a time during playback, following the source position of the audio currently sounding — so they remain correct across jumps. Only Songs whose catalog recording has curated Lyrics are offered from the SOW Song Catalog.
_Avoid_: LRC (storage format), karaoke overlay
