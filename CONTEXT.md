# Infinite Worship

A web app that plays worship songs as a seamless, endless remix by jumping probabilistically between acoustically similar beats.

## Language

**Song Source**:
How a Song came to exist: a User's own upload, or a selection from the SOW Song Catalog.
_Avoid_: import type, origin, unified catalog

**SOW Song Catalog**:
The collection of songs and recordings managed by the Stream of Worship app. A catalog Song is metadata only; its audio is a Recording, content-addressed by the SHA-256 of its audio. Catalog Songs are curated in SOW; users cannot add to or remove from the Catalog, and catalog contents are the same for all Users.
_Avoid_: SOW library, catalog DB, unified catalog (uploads are never catalog content)

**User**:
A visitor of the app whose Library is kept separate from every other visitor's, distinguished without accounts or login. Each User owns exactly one Library.
_Avoid_: account, profile, session

**Library**:
A User's collection of Songs they chose to listen to: Songs they Imported from the Catalog and Songs they uploaded themselves. A Library never contains Songs uploaded by other Users, and Library membership is the only thing Users see that is personal to them.
_Avoid_: catalog, song list

**Import**:
The act of a User selecting a song from the SOW Song Catalog and adding it to that User's Library. If no Song exists for the recording yet, one is created; either way the User's Library gains an entry immediately. Importing the same recording twice is free: the Analysis already exists.
_Avoid_: SOW song (as a noun), catalog song (as a noun)

**Imported Song**:
A Song whose first existence came from an Import. Re-importing the same recording is free: the Analysis already exists.
_Avoid_: SOW song (as a noun), catalog song (as a noun)

**Song**:
An audio track plus its metadata (title, duration, status), from upload or import. Immutable once ready. A Song is global infrastructure — Library membership, not Song identity, is what Users see.
_Avoid_: track, file, upload (as a noun)

**Upload Visibility**:
Uploaded Songs are visible only to the User who uploaded them; they are never shown to, playable by, or addable by other Users. Byte-identical uploads by different Users share one Song and its Analysis via the Content Hash, but each User's Library gains its own entry.
_Avoid_: publishing, sharing, contributing

**Song ID**:
The identity of a Song. Uploaded Songs are content-addressed: byte-identical audio is one Song regardless of filename or who uploaded it. Identical audio arriving through different sources is two Songs that share their audio-derived artifacts. Every form embeds the audio's Content Hash.
_Avoid_: upload id, file hash, filename-derived id

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

**Line Boundary**:
The moment a Lyrics line begins on the source recording. All parsed line times count as Line Boundaries — including Gap Placeholder lines with empty text. The Player's automatic jumps are lyric-aligned: a jump's cut and its landing coincide with Line Boundaries (within the alignment windows), while instrumental stretches — intro, mid-song break, outro — jump freely as before.
_Avoid_: lyric timestamp, line start time
