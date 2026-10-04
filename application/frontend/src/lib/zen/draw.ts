/**
 * Zen Mode pure draw module (issues #38–#41).
 *
 * No React, no DOM: the single seam chosen by the spec's Testing Decisions.
 * Given the Analysis beat list, the active theme's palette, the current beat
 * and the jump events, this module decides every circle-drawing fact — tile
 * layout angles, cluster→color mapping, glow state, jump arcs — and emits
 * drawing commands against an injected 2D-context-like interface. The
 * ZenMode component is a thin host that supplies a real canvas context.
 *
 * Rendering model (spec Implementation Decisions): draw on each beat change;
 * a short bounded fade pass (~1s) handles glow/arc decay; the screen is
 * static between events. No continuous rAF loop.
 */

import type { Beat, JumpEvent } from '../types';

export interface RingLayout {
  /** Center of the circle within the canvas viewport. */
  center: { x: number; y: number };
  /** Radius of the ring. */
  radius: number;
  /** One entry per Analysis beat, in order: position + angle around the ring. */
  tiles: TilePosition[];
}

export interface TilePosition {
  /** radians; 0 = 12 o'clock, increasing clockwise (canvas space). */
  angle: number;
  x: number;
  y: number;
}

/** Runtime-resolved active scheme colors, injected into the draw logic. */
export interface ZenPalette {
  /** Jewel colors in cluster order (round-robin). */
  jewels: string[];
  /** Playhead/sweep accent (gold foreground of the active scheme). */
  playhead: string;
  /** Background of the zen overlay. */
  background: string;
}

export interface ZenViewState {
  /** Analysis beat list. */
  beats: Beat[];
  layout: RingLayout;
  palette: ZenPalette;
  /** The currently playing beat, or null before the first callback. */
  currentBeat: Beat | null;
  /** Fully-resolved jump events (indices + arrival time). Most recent last. */
  jumps: ZenJump[];
  /** `prefers-reduced-motion: reduce` — suppress glow pulse and arcs. */
  reducedMotion: boolean;
  /** Now, in seconds (monotonic; performance.now()/1000 in the host). */
  nowSec: number;
  /** Timestamp of the last beat change, for the glow decay (seconds). */
  currentBeatGlowTSec: number | null;
}

/** Jump event carrying the ring indices the arc needs + its start time. */
export type ZenJump = JumpEvent & { fromIndex: number; toIndex: number; eventTSec: number };

/** Tile geometry knobs (single place; the host supplies the canvas size). */
/** Tile diameter ceiling for readable rings (TILE_DIAMETER_FOR clamps). */
const TILE_MAX_DIAMETER_PX = 28;
/** Bounded fade window: arcs and glow settle inside this (spec ~1s). */
export const FADE_SECONDS = 1.0;
/** Sweep line length, as a fraction of tile radius, outside the ring. */
const SWEEP_STEM_RATIO = 1.35;

const TAU = Math.PI * 2;
/** 12 o'clock in canvas space (y grows downward). */
export const START_ANGLE = -Math.PI / 2;

/**
 * Lay out the ring: one tile per beat, sequential around the circle starting
 * at 12 o'clock, clockwise (EternalJukebox's actual layout, spec). The ring
 * fits inside the largest square that fits the viewport: radius is bounded by
 * min(w, h) minus margin, centered — correct in portrait and landscape
 * without reflow.
 */
export function LAYOUT_RING(
  beats: Beat[],
  viewport: { width: number; height: number; margin?: number },
): RingLayout {
  const margin = viewport.margin ?? 24;
  const cx = viewport.width / 2;
  const cy = viewport.height / 2;
  const box = Math.min(viewport.width, viewport.height) - margin * 2;
  // Tiles ride ON the ring; keep ≥~2× tile radius + sweep inside the square.
  const headroom = TILE_MAX_DIAMETER_PX / 2 * SWEEP_STEM_RATIO;
  const radius = Math.max(10, box / 2 - headroom);

  const spacing = TAU / beats.length;
  const tiles: TilePosition[] = beats.map((_, i) => {
    const angle = START_ANGLE + i * spacing;
    return {
      angle,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    };
  });

  return { center: { x: cx, y: cy }, radius, tiles };
}

/**
 * Cluster index → jewel palette color, round-robin (the same mapping the
 * waveform view's jewel bar uses, resolved through the active scheme's CSS
 * custom properties by the host — canvas cannot consume utility classes).
 */
export function JEWEL_COLOR_FOR_CLUSTER(cluster: number, palette: ZenPalette): string {
  const jewels = palette.jewels;
  if (jewels.length === 0) return '#fdb515'; // brand gold fallback
  const idx = ((cluster % jewels.length) + jewels.length) % jewels.length;
  return jewels[idx];
}

/** Decay: 1 at event time, 0 at event time + FADE_SECONDS; linear. */
const decay = (elapsedSec: number): number =>
  elapsedSec <= 0 ? 1 : elapsedSec >= FADE_SECONDS ? 0 : 1 - elapsedSec / FADE_SECONDS;

/**
 * Paint one frame. Emits ordered commands; the host replays them onto the
 * real context. Order: clear → tiles → sweep → glow → arcs last (on top).
 */
export function PAINT_FRAME(view: ZenViewState, ctx: DrawTarget): void {
  const { beats, layout, palette, reducedMotion, nowSec, jumps } = view;

  // Background: opaque zen surface (host passes through in both schemes).
  ctx.beginPath();
  ctx.fillStyle = palette.background;
  ctx.rect(0, 0, ctx.width, ctx.height);
  ctx.fill();

  const currentBeat = view.currentBeat;
  const currentIndex = currentBeat ? beats.findIndex((b) => b.id === currentBeat.id) : -1;

  // Tiles: one annulus band per beat, occupying its angular slot on the ring
  // (EternalJukebox's layout — the segment spans the slot, colored by cluster).
  // Stroked arcs centered on the ring radius; thickness from TILE_DIAMETER_FOR.
  const slot = TAU / beats.length;
  const band = TILE_DIAMETER_FOR(beats.length, layout.radius);
  const GAP = band < 10 ? band * 0.18 : 1.5; // angular gap between bands (px along circumference)
  const gapAngle = GAP / layout.radius;
  layout.tiles.forEach((tile, i) => {
    const beat = beats[i];
    if (!beat) return;
    ctx.beginPath();
    ctx.strokeStyle = JEWEL_COLOR_FOR_CLUSTER(beat.cluster, palette);
    let lineWidth = band;
    let angle = slot * i + START_ANGLE + gapAngle / 2;
    let arcLen = slot - gapAngle;
    if (i === currentIndex) {
      // Current tile: thicker band; glow only without reduced motion.
      lineWidth = band * (reducedMotion ? 1.35 : 1.8);
      if (reducedMotion) {
        // Static highlight — no decaying pulse (spec motion preference).
        ctx.globalAlpha = 1;
      } else {
        const glow = decay(nowSec - (view.currentBeatGlowTSec ?? nowSec));
        ctx.globalAlpha = Math.min(1, Math.max(0, 0.55 + 0.45 * glow));
      }
    } else {
      ctx.globalAlpha = 0.9;
    }
    ctx.lineWidth = lineWidth;
    ctx.arc(layout.center.x, layout.center.y, layout.radius, angle, angle + arcLen);
    ctx.stroke();
  });
  ctx.globalAlpha = 1;

  // Thin sweep indicator aiming at the current tile (spec: playhead).
  if (currentIndex >= 0) {
    const tile = layout.tiles[currentIndex];
    ctx.beginPath();
    ctx.strokeStyle = palette.playhead;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.9;
    ctx.moveTo(layout.center.x, layout.center.y);
    ctx.lineTo(tile.x * (1 - 1 / SWEEP_STEM_RATIO) + layout.center.x / SWEEP_STEM_RATIO, tile.y * (1 - 1 / SWEEP_STEM_RATIO) + layout.center.y / SWEEP_STEM_RATIO);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Jump arcs: exactly one per jump event, through the center, fading ~1s.
  if (!reducedMotion) {
    for (const jump of jumps) {
      const age = nowSec - jump.eventTSec;
      const a = decay(age);
      if (a <= 0) continue;
      ctx.beginPath();
      ctx.strokeStyle = palette.playhead;
      ctx.lineWidth = 3;
      ctx.globalAlpha = Math.min(1, Math.max(0, a));
      ctx.moveTo(layout.tiles[jump.fromIndex].x, layout.tiles[jump.fromIndex].y);
      ctx.lineTo(layout.center.x, layout.center.y);
      ctx.lineTo(layout.tiles[jump.toIndex].x, layout.tiles[jump.toIndex].y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

/**
 * Band thickness for annulus-band rendering: the band occupies the beat's
 * angular slot on the ring. Bounded below by visibility (4px) and above by
 * readability — never grossly wider than the slot's arc (color separation) —
 * and by the 28px ceiling. Dense rings (a real song is ~450 beats) keep a
 * visible band; sparse rings expand toward the ceiling.
 */
export function TILE_DIAMETER_FOR(beatCount: number, ringRadius: number): number {
  if (beatCount <= 0) return 0;
  const slotArc = (TAU * ringRadius) / beatCount;
  return Math.max(4, Math.min(TILE_MAX_DIAMETER_PX, slotArc * 0.72));
}

export interface DrawTarget {
  width: number;
  height: number;
  beginPath(): void;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  rect(x: number, y: number, w: number, h: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  fill(): void;
  stroke(): void;
}