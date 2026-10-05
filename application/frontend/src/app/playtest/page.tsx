'use client';

/**
 * /playtest — smoothness-telemetry harness (spec:
 * specs/playback-stutter-telemetry-v2.md, Phase 1 item 1).
 *
 * Debug-only route. Loads any audio URL + Analysis-JSON URL directly (no
 * R2 coupling), decodes, and drives the real AudioEngine. All modes are
 * inert without explicit URL params — the route does nothing on its own.
 *
 * URL params:
 *  - audio=<url>      audio file URL (required)
 *  - analysis=<url>   Analysis JSON URL (required unless control=element/loop)
 *  - p=<0..1>         engine jump probability (default: engine default 0.15)
 *  - zen=1            mount the real ZenMode component (observed config)
 *  - control=element  plain <audio> element baseline (media-element pipeline)
 *  - control=loop     single looping BufferSource through mainGain (render path)
 *  - debug=1          telemetry wiring (also used by controls)
 *
 * window.__telemetry returns the ring-buffer snapshot (CDP extraction);
 * the Download JSON button serializes the same shape (Mac transport).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioEngine, createAudioBuffer } from '@/lib/audio';
import ZenMode from '@/components/ZenMode';
import { debugFlagEnabled, startTelemetry, type Telemetry } from '@/lib/smoothness';
import type { Beat, JumpEvent } from '@/lib/types';

type ControlMode = 'element' | 'loop' | null;

interface HarnessParams {
  audioUrl: string | null;
  analysisUrl: string | null;
  p: number | null;
  zen: boolean;
  control: ControlMode;
  debug: boolean;
}

interface AnalysisJson {
  segments?: Beat[];
}

const readParams = (): HarnessParams => {
  const q = new URLSearchParams(window.location.search);
  const pRaw = q.get('p');
  const pParsed = pRaw !== null && pRaw !== '' ? Number(pRaw) : NaN;
  const controlRaw = q.get('control');
  const control: ControlMode =
    controlRaw === 'element' ? 'element' : controlRaw === 'loop' ? 'loop' : null;
  return {
    audioUrl: q.get('audio'),
    analysisUrl: q.get('analysis'),
    p: Number.isFinite(pParsed) ? pParsed : null,
    zen: q.get('zen') === '1',
    control,
    debug: debugFlagEnabled(window.location.search),
  };
};

/** Analysis JSON shape check: segments must be a non-empty beat array. */
const parseBeats = (raw: unknown): Beat[] => {
  if (typeof raw !== 'object' || raw === null || !('segments' in raw)) {
    throw new Error('Analysis JSON has no segments array');
  }
  const beats = (raw as AnalysisJson).segments;
  if (!Array.isArray(beats) || beats.length === 0) throw new Error('Analysis has no beats');
  return beats;
};

/**
 * First and last audible regions of a decoded buffer, for the loop control:
 * RMS over 0.5 s windows; a window is audible when its RMS exceeds
 * NEAR_SILENCE_RMS (same threshold order as the gap tap). Returns the start
 * of the first audible window and the END of the last one so the loop never
 * crosses lead-in or tail silence (a wrap through silence reads as a
 * multi-second "dropout" on the render-thread tap).
 */
const NEAR_SILENCE_RMS = 1e-4;
const WINDOW_SEC = 0.5;
const audibleRegion = (buffer: AudioBuffer): { startSec: number; endSec: number } => {
  const windowLen = Math.max(1, Math.floor(WINDOW_SEC * buffer.sampleRate));
  const windows = Math.floor(buffer.length / windowLen);
  const loud = new Array<boolean>(windows);
  for (let w = 0; w < windows; w++) {
    let sum = 0;
    const offset = w * windowLen;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < windowLen; i++) sum += data[offset + i] * data[offset + i];
    }
    const rms = Math.sqrt(sum / (windowLen * buffer.numberOfChannels));
    loud[w] = rms >= NEAR_SILENCE_RMS;
  }
  const first = loud.indexOf(true);
  const last = loud.lastIndexOf(true);
  if (first === -1) return { startSec: 0, endSec: buffer.duration }; // all-silent fallback: loop everything
  return {
    startSec: first * WINDOW_SEC,
    endSec: Math.min(buffer.duration, (last + 1) * WINDOW_SEC),
  };
};

export default function PlaytestPage() {
  const [params, setParams] = useState<HarnessParams | null>(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState<string | null>(null);
  const [zenActive, setZenActive] = useState(false);
  const [currentBeat, setCurrentBeat] = useState<Beat | null>(null);
  const [jumpEvents, setJumpEvents] = useState<JumpEvent[]>([]);
  const [jumpEpoch, setJumpEpoch] = useState(0);
  const [beatPlayCounts, setBeatPlayCounts] = useState<Map<number, number>>(new Map());
  const [isPlaying, setIsPlaying] = useState(false);
  const [analysisBeats, setAnalysisBeats] = useState<Beat[] | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const engineRef = useRef<AudioEngine | null>(null);
  const loopSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const elementRef = useRef<HTMLAudioElement | null>(null);
  const telemetryRef = useRef<Telemetry | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    setParams(readParams());
  }, []);

  // Download JSON = the Mac transport (DevTools stays closed there); the
  // snapshot already carries the session-relative glitchMarks.
  const downloadJson = useCallback(() => {
    const snap = telemetryRef.current?.snapshot();
    if (!snap) return;
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smoothness-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // User glitch note (spec Phase 3 step 4): a session-relative timestamp the
  // user taps when they hear a glitch — the telemetry object owns the origin,
  // so marks align exactly with gaps[].t and the capture audio.
  const markGlitch = useCallback(() => {
    telemetryRef.current?.markGlitch();
  }, []);

  // Download the MediaRecorder capture tail (belt-and-braces arbiter).
  const downloadCapture = useCallback(async () => {
    const blob = await telemetryRef.current?.captureBlob();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smoothness-capture-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const togglePlayback = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (isPlaying) {
      engine.pause();
      setIsPlaying(false);
    } else {
      void audioContextRef.current?.resume();
      engine.play();
      setIsPlaying(true);
    }
  }, [isPlaying]);

  useEffect(() => {
    if (!params || startedRef.current) return;
    if (!params.audioUrl) {
      setError('Nothing to do: pass ?audio=<url> (plus ?analysis=<url>, or ?control=element|loop).');
      return;
    }
    if (!params.control && !params.analysisUrl) {
      setError('?analysis=<url> is required unless control=element|loop.');
      return;
    }
    startedRef.current = true;
    const audioUrl = params.audioUrl;

    const run = async () => {
      try {
        const win = window as unknown as {
          AudioContext?: typeof AudioContext;
          webkitAudioContext?: typeof AudioContext;
        };
        const Ctor = win.AudioContext ?? win.webkitAudioContext;
        if (!Ctor) throw new Error('Web Audio API unavailable');
        const ctx = new Ctor();
        audioContextRef.current = ctx;

        setStatus('fetching audio…');
        const audioResp = await fetch(audioUrl);
        if (!audioResp.ok) throw new Error(`audio fetch ${audioResp.status}`);
        const blob = await audioResp.blob();
        setStatus('decoding…');
        const audioBuffer = await createAudioBuffer(
          new File([blob], 'playtest-audio', { type: blob.type || 'audio/mpeg' }),
          ctx,
        );

        // ---- element control: plain <audio>, NO Web Audio wiring ------------
        // (routing the element through Web Audio would change what this
        // control tests: the media-element pipeline, isolating OS/device).
        if (params.control === 'element') {
          const el = document.createElement('audio');
          el.src = audioUrl;
          el.loop = true;
          el.controls = true;
          el.dataset.playtestControl = 'element';
          document.body.appendChild(el);
          elementRef.current = el;
          if (params.debug) {
            // No mainGain exists on this path — pass an isolated bus the tap
            // can hold (the element output never routes through Web Audio;
            // the worklet tap is NOT wired here per spec).
            const unusedBus = ctx.createGain();
            telemetryRef.current = startTelemetry({
              audioContext: ctx,
              mainGain: unusedBus,
              arms: { control: 'element' },
            });
          }
          void ctx.resume();
          void el.play().then(
            () => setIsPlaying(true),
            () => setError('element play() rejected — needs a user gesture or autoplay flag'),
          );
          setStatus('element control playing');
          return;
        }

        // ---- loop control: one continuous BufferSource through mainGain ----
        if (params.control === 'loop') {
          const bus = ctx.createGain();
          if (params.debug) {
            telemetryRef.current = startTelemetry({
              audioContext: ctx,
              mainGain: bus,
              arms: { control: 'loop' },
            });
          } else {
            bus.connect(ctx.destination);
          }
          // Loop only the AUDIBLE region: loop=true alone replays the file's
          // lead-in silence every wrap AND wraps through any tail quiet
          // stretch — bruno's 5.6 s tail silence surfaced as a 4.85 s
          // "dropout" at each wrap (verified; loud→loud loop points wrap
          // seamlessly). Scan the decoded buffer for the first/last
          // audible sample (RMS over 0.5 s windows above a near-silence
          // threshold) and loop between those, starting on the first one.
          const region = audibleRegion(audioBuffer);
          const src = ctx.createBufferSource();
          src.buffer = audioBuffer;
          src.loop = true;
          src.loopStart = region.startSec;
          src.loopEnd = region.endSec;
          src.connect(bus);
          void ctx.resume();
          src.start(0, region.startSec);
          loopSourceRef.current = src;
          // The audible region starts now — arm the tap immediately.
          telemetryRef.current?.hooks.onPlaybackArmed(ctx.currentTime);
          setIsPlaying(true);
          setStatus('loop control playing');
          return;
        }

        // ---- engine arm: the real AudioEngine (+ optional real ZenMode) ----
        setStatus('fetching analysis…');
        const analysisResp = await fetch(params.analysisUrl ?? '');
        if (!analysisResp.ok) throw new Error(`analysis fetch ${analysisResp.status}`);
        const beats = parseBeats(await analysisResp.json());
        setAnalysisBeats(beats);

        const onBeatChange = (beat: Beat) => {
          telemetryRef.current?.markBeatCbStart();
          setCurrentBeat(beat);
          setBeatPlayCounts((prev) => {
            const next = new Map(prev);
            next.set(beat.id, (next.get(beat.id) ?? 0) + 1);
            return next;
          });
          telemetryRef.current?.markBeatCbEnd(beat);
        };
        const onJump = (jump: JumpEvent) => {
          if (jump.count === 0) {
            setJumpEpoch((e) => e + 1);
            setJumpEvents([]);
            return;
          }
          setJumpEvents((prev) => [...prev.slice(-7), jump]);
        };
        const onPlaybackStarted = () => setIsPlaying(true);

        const engine = new AudioEngine(ctx, audioBuffer, beats, onBeatChange, onJump, onPlaybackStarted);
        engineRef.current = engine;
        if (params.p !== null) engine.setJumpProbability(params.p);

        // Telemetry after the engine exists (the in-chain gap tap splices
        // mainGain → worklet → destination), BEFORE the first play().
        if (params.debug) {
          const t = startTelemetry({
            audioContext: ctx,
            mainGain: engine.outputNode,
            arms: {
              control: 'engine',
              p: params.p !== null ? String(params.p) : 'default',
              zen: params.zen ? '1' : '0',
            },
          });
          telemetryRef.current = t;
          engine.setTelemetry(t.hooks);
        }

        void ctx.resume();
        engine.play();
        setIsPlaying(true);
        if (params.zen) setZenActive(true);
        setStatus(`playing — ${beats.length} beats, p=${params.p ?? 0.15}${params.zen ? ', zen on' : ''}`);
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    void run();
  }, [params]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      engineRef.current?.stop();
      loopSourceRef.current?.stop();
      elementRef.current?.pause();
      telemetryRef.current?.dispose();
      void audioContextRef.current?.close().catch(() => {});
    };
  }, []);

  if (!params) return <main className="min-h-screen bg-surface p-8 text-on-surface">loading…</main>;

  return (
    <main className="min-h-screen bg-surface p-8 text-on-surface">
      <h1 className="text-lg font-semibold">playtest — smoothness harness</h1>
      <p className="mt-2 text-sm text-on-surface-variant" data-testid="playtest-status">
        {error ?? status}
      </p>
      {params.debug && (
        <>
          <button
            type="button"
            onClick={downloadJson}
            className="mt-4 rounded-full border border-outline-variant px-4 py-2 text-sm"
            data-testid="playtest-download"
          >
            Download JSON
          </button>
          <button
            type="button"
            onClick={markGlitch}
            className="mt-4 ml-2 rounded-full border border-outline-variant px-4 py-2 text-sm"
            data-testid="playtest-mark-glitch"
          >
            Mark glitch now
          </button>
          <button
            type="button"
            onClick={() => void downloadCapture()}
            className="mt-4 ml-2 rounded-full border border-outline-variant px-4 py-2 text-sm"
            data-testid="playtest-download-capture"
          >
            Download capture
          </button>
        </>
      )}
      {error === null && zenActive && params.zen && analysisBeats && (
        <ZenMode
          beats={analysisBeats}
          currentBeat={currentBeat}
          jumps={jumpEvents}
          jumpEpoch={jumpEpoch}
          beatPlayCounts={beatPlayCounts}
          isPlaying={isPlaying}
          onTogglePlayback={togglePlayback}
          onJumpToBeat={(beat) => engineRef.current?.jumpToBeat(beat)}
          onExit={() => setZenActive(false)}
        />
      )}
    </main>
  );
}