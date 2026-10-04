/**
 * Zen Mode (issues #38–#42): fullscreen chromeless lean-back listening view.
 *
 * A thin host per the spec's Testing Decisions: all circle-drawing decisions
 * live in the pure `src/lib/zen/draw.ts` module; this component only
 *  - owns the canvas and replays the module's commands onto a real 2D
 *    context (beat-driven paints, ~1s bounded fade passes, no rAF loop),
 *  - resolves the active scheme's palette from CSS custom properties
 *    (canvas cannot consume utility classes; values differ per scheme),
 *  - enters OS fullscreen / requests the Screen Wake Lock (both
 *    progressive enhancements, silently skipped where unsupported), and
 *  - shows the auto-hiding exit ✕ (3s idle) + tap-to-begin gate fallback.
 *
 * The Player instance is NOT touched: zen is a view of the same playing
 * session; audio, jump counters and listening time continue on exit.
 */

'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Beat, JumpEvent } from '@/lib/types';
import {
  LAYOUT_RING,
  PAINT_FRAME,
  FADE_SECONDS,
  GLOW_DOT_POSITION,
  HALO_RADIUS_FACTOR,
  PLAY_GROWTH_FOR,
  PLAY_MAX_REPS,
  TILE_DIAMETER_FOR,
  type RingLayout,
  type ZenJump,
  type ZenPalette,
  type DrawTarget,
} from '@/lib/zen/draw';

interface ZenModeProps {
  beats: Beat[];
  /** Current beat per the Player's beat callback. */
  currentBeat: Beat | null;
  /** Jump events per the Player's widened jump callback (issue #39). */
  jumps: JumpEvent[];
  /** Bumped by the page whenever the engine resets its jump count (Restart, audio reload): stamps key on (epoch, count). */
  jumpEpoch: number;
  /** Per-beat playback tallies (beat.id → count); drives growth ribs + cap pulses. */
  beatPlayCounts?: Map<number, number>;
  /** True while audio is actually running. */
  isPlaying: boolean;
  /** Retry playback from the tap-to-begin gate (suspended-context fallback). */
  onResume: () => void;
  /** Exit back to the normal player (audio keeps playing). */
  onExit: () => void;
}

/** ✕ auto-hide delay (spec: 3s idle). */
const EXIT_IDLE_MS = 3000;

/** Jewel palette order — matches the waveform's jewel bar mapping (§2.4). */
const JEWEL_VARS = ['--jewel-ruby', '--jewel-gold', '--jewel-emerald', '--jewel-sapphire', '--jewel-amethyst', '--jewel-cyan'] as const;

/**
 * Resolve the ACTIVE scheme's colors at runtime (spec: dark and light both
 * verified). Mirrors Visualization's readVizColor pattern.
 */
export const readZenPalette = (win: Window): ZenPalette => {
  const styles = win.getComputedStyle(win.document.documentElement);
  const read = (name: string, fallback: string): string =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    // Canvas paint cannot use Tailwind classes: same jewels, resolved values.
    jewels: JEWEL_VARS.map((v) => read(v, '#fdb515')),
    playhead: read('--wave-playhead', '#fdb515'),
    background: read('--surface', '#0e141c'),
    spark: read('--zen-spark', '#ffffff'),
  };
};

/** #rrggbb | #rgb → "r, g, b" triplet, for building rgba() color stops. */
const toRgbTriplet = (hex: string): string => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '253, 181, 21'; // brand gold fallback
  const h = m[1];
  const [r, g, b] = h.length === 3 ? [h[0], h[1], h[2]].map((c) => c + c) : [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
  return `${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)}`;
};

/** One repaint: clears, lays out, and replays the draw module's commands. */
const paintZenCanvas = (
  canvas: HTMLCanvasElement,
  layout: RingLayout,
  palette: ZenPalette,
  beats: Beat[],
  currentBeat: Beat | null,
  jumps: ZenJump[],
  reducedMotion: boolean,
  nowSec: number,
  glowTSec: number | null,
  viewExtras: {
    currentBeatIndex: number;
    beatPlayCounts?: Map<number, number>;
    capPulseTSecByIndex?: Map<number, number>;
  },
): void => {
  const ctx2d = canvas.getContext('2d');
  if (!ctx2d) return;
  const target = ctx2d as unknown as DrawTarget;
  target.width = canvas.width;
  target.height = canvas.height;

  // The one opaque object draw.ts cannot create: the glow-dot halo's radial
  // gradient. Host-built each frame against the real 2D context; draw.ts
  // receives it opaquely (`unknown`) and falls back to stroke markers when
  // absent.
  const currentIndex = viewExtras.currentBeatIndex;
  let haloGradient: unknown;
  if (currentIndex >= 0) {
    const band = TILE_DIAMETER_FOR(beats.length, layout.radius);
    const counts = viewExtras.beatPlayCounts;
    const beat = beats[currentIndex];
    const growth = beat ? PLAY_GROWTH_FOR(counts?.get(beat.id) ?? 0) : 0;
    const dot = GLOW_DOT_POSITION(layout, band, growth, layout.tiles[currentIndex]);
    const r = band * HALO_RADIUS_FACTOR;
    const gradient = ctx2d.createRadialGradient(dot.x, dot.y, 0, dot.x, dot.y, r);
    gradient.addColorStop(0, `rgba(${toRgbTriplet(palette.playhead)}, 1)`);
    gradient.addColorStop(1, `rgba(${toRgbTriplet(palette.playhead)}, 0)`);
    haloGradient = gradient;
  }

  PAINT_FRAME(
    {
      beats,
      layout,
      palette,
      currentBeat,
      jumps,
      reducedMotion,
      nowSec,
      currentBeatGlowTSec: glowTSec,
      ...viewExtras,
      haloGradient,
    },
    target,
  );
};

const ZenMode: React.FC<ZenModeProps> = ({ beats, currentBeat, jumps, jumpEpoch, beatPlayCounts, isPlaying, onResume, onExit }) => {
  const overlayRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showExit, setShowExit] = useState(true);
  const [needsTap, setNeedsTap] = useState(false);
  const idleTimer = useRef<number | undefined>(undefined);
  const fadeTimer = useRef<number | undefined>(undefined);
  // "Once playing the gate never returns for that session" (spec).
  const gateSeenRef = useRef(false);
  // Jump + glow timestamps: set on the corresponding callbacks, read by paint.
  const jumpTimestamps = useRef(new Map<number, number>());
  const glowTSecRef = useRef<number | null>(null);
  const jumpsRef = useRef<JumpEvent[]>(jumps);
  const currentBeatRef = useRef<Beat | null>(currentBeat);
  const epochRef = useRef(jumpEpoch);
  // Cap-pulse state: previous play counts (to detect a count crossing past
  // PLAY_MAX_REPS) + ring-index → stamp-second map (deleted on expiry).
  const prevPlayCountsRef = useRef(new Map<number, number>());
  const capPulseTSecRef = useRef(new Map<number, number>());
  // Ref mirror of the beatPlayCounts prop: repaint reads refs (it runs at
  // beat frequency from effects keyed by coarse deps), never props directly.
  const beatPlayCountsRef = useRef(beatPlayCounts);
  beatPlayCountsRef.current = beatPlayCounts;

  const clearJumpStamps = () => {
    jumpTimestamps.current.clear();
    jumpsRef.current = [];
    glowTSecRef.current = null;
    // A new jump-list generation means a fresh playback session: jump stamps
    // and cap pulses restart from an empty slate with it. prevPlayCountsRef
    // is deliberately KEPT: beatPlayCounts is kept across Restart (that was
    // the point — growth history persists), so wiping it here would make the
    // next tally read prev = 0 and spuriously re-stamp every capped band.
    // It's a brand-new Map only on song switch (page resets counts there).
    capPulseTSecRef.current.clear();
  };

  // Song switch: jump counts restart from 1 — drop the previous song's
  // stamps or new jumps would inherit stale arrival times (instant decay).
  const beatsKeyRef = useRef(beats);
  if (beatsKeyRef.current !== beats) {
    beatsKeyRef.current = beats;
    clearJumpStamps();
  }
  // Engine Restart / in-place audio reload: the count re-uses old values, so
  // re-key stamps by (epoch, count) — the page bumps jumpEpoch on reset (review).
  if (epochRef.current !== jumpEpoch) {
    epochRef.current = jumpEpoch;
    clearJumpStamps();
  }

  const [reducedMotion, setReducedMotion] = useState(false);

  // beat id → ring index, shared by the arc resolution and the playhead's
  // currentBeatIndex (one build per repaint instead of two).
  const indexById = useMemo(() => {
    const map = new Map<number, number>();
    beats.forEach((beat, i) => map.set(beat.id, i));
    return map;
  }, [beats]);

  // Map jump events to ring indices + arrival timestamps once per jump list.
  const buildZenJumps = useCallback(
    (nowSec: number): ZenJump[] => {
      // The page keeps a small bounded tail (arcs live ≤ FADE_SECONDS), so
      // this stays O(tail); stamps are (epoch, count)-keyed (review).
      return jumpsRef.current.flatMap((jump) => {
        const stampKey = epochRef.current * 1_000_000 + jump.count;
        let stamp = jumpTimestamps.current.get(stampKey);
        if (stamp === undefined) {
          stamp = nowSec;
          jumpTimestamps.current.set(stampKey, stamp);
        }
        const fromIndex = indexById.get(jump.from.id);
        const toIndex = indexById.get(jump.to.id);
        if (fromIndex === undefined || toIndex === undefined) return [];
        return [{ ...jump, fromIndex, toIndex, eventTSec: stamp }];
      });
    },
    [indexById],
  );

  const repaint = useCallback(
    (layout: RingLayout, palette: ZenPalette, nowSec: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const currentBeat = currentBeatRef.current;
      paintZenCanvas(
        canvas,
        layout,
        palette,
        beats,
        currentBeat,
        buildZenJumps(nowSec),
        reducedMotion,
        nowSec,
        reducedMotion ? null : glowTSecRef.current,
        {
          currentBeatIndex: currentBeat ? (indexById.get(currentBeat.id) ?? -1) : -1,
          beatPlayCounts: beatPlayCountsRef.current,
          capPulseTSecByIndex:
            reducedMotion || capPulseTSecRef.current.size === 0
              ? undefined
              : capPulseTSecRef.current,
        },
      );
    },
    [beats, buildZenJumps, indexById, reducedMotion],
  );

  // Cap pulse: on each beatPlayCounts change, stamp ring indexes whose beat
  // increased past PLAY_MAX_REPS (7th play and EVERY further repeat — spec
  // 4c: each repeat re-pulses); stamps expire naturally (paint reads the
  // decay, ≤1s each) and are deleted when spent so the map stays bounded.
  // Reduced motion ⇒ no stamp (suppressed like the glow).
  useEffect(() => {
    if (!beatPlayCounts) return;
    // Always advance prevPlayCountsRef, even under reduced motion — otherwise
    // a reduced-motion stretch freezes it and turning reduced motion off
    // bulk-stamps pulses for every beat that capped in the meantime.
    beatPlayCounts.forEach((count, id) => {
      const prev = prevPlayCountsRef.current.get(id);
      if (
        !reducedMotion &&
        count > PLAY_MAX_REPS &&
        prev !== undefined &&
        count > prev
      ) {
        const ringIndex = indexById.get(id);
        if (ringIndex !== undefined) capPulseTSecRef.current.set(ringIndex, performance.now() / 1000);
      }
      prevPlayCountsRef.current.set(id, count);
    });
    if (reducedMotion) return;
    // Expire spent stamps and repaint so the pulse ramp is visible.
    const now = performance.now() / 1000;
    capPulseTSecRef.current.forEach((stamp, idx) => {
      if (now - stamp >= FADE_SECONDS) capPulseTSecRef.current.delete(idx);
    });
    if (capPulseTSecRef.current.size > 0 && layoutRef.current) {
      repaint(layoutRef.current, readZenPalette(window), now);
      fadePassRef.current?.();
    }
  }, [beatPlayCounts, indexById, reducedMotion, repaint]);

  // Entry: request OS fullscreen (layer 2, bonus) + Wake Lock (screen on).
  // Both are progressive enhancements — unsupported/rejected is silent
  // (iPhone Safari: no Fullscreen API on arbitrary elements; layer 1 still
  // delivers the chromeless view, per spec).
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    let wakeLock: { release: () => Promise<void> } | null = null;
    let cancelled = false;

    const setup = async () => {
      const doc = document as Document & {
        fullscreenElement: Element | null;
        exitFullscreen: () => Promise<void>;
      };
      if (!doc.fullscreenElement && overlay.requestFullscreen) {
        try {
          await overlay.requestFullscreen();
        } catch {
          // Silent: chromeless overlay still covers the viewport.
        }
      }
      const nav = navigator as Navigator & {
        wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
      };
      if (nav.wakeLock && !cancelled) {
        try {
          wakeLock = await nav.wakeLock.request('screen');
        } catch {
          // Silent: unsupported/denied — music keeps playing either way.
        }
      }
    };
    void setup();

    return () => {
      cancelled = true;
      if (wakeLock) {
        wakeLock.release().catch(() => {
          // Already released or unsupported — nothing to recover.
        });
      }
      // Exit layer 2 as part of the same path IF it is still ours; a manual
      // Esc full-screen exit keeps the overlay component alive harmlessly.
      const doc = document as Document & { fullscreenElement: Element | null };
      if (doc.fullscreenElement === overlay) {
        document.exitFullscreen().catch(() => {
          // Ignore: already exiting.
        });
      }
    };
  }, []);

  // prefers-reduced-motion: suppress glow pulse + arcs (one read per mount is
  // enough; the OS setting mid-session is an acceptable refresh boundary).
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Painting: burst on each beat change + a bounded fade pass, then static.
  // No continuous rAF loop (spec: battery).
  const layoutRef = useRef<RingLayout | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const palette = readZenPalette(window);

    const relayout = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Re-read per resize: browser zoom / monitor moves change the ratio
      // without remounting (review finding).
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(vw * dpr);
      canvas.height = Math.round(vh * dpr);
      canvas.style.width = `${vw}px`;
      canvas.style.height = `${vh}px`;
      layoutRef.current = LAYOUT_RING(beats, { width: vw, height: vh, margin: 32 });
      canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
      repaint(layoutRef.current, palette, performance.now() / 1000);
    };
    relayout();
    window.addEventListener('resize', relayout);

    // Bounded fade pass: repaint until glow/arcs settle, then stop. Under
    // reduced motion nothing decays (static highlight, no arcs), so the pass
    // is skipped entirely — no 20fps busy-loop for an effect that can't change.
    const stopAtRef = { current: 0 };
    const ensureFadePass = () => {
      if (reducedMotion) return;
      stopAtRef.current = performance.now() + FADE_SECONDS * 1000;
      if (fadeTimer.current !== undefined) return;
      fadeTimer.current = window.setInterval(() => {
        if (performance.now() >= stopAtRef.current) {
          window.clearInterval(fadeTimer.current);
          fadeTimer.current = undefined;
          return;
        }
        if (layoutRef.current) repaint(layoutRef.current, palette, performance.now() / 1000);
      }, 50);
    };
    fadePassRef.current = ensureFadePass;

    return () => {
      window.removeEventListener('resize', relayout);
      if (fadeTimer.current !== undefined) window.clearInterval(fadeTimer.current);
      fadeTimer.current = undefined;
    };
  }, [beats, repaint, reducedMotion]);

  const fadePassRef = useRef<(() => void) | null>(null);

  // Beat change: aim glow + repaint immediately (one burst, no loop).
  useEffect(() => {
    currentBeatRef.current = currentBeat;
    if (!currentBeat) return;
    glowTSecRef.current = performance.now() / 1000;
    if (layoutRef.current) {
      const palette = readZenPalette(window);
      repaint(layoutRef.current, palette, performance.now() / 1000);
      fadePassRef.current?.();
    }
  }, [currentBeat, repaint]);

  // Jump events: stamps handled by buildZenJumps; repaint burst mirrors beats.
  useEffect(() => {
    jumpsRef.current = jumps;
    if (jumps.length === 0 || reducedMotion) return;
    if (layoutRef.current) {
      const palette = readZenPalette(window);
      repaint(layoutRef.current, palette, performance.now() / 1000);
      fadePassRef.current?.();
    }
  }, [jumps, reducedMotion, repaint]);

  // Tap-to-begin gate: ENTRY-TIME ONLY (spec: "if playback is not actually
  // running when the mode is entered"; once playing it never returns that
  // session). A mid-session pause is not a gate condition — the ✕ remains
  // the way back to the player; the page's global spacebar still toggles
  // play/pause underneath (review note).
  useEffect(() => {
    if (gateSeenRef.current) return;
    gateSeenRef.current = true;
    if (!isPlaying) setNeedsTap(true);
  }, [isPlaying]);

  const armExitTimer = useCallback(() => {
    setShowExit(true);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setShowExit(false), EXIT_IDLE_MS);
  }, []);

  // ✕ visible on entry; reappears on pointer interaction; hides after 3s.
  useEffect(() => {
    armExitTimer();
    return () => window.clearTimeout(idleTimer.current);
  }, [armExitTimer]);

  const handlePointer = useCallback(() => {
    armExitTimer();
  }, [armExitTimer]);

  const handleGateTap = useCallback(() => {
    onResume();
  }, [onResume]);

  // Live onExit without re-subscribing: page.tsx passes a new inline callback
  // per render (which fires at beat frequency), and an effect dep on it would
  // push a history entry on every beat — flooding the stack (reviewed).
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  // Esc shares the ✕'s exit path: both must consume the pushed {zen:true}
  // entry so a later browser Back isn't silently eaten (review finding).
  const handleExitRef = useRef<() => void>(() => {});

  // Esc exits (keyboard user story); history back closes the overlay. Both
  // set up exactly once per mount. Dev StrictMode double-runs this effect
  // (Next 15 app router: reactStrictMode null → StrictMode in dev); the guard
  // keeps one push + one listener regardless.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleExitRef.current();
      }
    };
    const onPop = () => onExitRef.current();
    window.addEventListener('keydown', onKey);
    window.addEventListener('popstate', onPop);
    // One history entry per zen session: browser Back pops out of the mode.
    // Guarded: an unfinished sibling strict-run's entry is reused, not doubled.
    if (!window.history.state?.zen) window.history.pushState({ zen: true }, '');
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPop);
    };
  }, []);

  const handleExit = useCallback(() => {
    // Consume the history entry we pushed on entry (back = popstate = exit);
    // if it is already gone, exit directly.
    if (window.history.state?.zen) window.history.back();
    else onExitRef.current();
  }, []);
  handleExitRef.current = handleExit;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 bg-surface"
      onPointerDown={handlePointer}
      onPointerMove={handlePointer}
      role="dialog"
      aria-label="Zen mode — fullscreen visualization"
    >
      <canvas ref={canvasRef} className="absolute inset-0" />

      {needsTap && (
        <button
          type="button"
          onClick={handleGateTap}
          className="absolute inset-0 grid place-items-center bg-surface/80"
          aria-label="Tap to begin playback"
        >
          <span className="type-headline text-on-surface-variant">Tap to begin</span>
        </button>
      )}

      {showExit && !needsTap && (
        <button
          type="button"
          onClick={handleExit}
          className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full border border-outline-variant bg-surface-container-high/80 text-on-surface-variant transition-opacity duration-200 hover:bg-on-surface/10"
          aria-label="Exit zen mode"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        </button>
      )}
    </div>
  );
};

export default ZenMode;