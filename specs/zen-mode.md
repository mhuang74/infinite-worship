# Infinite Worship — Zen Mode (Spec)

Status: **approved design brief, decided via structured interview, 2026-10-04. Not yet implemented.**

## Problem Statement

A listener wants to enjoy the endless remix for a long, uninterrupted session with nothing on screen except the visualization — no playback controls, no song switching, no upload UI, no metadata — on both desktop and mobile. Today the only way to listen is the main library page, which is built for control (tabs, library lists, upload, probability sliders, metadata), not for lean-back listening.

## Solution

A fullscreen **Zen Mode** entered via a button in the playback area of the main page. It takes over the screen with a single circular, EternalJukebox-style visualization of the currently playing Song and keeps the remix playing, untouched, for as long as the listener leaves it. The only chrome is a self-hiding exit ✕. Audio continues seamlessly when leaving the mode back to the normal Player.

## User Stories

1. As a listener, I want a single button to drop the currently playing Song into a distraction-free fullscreen visualization, so that I can stop interacting and just listen.
2. As a listener, I want the mode to fill my entire screen including browser and OS chrome where possible, so that the visualization is the only thing visible.
3. As a mobile listener, I want the mode to work on my phone even where true OS fullscreen is unavailable, so that I still get a chromeless app view.
4. As a listener, I want the remix to keep playing indefinitely without me touching anything, so that long sessions never demand attention.
5. As a listener, I want the visualization to show the song as a ring of beats that lights up as it plays, so that I can watch the structure evolve in real time.
6. As a listener, I want distinct colors for acoustically different beats, so that the ring reads as the song's acoustic map, not just decoration.
7. As a listener, I want a visible flash whenever the remix jumps to a matching beat, so that I can see the "whoosh" moment the Infinite Jukebox is famous for.
8. As a listener, I want to see where in the ring playback currently is, so that I can follow progress around the circle.
9. As a listener, I want the position to remain obvious from across the room, so that I can glance at the screen without approaching it.
10. As a listener on a phone, I want the visualization to stay correctly sized whether I hold the screen portrait or landscape, so that the circle doesn't reflow or crop.
11. As a mobile listener, I want my screen to stay on during a session, so that I'm not forced to keep unlocking to keep watching the ring.
12. As a mobile listener, I want a graceful fallback if keeping the screen on isn't supported, so that the music still plays even when the visual can't stay up.
13. As a listener, I want entry to be one tap that starts the animation immediately, so that the mode never dead-ends on a browser autoplay block.
14. As a listener, I want a clear recovery path in the rare case the tap isn't enough to start audio, so that I'm never stuck on a silent screen.
15. As a listener, I want animation to be efficient enough that the phone doesn't drain the battery faster than listening already does, even with the screen kept on.
16. As a motion-sensitive user, I want flashy pulses and arcs suppressed when my OS is set to reduced motion, so that the mode doesn't cause discomfort.
17. As a listener, I want an obvious way back out that doesn't get in the way while I'm watching, so that I'm never trapped and never annoyed.
18. As a listener, I want the exit affordance to reappear if I wiggle or tap the screen, so that I don't have to remember a secret gesture on mobile.
19. As a listener, I want the audio to keep playing when I exit back to the normal player, so that leaving the visualization doesn't interrupt the song.
20. As a listener, I want my playback statistics (jumps, time) from the zen session to carry through to the normal player, so that exiting doesn't lose the session.
21. As a listener, I want the same failure feedback as the main page if the Song's audio can't be loaded, so that I'm told what went wrong and can exit.
22. As a keyboard user, I want the escape key to exit zen mode, so that I don't have to locate the ✕ with a pointer.
23. As a desktop user, I want browser-level fullscreen to disengage when I exit zen mode, so I don't end up in fullscreen with no visualization.
24. As a listener, I want the entry button disabled clearly when nothing is playing, so that I understand I need to start a Song first.
25. As a developer, I want the visualization drawing logic isolated from React and DOM, so that I can verify it headlessly without a test framework.

## Implementation Decisions

### Surface & entry

- New module `ZenMode` (a React component) mounted from the main page, overlaid on everything else when active. It is the only new UI surface.
- A new control added to the existing playback-controls component: a fullscreen/expand icon, enabled only when a Song is loaded into the Player and playing. Placement: beside the existing play/pause control.
- Entry click is a real user gesture, so the Web Audio context is already unlocked.

### Fullscreen strategy

- Two layers, attempted together:
  1. Chromeless app view — always works: the overlay hides all app UI (header, tabs, library, controls, metadata).
  2. OS fullscreen via `requestFullscreen()` on the overlay element — attempted as a bonus; silently ignored where unsupported.
- Known limitation preserved deliberately: iPhone Safari does not support Fullscreen API on arbitrary elements, so layer 2 is a no-op there; layer 1 still delivers the zen view.
- Exiting zen mode exits layer 2 (if active) as part of the same exit path.

### Visualization (the core change)

- The visualization is a **circle of tiles, one tile per beat of the Analysis, placed sequentially around the ring** (EternalJukebox's actual layout, not segment wedges or cluster grouping).
- Tile color: `beat.cluster` mapped to the app's existing jewel palette (the same classes the waveform view uses), keeping the visual language consistent.
- Playhead: the current tile brightens/scales with a decaying glow, plus a thin sweep indicator aiming at the current tile; on a jump, both re-aim.
- Jump feedback: on each jump, a single transient arc through the center connects the source beat tile to the destination beat tile, fading over ~1s. No permanent edge web is drawn.
- Layout: the ring occupies the largest square that fits the viewport (`min(vw, vh)`), centered; remaining space is left dark. No orientation lock or rotation.
- Rendering: a single `<canvas>`. Draw happens on each beat change; a short fade pass (bounded, ~1s) handles glow/arc decay, then the screen is static until the next beat. No continuous rAF loop.
- `prefers-reduced-motion: reduce` suppresses the decaying glow and the arc flash; the current tile still highlights statically.
- No new dependencies.

### Player callback contract change

- The Player's jump notification callback must carry the **source beat and destination beat of the jump** (today it carries only the running count of jumps). This is required to draw the center arc with exact endpoints. The main page, which currently consumes the count, will continue to derive it (e.g. via its own increment) or accept the count as an additional argument — the important change is adding the beat pair.
- Rationale (verified during design): inferring the jump in the UI from a non-adjacent `onBeatChange` index misfires on the Player's internal crossfade, which resets the play index and replays earlier beats — visually a jump that is not one.

### Audio & session lifecycle

- One Song, remixed forever, until the user exits – no rotation to other songs.
- The Player instance is **not** torn down on mode entry or exit; zen mode is a view of the same playing session. Audio keeps playing on exit. Playback state, jump counters, and listening time continue uninterrupted across the transition.
- Screen Wake Lock (`screen`) is requested on mode entry and released on exit. Silent fallback where unsupported. This is a progressive enhancement, not a gate.

### Tap-to-begin gate

- Normally never visible: entry gesture already unlocks audio.
- Fallback only: if playback is not actually running when the mode is entered (suspended context edge cases), show a full-screen "tap to begin" prompt. One tap retries playback. Once playback is running the prompt disappears and never returns for that session.

### Exit

- An auto-hiding ✕ in a corner: visible on entry and on any interaction (pointer move, tap), hidden after 3s of idle.
- Browser-level exits also work: Escape key, history back.
- Exit returns to the normal player view with audio still playing.

### Failure handling

- If the audio load/decode for the loaded Song fails while the mode is active, mirror the main page's error surface (same message state) and keep the exit ✕ available. The mode does not crash or blank silently.

### Data flow

- ZenMode receives the same inputs the existing waveform view consumes: the beat list from the Analysis, the current beat (per Player beat callback), and the jump events (per Player jump callback, widened as above). It does not fetch anything itself.

## Testing Decisions

### What makes a good test here

Test the external behavior of the visualization drawing — the sequence and geometry of draw operations produced from a beat list plus a sequence of beat/jump events — not the React component or the DOM. The React wiring (overlay show/hide, button state) is exercised by the manual dev-server smoke pass, consistent with the repo's existing practice of lint + typecheck + real-server exercise rather than a runner.

### Which modules are tested

- A new **pure draw module** (no React, no DOM) that encodes all circle-drawing decisions: given beats and an event stream, it emits drawing commands against an injected 2D-context-like interface. `ZenMode` is a thin host that instantiates a real canvas context and passes it in. This is the **single seam** chosen for the feature.
- Tests of this module run as plain Node scripts with `assert` — deliberately no new test framework, matching the repo's avoidance of one. Verified aspects: correct number of tiles laid out at the right angles; cluster index → palette color mapping; current tile highlighted with the decaying glow state; a jump event produces exactly one arc between the correct two endpoint angles; reduced-motion mode omits glow/arc draws.
- The Player callback contract change is verified implicitly: the draw module's jump test feeds the widened event shape (source + destination beat) and asserts the arc endpoints match them.

### Prior art

- The repo has no frontend runner; the model to copy is the worker's `unittest`-style pure-function tests — plain assertions against pure logic — translated to a Node script. No mocks, no DOM.
- Manual behavioral verification (dev server, desktop + mobile viewport) mirrors how the existing waveform view was validated.

## Out of Scope

- Song auto-rotation (advancing to a new Song after N minutes/jumps): deferred — decided "one song until exit".
- A route-based entry (`/zen` URL) separate from the in-app button: not requested ("button on main page" was chosen).
- True timbre-colored tiles: would require extending the worker's Analysis output with per-beat/segment chroma or timbre and re-analyzing every existing Song — deemed disproportionate for this feature; cluster coloring substitutes.
- Any persistent edge web (all jump curves drawn dim at all times): rejected in favor of flash-on-jump only.
- Continuous 60fps animation: rejected for battery; animation is bursty, settle-then-static between beats.
- Changes to the Worker, database schema, or BFF API routes: none involved.
- Landscape-forcing or orientation lock on mobile: unreliable without fullscreen; rejected.

## Further Notes

- The visualization concept is modeled on the vendored EternalJukebox reference (`REFERENCE/EternalJukebox`): ring of beat tiles, center-arcs on jumps, current tile glow. Differences from the reference are deliberate: no clickable tiles, no static curve web, canvas instead of Raphaël SVG, cluster-palette instead of timbre-RGB.
- Beat-change cadence is roughly 2–4 Hz in typical material (every ~250–450ms), so beat-driven painting means the screen updates a few times per second — visually lively but cheap.
- The mode deliberately shares the Player object rather than owning a second engine; there is exactly one source of audio truth at all times.
