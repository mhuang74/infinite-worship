/**
 * Lyric-aligned jump points (issue #69 spec, revision 2).
 *
 * The engine's automatic probabilistic jumps must fire only when BOTH ends
 * are lyric-clean: the landing beat starts at/just-before a Line Boundary,
 * and the exit moment sits within the exit window of one. Moments outside
 * every line's covered span ([l − 0.5s, l + lineExtent]) are instrumental —
 * intro, mid-song break, true outro — and jump exactly as before. Lyrics
 * arrive as an immutable constructor parameter; the leading-silence offset δ
 * (worker trims the timeline LRC times live on) is estimated from the decoded
 * buffer at construction.
 *
 * Every scenario runs the REAL engine through the harness: scripted
 * Math.random (strict queue — an unexpected draw throws, so draw-count
 * regressions like a roulette consumed on a suppressed attempt fail loudly),
 * manually advanceable audio clock, recorded buffer-source starts.
 */
import assert from 'node:assert/strict';
import {
  estimateLeadingSilenceOffset,
  beat,
  standardBeats,
  line,
  makeEngine,
  silentBuffer,
  bufferWithLeadingSilence,
  pumpUntil,
  drawsConsumed,
  resetDrawCount,
  setRandomScript,
} from './engine-harness.mjs';

/**
 * One automatic-jump attempt through the real engine: candidates only on the
 * attempt beat, script [gate, roulette] with 0.0 gate (always passes; 8 beats
 * have elapsed by index 7+) and 0.0 roulette (first valid candidate wins).
 * Pump until the jump lands or the whole array has been scheduled.
 */
function attempt({ attemptIndex, candidateIds, lines, beatDuration = 0.5, beatCount = 96, buffer }) {
  const beats = standardBeats({ count: beatCount, duration: beatDuration });
  beats[attemptIndex] = beat(attemptIndex, attemptIndex * beatDuration, beatDuration, candidateIds);
  const lyrics = lines ?? null;
  const randoms = [0, 0]; // gate pass + roulette pick; an extra draw throws
  const { engine, ctx, events } = makeEngine({ beats, lyrics, buffer, randoms });
  engine.play();
  return {
    ctx,
    events,
    run: () => pumpUntil(() => events.jumps.length > 0 || ctx.sources.length >= beatCount),
  };
}

// --- Part 4: leading-silence estimator (pure function) ----------------------

{
  // Exact-zero content: nothing ever exceeds the threshold → no offset.
  assert.equal(estimateLeadingSilenceOffset(silentBuffer(5)), 0);

  // All-silence degenerate (long buffer, never loud) → 0, no hang.
  assert.equal(estimateLeadingSilenceOffset(silentBuffer(60)), 0);

  // Known δ: 1.0 s of silence then full-scale content. Frame accuracy is
  // ±1 hop-to-frame (~23 ms at 44.1 kHz), far inside the 500 ms windows.
  const d = estimateLeadingSilenceOffset(bufferWithLeadingSilence(1.0, 10));
  assert.ok(Math.abs(d - 1.0) <= 0.025, `δ ≈ 1.0s expected, got ${d}`);

  // A second offset pins the estimator is not hardcoding: 0.37 s.
  const d2 = estimateLeadingSilenceOffset(bufferWithLeadingSilence(0.37, 10));
  assert.ok(Math.abs(d2 - 0.37) <= 0.025, `δ ≈ 0.37s expected, got ${d2}`);
}

// --- Null lyrics vs lyric-clean-everywhere: byte-identical behavior ---------

{
  const denseLines = Array.from({ length: 96 }, (_, i) => line(i * 0.5));
  const run = (lyrics) => {
    const beats = standardBeats();
    beats[7] = beat(7, 3.5, 0.5, [40, 44]);
    // gate pass; roulette 0.9 → weighted pick below (weights 56 vs 52 over
    // total 108: 0.9×108 = 97.2 → 97.2−56 = 41.2 → −52 < 0 → second candidate)
    const { engine, ctx, events } = makeEngine({ beats, lyrics, randoms: [0, 0.9] });
    engine.play();
    pumpUntil(() => events.jumps.length > 0 || ctx.sources.length >= 96);
    return { ctx, events };
  };
  const a = run(null);
  const b = run(denseLines);
  assert.deepEqual(JSON.parse(JSON.stringify(b.ctx.sources)), JSON.parse(JSON.stringify(a.ctx.sources)));
  assert.deepEqual(b.events.jumps, a.events.jumps);
  // Roulette 0.9 over weights (96−40=56, 96−44=52; total 108): 97.2−56=41.2,
  // 41.2−52<0 → second candidate. Weighting mechanics unchanged with lyrics.
  assert.equal(a.events.jumps[0].to.id, 44);
  assert.equal(b.events.jumps[0].to.id, 44);
}

// --- Entry window edges (120 BPM: 0.5 s beats, entry = exit = 0.5 s) --------
// Lines [18, 20, 100]: median gap 41 → lineExtent capped at 8. Covered spans:
// [17.5, 26] (from 18), [19.5, 28] (from 20), [99.5, 108]. Attempt beat 60
// (start 30, exit 30.5) is uncovered → exit free; the candidate carries the
// entry predicate.

{
  // Landing exactly at l = 20 → admitted.
  let t = attempt({ attemptIndex: 60, candidateIds: [40], lines: [line(18), line(20), line(100)] });
  t.run();
  assert.equal(t.events.jumps.length, 1);
  assert.equal(t.events.jumps[0].to.id, 40);

  // Landing at l − entryWindow = 19.5 (boundary inclusive) → admitted.
  t = attempt({ attemptIndex: 60, candidateIds: [39], lines: [line(18), line(20), line(100)] });
  t.run();
  assert.equal(t.events.jumps.length, 1);
  assert.equal(t.events.jumps[0].to.id, 39);

  // Landing at 19.0 = l − entryWindow − ε: covered by line 18's tail
  // ([17.5, 26]) but outside every entry window → suppressed.
  t = attempt({ attemptIndex: 60, candidateIds: [38], lines: [line(18), line(20), line(100)] });
  t.run();
  assert.equal(t.events.jumps.length, 0);

  // Landing just-after l (20.5): covered, but just-after is a bad landing —
  // the previous line's tail would play with no beginning → suppressed.
  t = attempt({ attemptIndex: 60, candidateIds: [41], lines: [line(18), line(20), line(100)] });
  t.run();
  assert.equal(t.events.jumps.length, 0);
}

// --- Exit window edges (symmetric ±0.5 s, covered region) -------------------

{
  const lines = [line(18), line(20), line(100)];
  // Exit exactly at l = 20 (beat 39: 19.5 + 0.5) → clean.
  let t = attempt({ attemptIndex: 39, candidateIds: [90], lines });
  t.run();
  assert.equal(t.events.jumps.length, 1);

  // Exit at l − 0.5 (beat 38: exit 19.5, boundary inclusive) → clean.
  t = attempt({ attemptIndex: 38, candidateIds: [90], lines });
  t.run();
  assert.equal(t.events.jumps.length, 1);

  // Exit at l + 0.5 (beat 40: exit 20.5, boundary inclusive) → clean.
  t = attempt({ attemptIndex: 40, candidateIds: [90], lines });
  t.run();
  assert.equal(t.events.jumps.length, 1);

  // Exit at l − 1.0 (beat 37: exit 19.0, covered by span [17.5, 26]) → cut is
  // deep mid-line → suppressed. Exit check precedes the roulette: exactly one
  // draw (the gate) may be consumed.
  resetDrawCount();
  setRandomScript([0]);
  let beats = standardBeats();
  beats[37] = beat(37, 18.5, 0.5, [90]);
  const e1 = makeEngine({ beats, lyrics: lines, randoms: [0] });
  e1.engine.play();
  pumpUntil(() => e1.events.jumps.length > 0 || e1.ctx.sources.length >= 96);
  assert.equal(e1.events.jumps.length, 0);
  assert.equal(drawsConsumed(), 1);

  // Exit at l + 1.0 (beat 41: exit 21.0, covered) → suppressed.
  resetDrawCount();
  beats = standardBeats();
  beats[41] = beat(41, 20.5, 0.5, [90]);
  const e2 = makeEngine({ beats, lyrics: lines, randoms: [0] });
  e2.engine.play();
  pumpUntil(() => e2.events.jumps.length > 0 || e2.ctx.sources.length >= 96);
  assert.equal(e2.events.jumps.length, 0);
  assert.equal(drawsConsumed(), 1);
}

// --- Coverage exemption ------------------------------------------------------

{
  // Intro: both ends before lines[0] − exitWindow → jump freely. (Attempt
  // beat 10 so the min-8-beats spacing gate is already satisfied.)
  let t = attempt({ attemptIndex: 10, candidateIds: [30], lines: [line(20), line(40)] });
  t.run();
  assert.equal(t.events.jumps.length, 1);
  assert.equal(t.events.jumps[0].to.id, 30);

  // True outro: candidate past lines[last] + lineExtent (lines [20, 36]:
  // extent 8 → covered ends at 44; candidate at 45) → jump freely. A wide
  // array (160) so the landing at beat 90 has runway: running off the array
  // end arms the restart watchdog, whose cancelTimers would drop the
  // landing-time jump dispatch before the fake clock reaches it.
  t = attempt({ attemptIndex: 60, candidateIds: [90], lines: [line(20), line(36)], beatCount: 160 });
  t.run();
  assert.equal(t.events.jumps.length, 1);
  assert.equal(t.events.jumps[0].to.id, 90);

  // Mid-song instrumental break (the round-2 regression): lines [20, 40],
  // extent 8 → covered [19.5, 28] ∪ [39.5, 48]; the break (28, 39.5) is
  // uncovered on BOTH ends (attempt exit 30.5, landing 38.0) → jump freely.
  t = attempt({ attemptIndex: 60, candidateIds: [76], lines: [line(20), line(40)] });
  t.run();
  assert.equal(t.events.jumps.length, 1);
  assert.equal(t.events.jumps[0].to.id, 76);

  // Inside the final line (the round-1 regression): exit at 44.0 = 40 + 8/2
  // is still covered ([39.5, 48]) but far from every boundary → suppressed.
  t = attempt({ attemptIndex: 87, candidateIds: [10], lines: [line(20), line(40)] });
  t.run();
  assert.equal(t.events.jumps.length, 0);

  // Same for a landing deep inside the final line: suppressed.
  t = attempt({ attemptIndex: 60, candidateIds: [88], lines: [line(20), line(40)] });
  t.run();
  assert.equal(t.events.jumps.length, 0);
}

// --- Sparse-LRC cap: lineExtent = min(medianGap, 8 s) -----------------------

{
  // Lines [20, 100]: median gap 80 → extent capped at 8. Moment 30.5 would be
  // covered (and suppressed) under an uncapped extent ([19.5, 100]); with the
  // cap it is uncovered → jump freely.
  const t = attempt({ attemptIndex: 60, candidateIds: [90], lines: [line(20), line(100)] });
  t.run();
  assert.equal(t.events.jumps.length, 1);
  assert.equal(t.events.jumps[0].to.id, 90);
}

// --- Gap-placeholder lines count as Line Boundaries -------------------------

{
  const t = attempt({ attemptIndex: 60, candidateIds: [40], lines: [line(20, ''), line(100)] });
  t.run();
  assert.equal(t.events.jumps.length, 1);
  assert.equal(t.events.jumps[0].to.id, 40);
}

// --- δ correction: landing clean only after +δ ------------------------------

{
  // Buffer carries 1.0 s of leading silence (δ ≈ 0.987). Lines [20, 22, 100]:
  // median gap 40 → extent 8 → covered [17.5? no: [19.5, 28] ∪ [21.5, 30] ∪
  // [99.5, 108]]. Candidate beat 42 starts at 21.0 on the TRIMMED timeline →
  // 21.987 on the original. Without δ: covered (21.0 ∈ [19.5, 28]) but inside
  // no entry window ([19.5, 20] / [21.5, 22]) → suppressed. With δ: 21.987 ∈
  // [21.5, 22] → admitted. Attempt beat 60 (30.987 original) is uncovered.
  const buf = bufferWithLeadingSilence(1.0, 60);
  let t = attempt({ attemptIndex: 60, candidateIds: [42], lines: [line(20), line(22), line(100)], buffer: buf });
  t.run();
  assert.equal(t.events.jumps.length, 1, 'landing boundary-clean only after +δ must be admitted');
  assert.equal(t.events.jumps[0].to.id, 42);

  // Negative control one grid step earlier: 20.5 + δ = 21.487 lies between
  // the two entry windows → suppressed. Pins the window edge under δ.
  t = attempt({ attemptIndex: 60, candidateIds: [41], lines: [line(20), line(22), line(100)], buffer: buf });
  t.run();
  assert.equal(t.events.jumps.length, 0);
}

// --- Suppression without counter reset (story 4) ----------------------------

{
  // Beat 7's candidate (45 → 22.5, covered, outside every entry window) is
  // suppressed; beat 8's candidate (40 → 20.0 = l) is admitted. If suppression
  // had reset beatsSinceLastJump, beat 8's gate would fail (spacing < 8) and
  // no jump could land on the very next beat.
  const beats = standardBeats();
  beats[7] = beat(7, 3.5, 0.5, [45]);
  beats[8] = beat(8, 4.0, 0.5, [40]);
  resetDrawCount();
  const { engine, ctx, events } = makeEngine({ beats, lyrics: [line(20), line(100)], randoms: [0, 0, 0] });
  engine.play();
  pumpUntil(() => events.jumps.length > 0 || ctx.sources.length >= 96);
  assert.equal(events.jumps.length, 1, 'suppressed attempt must not reset the spacing counter');
  assert.equal(events.jumps[0].from.id, 8);
  assert.equal(events.jumps[0].to.id, 40);
  assert.equal(drawsConsumed(), 3, 'gate×2 + one roulette; a suppressed attempt consumes no roulette draw');
}

// --- User-initiated jumps are exempt ----------------------------------------

{
  const beats = standardBeats();
  const { engine, events } = makeEngine({ beats, lyrics: [line(20), line(100)], randoms: [] });
  engine.play();
  // Beat 50 (start 25.0) is covered but outside every entry window — a gated
  // automatic jump would refuse it. A deliberate Zen double-tap must not.
  engine.jumpToBeat(beats[50]);
  assert.equal(events.jumps.length, 1);
  assert.equal(events.jumps[0].to.id, 50);

  // seekToTime: same exemption — the user chose the destination.
  const { engine: e2, events: ev2 } = makeEngine({ beats, lyrics: [line(20), line(100)], randoms: [] });
  e2.play();
  e2.seekToTime(25.3);
  assert.equal(ev2.beats[ev2.beats.length - 1].id, 50);
}

// --- Beat-scaled entry window on a slow song (65 BPM-ish, 0.92 s beats) -----
// Lines every 3.68 s (4 beats) starting 0.7: dense enough that the beat
// BEFORE a line is covered by the previous line's tail (extent 3.68 ≥ gap − 0.5),
// so the entry predicate — not the coverage exemption — decides. Landing
// 0.7 s before a line is unreachable under a fixed 0.5 s window (starvation)
// but admitted at max(0.5, 0.92) = 0.92 s.

{
  const lines = Array.from({ length: 16 }, (_, k) => line(0.7 + 3.68 * k));
  // Attempt beat 60 (start 55.2, exit 56.12): |56.12 − 55.9| = 0.22 ≤ 0.5 →
  // exit clean via the window (everything is covered on this grid).
  let t = attempt({
    attemptIndex: 60,
    candidateIds: [44], // 40.48 = 0.7 before line 41.18 → inside the widened window
    lines,
    beatDuration: 0.92,
  });
  t.run();
  assert.equal(t.events.jumps.length, 1, 'entry window must scale with the beat grid on slow songs');
  assert.equal(t.events.jumps[0].to.id, 44);

  // One full beat earlier (beat 43 → 39.56, 1.62 before line 41.18, covered
  // by line 37.5's tail) → outside even the widened window → suppressed.
  t = attempt({ attemptIndex: 60, candidateIds: [43], lines, beatDuration: 0.92 });
  t.run();
  assert.equal(t.events.jumps.length, 0);

  // Exit window stays FIXED at 0.5 s (does not scale with tempo): attempt
  // beat 61 (start 56.12, exit 57.04) sits 0.74 s after line 56.3 — covered,
  // beyond the fixed window → suppressed. (Lines shifted: 1.1 + 3.68k so the
  // offsets land where intended.)
  const shifted = Array.from({ length: 16 }, (_, k) => line(1.1 + 3.68 * k));
  setRandomScript([0]);
  const slowBeats = standardBeats({ count: 96, duration: 0.92 });
  slowBeats[61] = beat(61, 56.12, 0.92, [41]);
  const e = makeEngine({ beats: slowBeats, lyrics: shifted, randoms: [0] });
  e.engine.play();
  pumpUntil(() => e.events.jumps.length > 0 || e.ctx.sources.length >= 96);
  assert.equal(e.events.jumps.length, 0, 'exit window must stay 0.5 s on slow songs');

  // Control: the same candidate from attempt beat 60 (exit 56.12, 0.18 s
  // before line 56.3) is exit-clean → the jump fires.
  const ctrl = attempt({ attemptIndex: 60, candidateIds: [41], lines: shifted, beatDuration: 0.92 });
  ctrl.run();
  assert.equal(ctrl.events.jumps.length, 1);
  assert.equal(ctrl.events.jumps[0].to.id, 41);
}

console.log('lyric-alignment.test.mjs OK');
