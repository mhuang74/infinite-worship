/**
 * Playback-smoothness telemetry (spec: specs/playback-stutter-telemetry-v2.md).
 *
 * Wired ONLY when `?debug` is present on the page URL (main player Phase-1
 * item 3 / /playtest); inert otherwise — the hooks cost one nullable check
 * per beat and nothing else.
 *
 * Signals (spec Phase 1 item 2):
 *  - scheduling drift + late starts + outputLatency/baseLatency @1 Hz
 *  - longtask PerformanceObserver + performance.memory @1 Hz (tertiary;
 *    bucketized/lazily updated — a flat line is NOT evidence of no growth)
 *  - live node accounting (per-beat BufferSources via onended refcount;
 *    crossfade GainNode pairs counted on creation — observation only, no
 *    disconnect(): disconnecting would mask suspects 3/6 accumulation)
 *  - ground-truth render-thread gap tap: an in-chain AudioWorkletNode
 *    (mainGain → worklet → destination) computing per-quantum RMS on the
 *    audio render thread and posting gap events to main — survives
 *    main-thread stalls that blind any main-thread poller
 *  - AudioContext state watch (onstatechange transitions, incl. 'interrupted'
 *    where present) + resume() call logging
 *  - path counters: restart-without-crossfade (suspect 7), extra scheduler
 *    chains from seek/jump/restart (suspect 8), crossfades, jumps
 *  - per-beat onBeatChange callback execution time + inter-beat jitter
 *
 * All samples go into a bounded ring buffer (~30 min at per-beat + 1 Hz
 * resolution); `window.__telemetry` returns the snapshot for CDP extraction,
 * the Download-JSON button serializes the same shape.
 */

import type { Beat } from './types';

/** Entry points that spawn a fresh scheduler chain (telemetry's suspect-8 set). */
export type ChainOrigin = 'play' | 'seekToTime' | 'jumpToBeat' | 'crossfadeResume';

/** Ring capacity per signal stream: 30 min × 1 Hz, plus per-beat headroom. */
const SAMPLE_CAPACITY = 2400;
const BEAT_CAPACITY = 2400;
/** Gap-event capacity: generous — real gaps should be rare. */
const GAP_CAPACITY = 2000;
const EVENT_CAPACITY = 2000;

/** Near-silence RMS below which a quantum counts as a gap (in-chain tap). */
const SILENCE_THRESHOLD = 1e-4;
/** Gaps shorter than this are inter-beat silence of the source, not dropouts. */
const MIN_GAP_SEC = 0.02;

export interface TelemetrySession {
  startedAt: string;
  href: string;
  arms: Record<string, string>;
  sampleRateHz: number;
  baseLatencyAtStart: number | null;
  userAgent: string;
}

export interface TelemetrySample {
  t: number; // performance.now()/1000 — session-relative seconds
  memoryMb: number | null;
  outputLatency: number | null;
  baseLatency: number | null;
  liveNodes: number;
  liveChains: number;
  contextState: string;
}

export interface BeatSample {
  t: number;
  beatId: number;
  /** nextBeatTime − audioContext.currentTime at scheduling (lookahead slack). */
  driftSec: number;
  /** Scheduled start ≤ currentTime at .start() call. */
  late: boolean;
  /** onBeatChange handler wall time (ms); filled by markBeatCbEnd. */
  beatCbMs: number | null;
  /** Seconds since the previous scheduled beat (jitter; null on first). */
  intervalSec: number | null;
  /** True when this beat was scheduled by a crossfade's fade-in leg. */
  crossfadeLeg: boolean;
}

export interface GapEvent {
  /** Onset in session seconds (main-thread receive time — the worklet saw it earlier). */
  t: number;
  /** Gap duration in seconds as measured on the render thread. */
  durationSec: number;
  /** Peak RMS within the gap window (contextual). */
  peakRms: number;
  /** True when a main-thread stall overlapped the onset (stall survival check). */
  stallOverlapped: boolean;
}

export interface TelemetryEvent {
  t: number;
  kind: string;
  detail?: Record<string, unknown>;
}

export interface TelemetrySnapshot {
  session: TelemetrySession;
  /** Counters (monotonic over the session). */
  counters: Record<string, number>;
  /** ~1 Hz scalar samples. */
  samples: TelemetrySample[];
  /** Per-beat scheduler observations. */
  beats: BeatSample[];
  /** Render-thread gap events (ground truth). */
  gaps: GapEvent[];
  /** Discrete events: context transitions, resumes, longtasks, path events. */
  events: TelemetryEvent[];
  /** User-heard glitch marks, session-relative seconds (Phase 3 step 4). */
  glitchMarks: number[];
}

/** Hooks the AudioEngine calls at its natural instrumentation points. */
export interface TelemetryHooks {
  onBeatScheduled: (beat: Beat, driftSec: number, late: boolean) => void;
  onCrossfadeStart: () => void;
  onCrossfadeLegBeat: (beat: Beat, driftSec: number, late: boolean) => void;
  onNodeCreated: (source: AudioBufferSourceNode) => void;
  onRestartWithoutCrossfade: (atBeatIndex: number, length: number) => void;
  /** An extra scheduler chain spawned from play/seek/jump/restart (suspect 8). */
  onExtraChain: (origin: ChainOrigin) => void;
  /** Engine's authoritative live-chain count, reported whenever it changes. */
  onChainCount: (n: number) => void;
  /** A probabilistic jump fired (count includes this jump). */
  onJumpCount: (count: number) => void;
  /** A crossfade's fade-out/fade-in GainNode pair was created (suspect 3). */
  onCrossfadeGainsCreated: () => void;
  /** First beat scheduled: audio-time from which gap detection is live. */
  onPlaybackArmed: (atAudioTime: number) => void;
  /**
   * Playback stopped (pause/stop/restart boundary): the gap tap disarms so
   * idle/pause silence is not counted as a dropout; onPlaybackArmed re-arms.
   */
  onPlaybackPaused: () => void;
}

export interface Telemetry {
  hooks: TelemetryHooks;
  snapshot: () => TelemetrySnapshot;
  dispose: () => void;
  /** onBeatChange timing: page wraps its handler between start/end marks. */
  markBeatCbStart: () => void;
  markBeatCbEnd: (beat: Beat) => void;
  /**
   * The belt-and-braces MediaRecorder capture tail (null when unavailable):
   * the final arbiter when in-page signals and hearing disagree (spec Phase 4).
   */
  captureBlob: () => Promise<Blob | null>;
  /** Session-relative seconds now — the origin every telemetry t uses. */
  nowSec: () => number;
  /** User-heard glitch note at the current session-relative time (Phase 3 step 4). */
  markGlitch: () => void;
}

export interface StartTelemetryOptions {
  audioContext: AudioContext;
  /** The node whose output feeds destination — the tap is inserted after it. */
  mainGain: GainNode;
  /** URL param key/value pairs to record (p, zen, control, …). */
  arms?: Record<string, string>;
}

/**
 * Parse `?debug` from a query string: any of `?debug`, `?debug=1`,
 * `?debug=true`. The page decides wiring; the module only needs a boolean.
 */
export function debugFlagEnabled(search: string): boolean {
  const params = new URLSearchParams(search);
  const v = params.get('debug');
  return v === '' || v === '1' || v === 'true';
}

const WORKLET_SOURCE = `
const SILENCE_THRESHOLD = 1e-4;
const MIN_GAP_SEC = 0.02;
class GapTapProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.gapStartTime = null;   // first near-silent quantum's currentTime
    this.gapPeakRms = 0;
    this.armAt = null;          // audio time gap detection starts (first beat)
    this.port.onmessage = (e) => {
      if (!e.data) return;
      if (e.data.type === 'armAt') this.armAt = e.data.t;
      if (e.data.type === 'arm') this.enabled = e.data.armed !== false;
    };
    this.enabled = false;
  }
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    // Pass-through: the tap sits in-chain (mainGain → worklet → destination),
    // so silence here would silence playback on the Mac captures. Copy each
    // input channel to the matching output channel, then run the RMS/gap
    // logic on the input.
    if (output) {
      for (let ch = 0; ch < output.length; ch++) {
        const outCh = output[ch];
        const inCh = input && input.length > 0 ? input[Math.min(ch, input.length - 1)] : undefined;
        if (inCh) outCh.set(inCh);
        else outCh.fill(0);
      }
    }
    // Sum channels to mono energy; 128-sample quantum.
    let sum = 0;
    let n = 0;
    if (input && input.length > 0) {
      for (const ch of input) {
        if (!ch) continue;
        for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
        n += ch.length;
      }
    }
    const rms = n > 0 ? Math.sqrt(sum / n) : 0;
    const now = currentTime;
    // Only nominal playback counts: silence before the first beat (or after
    // the tap armed but before audio reaches the chain) is not a dropout.
    if (this.armAt === null || now < this.armAt) return true;
    if (rms >= SILENCE_THRESHOLD) {
      if (this.gapStartTime !== null) {
        const dur = now - this.gapStartTime;
        if (dur >= MIN_GAP_SEC) {
          this.port.postMessage({ type: 'gap', t: this.gapStartTime, durationSec: dur, peakRms: this.gapPeakRms });
        }
        this.gapStartTime = null;
        this.gapPeakRms = 0;
      }
    } else if (this.enabled) {
      if (this.gapStartTime === null) {
        this.gapStartTime = now;
        this.gapPeakRms = rms;
      } else if (rms > this.gapPeakRms) {
        this.gapPeakRms = rms;
      }
    } else if (this.gapStartTime !== null) {
      // Disarmed mid-gap (pause/stop): drop the open gap — silence after a
      // pause is idle, not a dropout. The partial window is not reported.
      this.gapStartTime = null;
      this.gapPeakRms = 0;
    }
    return true;
  }
}
registerProcessor('gap-tap', GapTapProcessor);
`;

/** Ring buffer: push, drop oldest beyond capacity. */
class Ring<T> {
  private buf: T[] = [];
  constructor(private cap: number) {}
  push(v: T) {
    this.buf.push(v);
    if (this.buf.length > this.cap) this.buf.splice(0, this.buf.length - this.cap);
  }
  get all(): T[] {
    return this.buf;
  }
}

/**
 * Start telemetry for a page session. Returns hooks the engine calls at its
 * natural points + a snapshot getter. Globals set: `window.__telemetry`
 * (snapshot getter for CDP extraction) and `window.__gapTap` (armed state +
 * the deliberate main-thread block the Phase-2 stall-survival probe injects).
 */
export function startTelemetry(options: StartTelemetryOptions): Telemetry {
  const { audioContext, mainGain } = options;
  const sessionStart = performance.now() / 1000;
  const now = () => performance.now() / 1000 - sessionStart;

  const session: TelemetrySession = {
    startedAt: new Date().toISOString(),
    href: window.location.href,
    arms: options.arms ?? {},
    sampleRateHz: audioContext.sampleRate,
    baseLatencyAtStart: audioContext.baseLatency ?? null,
    userAgent: navigator.userAgent,
  };

  const counters: Record<string, number> = {
    beatsScheduled: 0,
    lateStarts: 0,
    crossfades: 0,
    crossfadeGainPairs: 0,
    jumps: 0,
    restartWithoutCrossfade: 0,
    extraChains: 0,
    nodesCreated: 0,
    nodesEnded: 0,
    contextTransitions: 0,
    resumes: 0,
    longtasks: 0,
    longtaskTotalMs: 0,
    renderGaps: 0,
    stallOverlaps: 0,
  };

  const samples = new Ring<TelemetrySample>(SAMPLE_CAPACITY);
  const beats = new Ring<BeatSample>(BEAT_CAPACITY);
  const gaps = new Ring<GapEvent>(GAP_CAPACITY);
  const events = new Ring<TelemetryEvent>(EVENT_CAPACITY);

  const logEvent = (kind: string, detail?: Record<string, unknown>) => {
    events.push({ t: now(), kind, detail });
  };

  // ---- context state watch -----------------------------------------------
  let contextState = audioContext.state;
  logEvent('context.initial', { state: contextState });
  const onStateChange = () => {
    const prev = contextState;
    contextState = audioContext.state;
    counters.contextTransitions++;
    logEvent('context.state', { from: prev, to: contextState });
  };
  audioContext.addEventListener('statechange', onStateChange);

  // ---- longtask observer --------------------------------------------------
  let longtaskObserver: PerformanceObserver | null = null;
  try {
    longtaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        counters.longtasks++;
        counters.longtaskTotalMs += entry.duration;
        const attribution =
          'attribution' in entry
            ? ((entry.attribution as Array<{ name?: string }> | undefined)?.map((a) => a.name ?? 'unknown') ?? [])
            : [];
        logEvent('longtask', { durationMs: entry.duration, attribution });
      }
    });
    longtaskObserver.observe({ entryTypes: ['longtask'] });
  } catch (err) {
    logEvent('longtask.unavailable', { error: String(err) });
  }

  // ---- node accounting (observation only — no disconnect) ------------------
  let liveNodes = 0;
  const onNodeCreated = (source: AudioBufferSourceNode) => {
    counters.nodesCreated++;
    liveNodes++;
    source.addEventListener('ended', () => {
      counters.nodesEnded++;
      liveNodes--;
    });
  };

  // ---- scheduler chains (suspect 8) --------------------------------------
  // The engine owns the authoritative count; it reports via onChainCount and
  // calls onExtraChain for chains spawned outside the timer chain's own re-arm.
  let liveChains = 0;
  const onExtraChain = (origin: string) => {
    counters.extraChains++;
    logEvent('chain.extra', { origin });
  };
  const onChainCount = (n: number) => {
    liveChains = n;
  };

  // ---- per-beat records ----------------------------------------------------
  let lastBeatAt: number | null = null;
  const recordBeat = (beat: Beat, driftSec: number, late: boolean, crossfadeLeg: boolean) => {
    counters.beatsScheduled++;
    if (late) counters.lateStarts++;
    const t = now();
    beats.push({
      t,
      beatId: beat.id,
      driftSec,
      late,
      beatCbMs: consumeBeatCbMs(beat.id),
      intervalSec: lastBeatAt !== null ? t - lastBeatAt : null,
      crossfadeLeg,
    });
    lastBeatAt = t;
  };

  const hooks: TelemetryHooks = {
    onBeatScheduled(beat, driftSec, late) {
      recordBeat(beat, driftSec, late, false);
    },
    onCrossfadeStart() {
      counters.crossfades++;
      logEvent('crossfade.start');
    },
    onCrossfadeLegBeat(beat, driftSec, late) {
      recordBeat(beat, driftSec, late, true);
    },
    onNodeCreated,
    onRestartWithoutCrossfade(atBeatIndex, length) {
      counters.restartWithoutCrossfade++;
      logEvent('path.restartWithoutCrossfade', { atBeatIndex, length });
    },
    onExtraChain,
    onChainCount,
    onJumpCount: (count) => {
      counters.jumps = count;
    },
    onCrossfadeGainsCreated: () => {
      counters.crossfadeGainPairs++;
    },
    onPlaybackArmed: (atAudioTime) => {
      armedAtAudioTime = atAudioTime;
      const w = worklet;
      // Re-arm alongside armAt: pause/stop disarmed the tap (arm:false), and
      // the setup-time arm is one-shot — without this the tap stays blind
      // after any pause→play cycle.
      if (w) {
        w.port.postMessage({ type: 'arm', armed: true });
        w.port.postMessage({ type: 'armAt', t: atAudioTime });
      }
    },
    onPlaybackPaused: () => {
      const w = worklet;
      if (w) w.port.postMessage({ type: 'arm', armed: false });
      logEvent('gaptap.disarmed');
    },
  };

  /** User-heard glitch marks, session-relative — directly comparable to gaps[].t. */
  const glitchMarks: number[] = [];
  const markGlitch = () => {
    glitchMarks.push(now());
  };

  // onBeatChange callback execution time: the page wraps its handler between
  // the two marks. A pending measurement is attributed to the NEXT beat
  // record the hooks push (the engine calls onBeatChange before playBeat
  // pushes the record), so record ordering never drops it.
  let beatCbStart: number | null = null;
  let pendingBeatCbMs: number | null = null;
  const markBeatCbStart = () => {
    beatCbStart = performance.now();
  };
  const markBeatCbEnd = (beat: Beat) => {
    if (beatCbStart === null) return;
    pendingBeatCbMs = performance.now() - beatCbStart;
    beatCbStart = null;
    pendingBeatId = beat.id;
  };
  let pendingBeatId: number | null = null;
  const consumeBeatCbMs = (beatId: number): number | null => {
    if (pendingBeatCbMs === null) return null;
    if (pendingBeatId !== null && pendingBeatId !== beatId) return null;
    const ms = pendingBeatCbMs;
    pendingBeatCbMs = null;
    pendingBeatId = null;
    return ms;
  };

  // ---- 1 Hz sampler --------------------------------------------------------
  const sampleTimer = window.setInterval(() => {
    let memoryMb: number | null = null;
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    if (mem) memoryMb = Math.round((mem.usedJSHeapSize / (1024 * 1024)) * 10) / 10;
    const ctx = audioContext as AudioContext & { outputLatency?: number };
    samples.push({
      t: now(),
      memoryMb,
      outputLatency: ctx.outputLatency ?? null,
      baseLatency: audioContext.baseLatency ?? null,
      liveNodes,
      liveChains,
      contextState,
    });
  }, 1000);

  // Main-thread stall watch: this 50 ms interval firing >100 ms late means a
  // stall was active at that moment; used to annotate gap events for the
  // Phase-2 stall-survival probe (does the tap see gaps the poller can't).
  let mainThreadStall = false;
  let lastStallTick = performance.now();
  const stallWatch = window.setInterval(() => {
    mainThreadStall = performance.now() - lastStallTick > 100;
    lastStallTick = performance.now();
  }, 50);

  // ---- ground-truth render-thread gap tap ---------------------------------
  // In-chain splice mainGain → worklet → destination replacing the direct
  // mainGain → destination connection (a parallel tap would double the
  // audible signal). Callers must not have connected mainGain to destination
  // themselves, or must disconnect it first — the engine wiring handles that.
  let worklet: AudioWorkletNode | null = null;
  let gapTapArmed = false;
  /** First scheduled beat's audio time (armAt may fire before the worklet exists). */
  let armedAtAudioTime: number | null = null;
  const gapTapSetup = audioContext.audioWorklet
    .addModule(URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' })))
    .then(() => {
      worklet = new AudioWorkletNode(audioContext, 'gap-tap', { numberOfInputs: 1, numberOfOutputs: 1 });
      worklet.port.onmessage = (e: MessageEvent) => {
        const msg = e.data as { type: string; t: number; durationSec: number; peakRms: number };
        if (msg.type !== 'gap') return;
        counters.renderGaps++;
        const overlapped = mainThreadStall;
        if (overlapped) counters.stallOverlaps++;
        gaps.push({
          t: now(),
          durationSec: msg.durationSec,
          peakRms: msg.peakRms,
          stallOverlapped: overlapped,
        });
      };
      // In-chain splice: mainGain → worklet → destination REPLACES the
      // direct mainGain → destination connection (a parallel tap would
      // double the audible signal). The engine's constructor made the direct
      // connection — drop it here, guarded (throws when not connected).
      try {
        mainGain.disconnect(audioContext.destination);
      } catch {
        // No direct connection existed — nothing to drop.
      }
      worklet.connect(audioContext.destination);
      mainGain.connect(worklet);
      gapTapArmed = true;
      worklet.port.postMessage({ type: 'arm', armed: true });
      if (armedAtAudioTime !== null) worklet.port.postMessage({ type: 'armAt', t: armedAtAudioTime });
      logEvent('gaptap.armed');
    })
    .catch((err: unknown) => {
      // No AudioWorklet support (or the context closed before setup): fall
      // back to the direct connection so playback still works; the gap signal
      // reads as absent — recorded so analysis knows why.
      logEvent('gaptap.unavailable', { error: String(err) });
      mainGain.connect(audioContext.destination);
    });

  // resume() logging: wrap the context's resume with a duration logger.
  const origResume = audioContext.resume.bind(audioContext);
  audioContext.resume = () => {
    counters.resumes++;
    const t0 = performance.now();
    return origResume().then(
      (r) => {
        logEvent('context.resume', { durationMs: performance.now() - t0 });
        return r;
      },
      (err) => {
        logEvent('context.resume.failed', { durationMs: performance.now() - t0, error: String(err) });
        throw err;
      },
    );
  };

  // ---- belt-and-braces: MediaRecorder capture of the same chain -----------
  // Records the graph output (mainGain → MediaStreamDestination) from the
  // start of every debug run — the final arbiter when in-page signals and
  // hearing disagree (spec Phase 1 item 2 / Phase 4 escalation). Bounded:
  // only the last ~5 min of chunks are kept (older chunks are discarded —
  // the capture exists to answer "what was actually heard around time T",
  // and T is always within minutes of the investigation moment).
  const captureTailMs = 5 * 60 * 1000;
  // Rough byte ceiling for that tail (stereo float32 @48 kHz ≈ 384 kB/s → ~115 MB;
  // capped tighter — Opus-encoded MediaRecorder output is far smaller in practice).
  const captureTailBytes = 32 * 1024 * 1024;
  let recorder: MediaRecorder | null = null;
  let captureChunks: Blob[] = [];
  let captureBytes = 0;
  try {
    const captureDest = audioContext.createMediaStreamDestination();
    mainGain.connect(captureDest);
    recorder = new MediaRecorder(captureDest.stream);
    recorder.ondataavailable = (e) => {
      if (e.data.size === 0) return;
      captureChunks.push(e.data);
      captureBytes += e.data.size;
      while (captureBytes > captureTailBytes && captureChunks.length > 1) {
        const dropped = captureChunks.shift()!;
        captureBytes -= dropped.size;
      }
    };
    recorder.start(1000); // 1 s chunks — the retention ring's granularity
    logEvent('capture.started', { tailMs: captureTailMs });
  } catch (err) {
    logEvent('capture.unavailable', { error: String(err) });
  }

  const snapshot = (): TelemetrySnapshot => ({
    session,
    counters,
    samples: samples.all,
    beats: beats.all,
    gaps: gaps.all,
    events: events.all,
    glitchMarks,
  });

  const dispose = () => {
    window.clearInterval(sampleTimer);
    window.clearInterval(stallWatch);
    longtaskObserver?.disconnect();
    audioContext.removeEventListener('statechange', onStateChange);
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    if (worklet) {
      try {
        mainGain.disconnect(worklet);
        worklet.disconnect();
      } catch {
        // context may already be closing
      }
      gapTapArmed = false;
    }
  };

  // Expose for CDP extraction + the Download-JSON button + the probe script.
  const w = window as unknown as {
    __telemetry?: () => TelemetrySnapshot;
    __gapTap?: {
      armed: () => boolean;
      blockMainThreadMs: (ms: number) => number;
      /** Probe handles driving the same arm/disarm path the pages drive. */
      pause: () => void;
      play: () => void;
      markGlitch: () => void;
    };
  };
  w.__telemetry = snapshot;
  w.__gapTap = {
    armed: () => gapTapArmed,
    // Deliberate main-thread block for the Phase-2 stall-survival probe.
    blockMainThreadMs: (ms: number) => {
      const end = performance.now() + ms;
      let sink = 0;
      while (performance.now() < end) sink += Math.sqrt(performance.now());
      return sink;
    },
    pause: () => hooks.onPlaybackPaused(),
    play: () => {
      if (armedAtAudioTime !== null) hooks.onPlaybackArmed(armedAtAudioTime);
    },
    markGlitch,
  };

  const captureBlob = async (): Promise<Blob | null> => {
    if (!recorder) return null;
    // Flush any partial chunk, then package what the ring retained.
    const stopped = new Promise<void>((resolve) => {
      const prev = recorder!.onstop;
      recorder!.onstop = () => {
        if (prev) (prev as (e: Event) => void).call(recorder, new Event('stop'));
        resolve();
      };
    });
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;
    if (captureChunks.length === 0) return null;
    return new Blob(captureChunks, { type: recorder.mimeType || 'audio/webm' });
  };

  void gapTapSetup; // fire-and-forget; errors are logged as events
  return {
    hooks,
    snapshot,
    dispose,
    markBeatCbStart,
    markBeatCbEnd,
    captureBlob,
    nowSec: now,
    markGlitch,
  };
}
