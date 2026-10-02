# Infinite Worship

A web app that plays worship songs as a seamless, endless remix by jumping probabilistically between acoustically similar beats.

## Language

**Song**:
An uploaded audio track plus its metadata (title, duration, status). Immutable once ready.
_Avoid_: track, file, upload (as a noun)

**Song ID**:
`base64(filename) + '_' + sha256(contents)`. Content-addressed: re-uploading the same file yields the same Song.
_Avoid_: upload id, file hash

**Analysis**:
The computed remix structure of a Song: beats with cluster, segment, and jump-candidate assignments. Consumed by the player as JSON.
_Avoid_: pickle, jukebox object, segments file

**Song Status**:
Lifecycle of a Song through the analysis pipeline: `pending` (uploaded, awaiting analysis) → `processing` → `ready` | `failed`. Only `ready` Songs are playable.
_Avoid_: state, job state

**Player**:
The client-side Web Audio scheduler that plays a ready Song forever by jumping between similar beats.
_Avoid_: engine, frontend

**Worker**:
The component that runs audio analysis on a pending Song and produces its Analysis.
_Avoid_: backend, server (the old Flask app is "the legacy backend")
