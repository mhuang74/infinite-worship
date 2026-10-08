/**
 * Engine test harness for lyric-aligned jump points (issue #69 spec,
 * acceptance criterion 1).
 *
 * Plain Node, zen-tests conventions: the real `src/lib/audio.ts` is
 * transpiled with the in-repo TypeScript compiler and executed in-process
 * against the stubs the spec mandates —
 *
 * - `window` stub with controllable setTimeout/clearTimeout returning numeric
 *   handles (audio.ts stores them in a Map and clears by handle);
 * - `NODE_ENV=production` so dev probes (`__iwSchedLog`, dev chatter) skip;
 * - scriptable `Math.random` — a strict queue: an unexpected draw throws, so
 *   draw-count regressions (e.g. a roulette consumed on a suppressed attempt)
 *   fail loudly;
 * - fake AudioContext: manually advanceable `currentTime`, gain nodes with
 *   inert automation, buffer sources recording `start(time, offset, duration)`;
 * - `document` left undefined (the `typeof document !== 'undefined'` guard in
 *   scheduleUiDispatch handles it).
 *
 * The fake clock ties the audio clock to timer firing: `currentTime` only
 * advances when the harness fires timers, so scheduling is fully
 * deterministic.
 */

import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)); // application/frontend/zen-tests
const frontend = path.dirname(here);
const require = createRequire(import.meta.url);
const ts = require(path.join(frontend, 'node_modules', 'typescript'));

process.env.NODE_ENV = 'production';

// --- fake clock + window timers -------------------------------------------

let nowMs = 0;
const timers = new Map(); // handle -> { fn, at }
let nextHandle = 1;

globalThis.window = {
  setTimeout(fn, ms = 0) {
    const handle = nextHandle++;
    timers.set(handle, { fn, at: nowMs + ms });
    return handle;
  },
};

const nativeClearTimeout = globalThis.clearTimeout;
globalThis.clearTimeout = (handle) => {
  if (timers.delete(handle)) return;
  nativeClearTimeout?.(handle);
};

/** Fire the single earliest due timer; false when none pend. */
function advanceOneTimer() {
  let bestHandle = -1;
  let best = null;
  for (const [h, t] of timers) {
    if (!best || t.at < best.at) {
      best = t;
      bestHandle = h;
    }
  }
  if (!best) return false;
  timers.delete(bestHandle); // one-shot: remove BEFORE firing (fn may re-arm)
  nowMs = Math.max(nowMs, best.at);
  best.fn();
  return true;
}

/** Fire timers until pred() holds; false if timers ran out or step cap hit. */
export function pumpUntil(pred, maxSteps = 20000) {
  for (let i = 0; i < maxSteps && !pred(); i++) {
    if (!advanceOneTimer()) return false;
  }
  return pred();
}

export function resetClock() {
  timers.clear();
  nowMs = 0;
}

// --- scriptable Math.random ------------------------------------------------

let randomScript = [];
let drawCount = 0;
Math.random = () => {
  drawCount++;
  if (randomScript.length === 0) {
    throw new Error(`unexpected Math.random draw #${drawCount} — script exhausted`);
  }
  return randomScript.shift();
};

export function setRandomScript(values) {
  randomScript = [...values];
}

export function drawsConsumed() {
  return drawCount;
}

export function resetDrawCount() {
  drawCount = 0;
}

// --- fake AudioContext + AudioBuffer ---------------------------------------

export class FakeAudioContext {
  constructor() {
    this.destination = {};
    this.sources = []; // every { time, offset, duration } passed to start()
  }

  get currentTime() {
    return nowMs / 1000;
  }

  createGain() {
    return {
      gain: {
        value: 1,
        setValueAtTime() {},
        exponentialRampToValueAtTime() {},
        linearRampToValueAtTime() {},
      },
      connect() {},
      disconnect() {},
    };
  }

  createBufferSource() {
    const ctx = this;
    return {
      buffer: null,
      connect() {},
      start(time, offset, duration) {
        ctx.sources.push({ time, offset, duration });
      },
    };
  }
}

export function silentBuffer(seconds = 60, sampleRate = 44100) {
  const length = Math.round(seconds * sampleRate);
  const data = new Float32Array(length);
  return { sampleRate, duration: seconds, length, getChannelData: () => data };
}

/** All-zero for the first `silenceSeconds`, loud (±0.9) after — a known δ. */
export function bufferWithLeadingSilence(silenceSeconds, seconds = 60, sampleRate = 44100) {
  const length = Math.round(seconds * sampleRate);
  const data = new Float32Array(length);
  const from = Math.round(silenceSeconds * sampleRate);
  for (let i = from; i < length; i++) data[i] = 0.9;
  return { sampleRate, duration: seconds, length, getChannelData: () => data };
}

// --- beats + engine construction -------------------------------------------

export function beat(id, start, duration = 0.5, cands = []) {
  return { id, start, duration, cluster: 0, segment: 0, jump_candidates: cands };
}

export function standardBeats({ count = 96, duration = 0.5 } = {}) {
  return Array.from({ length: count }, (_, i) => beat(i, i * duration, duration));
}

export function line(time, text = 'line') {
  return { time, text };
}

export function makeEngine({ beats, lyrics = null, buffer, randoms = [] }) {
  resetClock();
  setRandomScript(randoms);
  const ctx = new FakeAudioContext();
  const events = { beats: [], jumps: [] };
  const engine = new AudioEngine(
    ctx,
    buffer ?? silentBuffer(),
    beats,
    (b) => events.beats.push(b),
    (j) => events.jumps.push(j),
    undefined,
    lyrics
  );
  return { engine, ctx, events };
}

// --- the module under test ---------------------------------------------------

const source = readFileSync(path.join(frontend, 'src/lib/audio.ts'), 'utf8');
const out = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2021,
    esModuleInterop: true,
  },
});
const dir = mkdtempSync(path.join(tmpdir(), 'iw-engine-'));
const file = path.join(dir, 'audio.js');
writeFileSync(file, out.outputText);
const audioUrl = pathToFileURL(file).href;

const mod = await import(audioUrl);
export const AudioEngine = mod.AudioEngine;
export const estimateLeadingSilenceOffset = mod.estimateLeadingSilenceOffset;
