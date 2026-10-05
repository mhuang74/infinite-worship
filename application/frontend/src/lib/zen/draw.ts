/**
 * Zen Mode pure draw module (issues #38–#41; visual upgrade v2).
 *
 * No React, no DOM: the single seam chosen by the spec's Testing Decisions.
 * Given the Analysis beat list, the active theme's palette, the current beat
 * and the jump events, this module decides every circle-drawing fact — tile
 * layout angles, cluster→color mapping, glow-dot cursor, inward growth ribs, jump
 * arcs + glow, cap pulses — and emits drawing commands against an injected
 * 2D-context-like interface. The ZenMode component is a thin host that
 * supplies a real canvas context (plus the one opaque object draw.ts cannot
 * create itself: the halo's radial gradient).
 *
 * Rendering model (spec Implementation Decisions): draw on each beat change;
 * a short bounded fade pass (~1s) handles the jump-arc glow, glow decay and cap
 * pulses; the screen is static between events. No continuous rAF loop.
 * Jump-arc memory (32 beats) repaints inside the beat-change bursts.
 */

import type { Beat, JumpEvent } from '../types';

export interface RingLayout {
  /** Center of the circle within the canvas viewport. */
  center: { x: number; y: number };
  /** Radius of the ring. */
  radius: number;
  /** One entry per Analysis beat, in order: position + angle around the ring. */
  tiles: TilePosition[];
  /** Rib stroke width in px; ramps 3 → 7 over minSide 820 → 920 (see LAYOUT_RING). */
  ribWidth: number;
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
  /** Ring index of `currentBeat` (−1 before the first callback); the host resolves it via the same id→index map the arcs use. */
  currentBeatIndex: number;
  /** Fully-resolved jump events (indices + arrival time). Most recent last. */
  jumps: ZenJump[];
  /** `prefers-reduced-motion: reduce` — suppress glow pulse, beam, arcs and cap pulses. */
  reducedMotion: boolean;
  /** Monotonic beat-tick counter (host increments once per distinct beat callback); drives jump-arc memory decay. */
  beatCount: number;
  /** Now, in seconds (monotonic; performance.now()/1000 in the host). */
  nowSec: number;
  /** Timestamp of the last beat change, for the glow decay (seconds). */
  currentBeatGlowTSec: number | null;
  /** Per-beat playback tallies (beat.id → count); absent ⇒ no growth ribs. */
  beatPlayCounts?: Map<number, number>;
  /** Ring index → cap-pulse start seconds; only beats past PLAY_MAX_REPS (their 16th play). */
  capPulseTSecByIndex?: Map<number, number>;
  /** Host-built radial gradient for the glow-dot halo (opaque to tests; tests exercise the stroke-marker fallback). */
  haloGradient?: unknown;
}

/** Jump event carrying the ring indices the arc needs + its arrival time/beat tick. */
export type ZenJump = JumpEvent & { fromIndex: number; toIndex: number; eventTSec: number; eventBeatCount: number };

/** Tile geometry knobs (single place; the host supplies the canvas size). */
/** Tile diameter ceiling for readable rings (TILE_DIAMETER_FOR clamps). */
const TILE_MAX_DIAMETER_PX = 44;
/** Bounded fade window: the jump-arc glow, glow decay and cap pulses settle inside this (spec ~1s). */
export const FADE_SECONDS = 1.0;
/** Ring radius floor (never smaller than this unless the viewport ceiling is tighter). */
const MIN_RING_RADIUS = 64;
/** Brightness mode: never-played band alpha. */
const COUNT_DIM_ALPHA = 0.35;
/** Brightness mode: count at which the band reaches full alpha / max mix. */
const COUNT_FULL_REPS = 16;
/** Brightness mode: max fraction the jewel mixes toward the contrast target —
 *  capped so the cluster hue stays identifiable at any count. */
const COUNT_LIGHTNESS_MIX_MAX = 0.5;
/** Chord bow: control point pulled toward the center by this fraction of the midpoint→center vector. */
const CURVE_INNER_PULL = 0.35;
/** Glow-dot offset from the band's inner edge outward (capped at band/2), per the v2 midline decision. */
const DOT_BASE_OFFSET = 9;
/** Glow-dot halo extends to band × this radius (host gradient + test marker share the factor). */
export const HALO_RADIUS_FACTOR = 2.5;
/** Max growth: per-beat play count above which the band stops growing (16th+ play pulses instead). */
export const PLAY_MAX_REPS = 15;
/** Rib alpha ramp: rib 1 flush against the band's inner edge at 0.9 (base-band alpha, no seam), decaying inward to RIB_ALPHA_MIN over PLAY_MAX_REPS ribs. */
const RIB_ALPHA_MIN = 0.02;
const ribAlpha = (k: number): number =>
  0.9 - ((k - 1) * (0.9 - RIB_ALPHA_MIN)) / (PLAY_MAX_REPS - 1);
/** Jump-arc glow window: glow layers decay linearly to 0 over this (time-based, from the jump's arrival stamp). */
const GLOW_SECONDS = 1.0;
/** Jump-arc beat-driven memory schedule: full → 0.15 alpha over 16 beats, → 0 over the next 16. */
const MEMORY_BEATS = 16;
/** Jump chord stroke width. */
const ARC_LINE_WIDTH = 3.2;
/** Arc glow layers, outer → inner: width px + fraction of the chord's alpha. */
const ARC_GLOW_LAYERS = [
  { width: 18, alphaFactor: 0.18 },
  { width: 11, alphaFactor: 0.35 },
];

const TAU = Math.PI * 2;
/** 12 o'clock in canvas space (y grows downward). */
export const START_ANGLE = -Math.PI / 2;

/**
 * Lay out the ring: one tile per beat, sequential around the circle starting
 * at 12 o'clock, clockwise (EternalJukebox's actual layout, spec). Radius is
 * a viewport fraction with precedence: ceiling wins over floor, floor wins
 * over fraction — the floor never leaks the ring outside the box. Ribs grow
 * INWARD from the band's inner edge on every viewport, so the box reserve is
 * just the band's outer half.
 */
export function LAYOUT_RING(
  beats: Beat[],
  viewport: { width: number; height: number; margin?: number },
): RingLayout {
  const margin = viewport.margin ?? 24;
  const cx = viewport.width / 2;
  const cy = viewport.height / 2;
  const minSide = Math.min(viewport.width, viewport.height);
  const box = minSide - margin * 2;
  // Desktop optimization ramp: below an 820px min side everything matches the
  // phone (0.35 fraction, 3px ribs); above a 920px min side it reaches the
  // desktop targets (0.42 fraction, 7px ribs). Continuous in between — no pop
  // when resizing across the breakpoint. 820/920 mirror the app's mobile/desktop
  // CSS breakpoint (max-width:819px / min-width:820px).
  const desktopT = clamp01((minSide - 820) / 100); // 0 at ≤820, 1 at ≥920
  const radiusFraction = 0.35 + 0.07 * desktopT;
  const ribWidth = 3 + 4 * desktopT;
  const r0 = Math.max(radiusFraction * minSide, MIN_RING_RADIUS);
  // Inward growth consumes inner space only, so the box reserve is just the
  // band's outer half. (Candidate dots paint up to ~34px outside the band on
  // sparse desktop rings — accepted: they are 0.5-alpha markers, and the 32px
  // margin absorbs all but ≤2px at the cardinal extremes of ≤28-beat rings.)
  const headroom = TILE_MAX_DIAMETER_PX / 2;
  const radius = Math.max(10, Math.min(r0, box / 2 - headroom));

  const spacing = TAU / beats.length;
  const tiles: TilePosition[] = beats.map((_, i) => {
    const angle = START_ANGLE + i * spacing;
    return {
      angle,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    };
  });

  return { center: { x: cx, y: cy }, radius, tiles, ribWidth };
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

/**
 * Brightness-mode band color: the jewel mixed toward a contrast target derived
 * from the background — dark background ⇒ toward white, light ⇒ toward black —
 * so hot sections always move AWAY from the background in both schemes. Simple
 * per-channel sRGB lerp; `progress` is the sqrt play-count progress (0..1).
 * Palette colors are declared 6-digit hex in globals.css; parse defensively
 * (3-digit tolerated) since canvas colors come from runtime CSS resolution.
 */
function COUNT_COLOR_FOR(jewel: string, progress: number, background: string): string {
  const chan = (hex: string, i: number): number => {
    const n = hex.replace('#', '');
    return parseInt(n.length === 3 ? n[i] + n[i] : n.slice(i * 2, i * 2 + 2), 16);
  };
  // Rec.709 luminance on 0..1 channels; the background is parsed once per
  // call (called ≤ once per band per frame — ~450 calls/frame total).
  const bgLum =
    (0.2126 * chan(background, 0) + 0.7152 * chan(background, 1) + 0.0722 * chan(background, 2)) / 255;
  const target = bgLum < 0.5 ? 255 : 0;
  const mix = COUNT_LIGHTNESS_MIX_MAX * progress;
  const c = (i: number): string => {
    const v = chan(jewel, i);
    return Math.round(v + (target - v) * mix).toString(16).padStart(2, '0');
  };
  return `#${c(0)}${c(1)}${c(2)}`;
}

/** Decay: 1 at event time, 0 at event time + FADE_SECONDS; linear. */
const decay = (elapsedSec: number): number =>
  elapsedSec <= 0 ? 1 : elapsedSec >= FADE_SECONDS ? 0 : 1 - elapsedSec / FADE_SECONDS;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Candidate-dot diameter: equals the playhead core width (core = band × 0.7). */
export const CANDIDATE_DOT_DIAMETER_FOR = (band: number): number => band * 0.7;
/** Candidate-dot alpha. */
export const CANDIDATE_DOT_ALPHA = 0.5;

/**
 * Glow-dot center: on the current tile's radial, at the base band's midline —
 * `ringRadius − band/2 + min(DOT_BASE_OFFSET, band/2)` outward (v2 decision 1:
 * base/2 can reach 22px, deeper than any dot placement). Independent of play
 * count: ribs grow inward and never move the band or the playhead.
 */
export function GLOW_DOT_POSITION(
  layout: RingLayout,
  band: number,
  tile: TilePosition,
): { x: number; y: number } {
  const r = layout.radius - band / 2 + Math.min(DOT_BASE_OFFSET, band / 2);
  const ux = layout.radius === 0 ? 1 : (tile.x - layout.center.x) / layout.radius;
  const uy = layout.radius === 0 ? 0 : (tile.y - layout.center.y) / layout.radius;
  return { x: layout.center.x + ux * r, y: layout.center.y + uy * r };
}

/**
 * Jump-candidate dot center: on the candidate tile's radial, OUTSIDE the ring
 * on every viewport — its outer edge sits 3px clear of the band's OUTER edge
 * (ringRadius + band/2); the inner space is rib territory. Independent of
 * growth: the dot never sits on the band, unlike the playhead glow-dot.
 */
export function CANDIDATE_DOT_POSITION(
  layout: RingLayout,
  band: number,
  tile: TilePosition,
): { x: number; y: number } {
  const dotRadius = CANDIDATE_DOT_DIAMETER_FOR(band) / 2;
  const r = layout.radius + band / 2 + 3 + dotRadius;
  const ux = layout.radius === 0 ? 1 : (tile.x - layout.center.x) / layout.radius;
  const uy = layout.radius === 0 ? 0 : (tile.y - layout.center.y) / layout.radius;
  return { x: layout.center.x + ux * r, y: layout.center.y + uy * r };
}

/** Beat-driven arc memory alpha: 1.0 → 0.15 over 16 beats, → 0 over the next 16; 0 at ≥32. */
const arcMemAlpha = (beatsSince: number): number => {
  if (beatsSince <= MEMORY_BEATS) return 1 - 0.85 * (beatsSince / MEMORY_BEATS);
  if (beatsSince < MEMORY_BEATS * 2) return 0.15 * (1 - (beatsSince - MEMORY_BEATS) / MEMORY_BEATS);
  return 0;
};

/**
 * Paint one frame. Emits ordered commands; the host replays them onto the
 * real context. Order: clear → tiles (+ growth ribs) → arcs → glow dot LAST
 * — the halo extends inward over chords, so it must paint above them.
 */
export function PAINT_FRAME(view: ZenViewState, ctx: DrawTarget): void {
  const { beats, layout, palette, reducedMotion, nowSec, jumps } = view;
  const N = beats.length;
  if (N === 0) return;

  // Background: opaque zen surface (host passes through in both schemes).
  ctx.beginPath();
  ctx.fillStyle = palette.background;
  ctx.rect(0, 0, ctx.width, ctx.height);
  ctx.fill();

  const counts = view.beatPlayCounts;
  const pulses = view.capPulseTSecByIndex;
  const currentIndex = view.currentBeatIndex ?? -1;
  const glowDecay = currentGlowDecay(view, reducedMotion, currentIndex);

  // Tiles: one annulus band per beat, occupying its angular slot on the ring
  // (EternalJukebox's layout — the segment spans the slot, colored by cluster).
  // The inner edge sits at ringRadius − band/2 for EVERY band (invariant);
  // replays grow inward as stepped per-rep ribs, never outward.
  const band = TILE_DIAMETER_FOR(N, layout.radius);
  const slot = TAU / N;
  // Gap between bands: proportional to the slot, never larger than a fraction
  // of it — keeps segments visible even when the 6px band floor overrides
  // slotArc (Defect A), and guarantees gapAngle < 0.2·slot so the band never
  // wraps past its own slot (Defect A′, angleEnd > angleStart by construction).
  const GAP = Math.min(band < 10 ? band * 0.18 : 1.5, slot * 0.2 * layout.radius);
  const gapAngle = GAP / layout.radius;
  layout.tiles.forEach((_tile, i) => {
    const beat = beats[i];
    if (!beat) return;
    const count = counts?.get(beat.id) ?? 0;
    // Missing stamp ⇒ no pulse (never a default-active one): decay maps
    // elapsed ≤ 0 to 1, so a fallback default must NOT be a sentinel like
    // Infinity (decay(−Inf) = 1 brightens the whole ring).
    const pulseDecay =
      !reducedMotion && pulses?.get(i) !== undefined
        ? decay(nowSec - pulses.get(i)!)
        : 0;
    ctx.beginPath();
    const jewel = JEWEL_COLOR_FOR_CLUSTER(beat.cluster, palette);
    ctx.strokeStyle = jewel;
    let lineWidth = band;
    let alpha: number;
    if (i === currentIndex) {
      // Current tile: thicker base annulus; ribs stay put (they are history,
      // not attention — multiplying them would break the inner-edge invariant).
      lineWidth = band * (reducedMotion ? 1.35 : 1.8);
      if (reducedMotion) {
        alpha = 1; // Static highlight — no decaying pulse (spec motion preference).
      } else {
        // Beat glow + cap pulse share the 0.55→1.0 ramp; max() when both live.
        const g = Math.max(glowDecay, pulseDecay);
        alpha = clamp01(0.55 + 0.45 * g);
      }
    } else if (pulseDecay > 0) {
      // Cap pulse: re-apply the current-beat-style alpha ramp to this band.
      alpha = clamp01(0.55 + 0.45 * pulseDecay);
    } else {
      // Play count encodes as band alpha + color lightness (two redundant
      // channels; alpha alone resolves only 4–6 levels). The current-tile and
      // cap-pulse overrides above win over the count alpha.
      const progress = Math.sqrt(Math.min(count, COUNT_FULL_REPS) / COUNT_FULL_REPS);
      // sqrt: big relative steps for the first few plays (where session count
      // mass lives), compressed tail; the cap pulse carries the >16 signal.
      alpha = COUNT_DIM_ALPHA + (1 - COUNT_DIM_ALPHA) * progress;
      ctx.strokeStyle = COUNT_COLOR_FOR(jewel, progress, palette.background);
    }
    ctx.globalAlpha = alpha;
    ctx.lineWidth = lineWidth;
    const angleStart = slot * i + START_ANGLE + gapAngle / 2;
    const angleEnd = angleStart + (slot - gapAngle);
    ctx.arc(layout.center.x, layout.center.y, layout.radius, angleStart, angleEnd);
    ctx.stroke();

    // Growth ribs: one stepped annulus per rep at full jewel color, growing
    // from the band's INNER edge toward the center on every viewport — radial
    // extent is the count signal; brightness stays a secondary channel in the
    // band itself. Rib k's centerline sits at ringRadius − band/2 − (k−0.5) ×
    // ribWidth: rib 1 flush against the band's inner edge.
    const ribReps = Math.max(0, Math.min(count, PLAY_MAX_REPS,
      Math.floor((layout.radius - band / 2 - 2) / layout.ribWidth)));
    const ribCenterR = (k: number): number =>
      layout.radius - band / 2 - (k - 0.5) * layout.ribWidth;
    const reps = ribReps;
    const ribColor = JEWEL_COLOR_FOR_CLUSTER(beat.cluster, palette);
    for (let k = 1; k <= reps; k++) {
      ctx.beginPath();
      ctx.strokeStyle = ribColor;
      ctx.lineWidth = layout.ribWidth;
      // Cap pulse lifts every rib by the same 0.55..1.0/0.9 brightness factor.
      ctx.globalAlpha = clamp01(
        pulseDecay > 0 ? (ribAlpha(k) * (0.55 + 0.45 * pulseDecay)) / 0.9 : ribAlpha(k),
      );
      ctx.arc(layout.center.x, layout.center.y, ribCenterR(k), angleStart, angleEnd);
      ctx.stroke();
    }
  });
  ctx.globalAlpha = 1;

  // Jump arcs: one smooth quadratic chord per jump bowing toward the center,
  // beat-driven short-term memory, colored by the TARGET beat's jewel. For the
  // first GLOW_SECONDS the chord is backed by additive glow layers (linear
  // ramp decay), which fade into the fixed-width chord. Suppress entirely
  // under reduced motion.
  if (!reducedMotion) {
    for (const jump of jumps) {
      const from = layout.tiles[jump.fromIndex];
      const to = layout.tiles[jump.toIndex];
      if (!from || !to) continue;

      // Decay anchors to recency of the JUMP EVENT, not playhead position —
      // measuring the playhead's wrapped distance from the source tile would
      // re-light an old arc at full alpha every lap of the ring.
      // Before the first beat callback (currentIndex = −1) the host's
      // beatCount is still 0, so any pre-playback fixture jump ages past the
      // 32-beat window and draws nothing — no stale full-alpha chords.
      const beatsSince = Math.max(0, view.beatCount - jump.eventBeatCount);
      const memAlpha = arcMemAlpha(beatsSince);
      if (memAlpha <= 0) continue; // ≥32 beats: gone (no stroke at all, not a zero-alpha paint)

      const age = nowSec - jump.eventTSec;
      if (age < 0) continue; // future-dated (not yet arrived): no strokes at all
      // Glow window ramp: >0 only inside the first GLOW_SECONDS after arrival.
      const ramp = clamp01(1 - age / GLOW_SECONDS);

      // Control point: endpoint midpoint pulled toward the ring center.
      const mx = (from.x + to.x) / 2;
      const my = (from.y + to.y) / 2;
      const cx = mx + (layout.center.x - mx) * CURVE_INNER_PULL;
      const cy = my + (layout.center.y - my) * CURVE_INNER_PULL;

      const toBeat = beats[jump.toIndex];
      if (!toBeat) continue;
      const arcColor = JEWEL_COLOR_FOR_CLUSTER(toBeat.cluster, palette);

      const strokeArc = (width: number, alpha: number) => {
        ctx.beginPath();
        ctx.strokeStyle = arcColor;
        ctx.lineWidth = width;
        ctx.globalAlpha = clamp01(alpha);
        ctx.moveTo(from.x, from.y);
        ctx.quadraticCurveTo(cx, cy, to.x, to.y);
        ctx.stroke();
      };

      // Glow layers paint first (under), only inside the glow window; skip
      // zero-alpha paints entirely.
      if (ramp > 0) {
        for (const layer of ARC_GLOW_LAYERS) {
          const glowAlpha = clamp01(layer.alphaFactor * ramp * memAlpha);
          if (glowAlpha <= 0) continue;
          strokeArc(layer.width, glowAlpha);
        }
      }
      // The fixed-width chord is always drawn (from t0; the glow fades into it).
      strokeArc(ARC_LINE_WIDTH, 1.0 * memAlpha);
    }
    ctx.globalAlpha = 1;
  }

  // Jump-candidate dots: one small translucent dot per beat that is a jump
  // candidate of the current beat, in the candidate tile's radial — OUTSIDE
  // the ring on every viewport (outer edge 3px clear of the band's outer
  // edge; see CANDIDATE_DOT_POSITION). Static state markers, not
  // motion — painted under reduced motion too (same rationale as growth
  // ribs).
  if (currentIndex >= 0) {
    const current = beats[currentIndex];
    if (current && Array.isArray(current.jump_candidates)) {
      for (const id of current.jump_candidates) {
        if (id === current.id) continue; // self-candidate: no dot under the playhead core
        const idx = beats.findIndex((b) => b.id === id);
        if (idx === -1) continue;
        const cTile = layout.tiles[idx];
        const cBeat = beats[idx];
        if (!cTile || !cBeat) continue;
        const pos = CANDIDATE_DOT_POSITION(layout, band, cTile);
        ctx.beginPath();
        ctx.fillStyle = JEWEL_COLOR_FOR_CLUSTER(cBeat.cluster, palette);
        ctx.globalAlpha = CANDIDATE_DOT_ALPHA;
        ctx.arc(pos.x, pos.y, CANDIDATE_DOT_DIAMETER_FOR(band) / 2, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // Glow-dot playhead on the ring (LAST: its halo must sit above the chords).
  // No dot before the first beat callback.
  if (currentIndex >= 0) {
    const tile = layout.tiles[currentIndex];
    const beat = beats[currentIndex];
    const dotColor = beat
      ? JEWEL_COLOR_FOR_CLUSTER(beat.cluster, palette)
      : JEWEL_COLOR_FOR_CLUSTER(0, palette); // first-jewel fallback (pre-callback can't happen here, but never guess a color)
    const dot = GLOW_DOT_POSITION(layout, band, tile);
    if (view.haloGradient !== undefined) {
      // Host-built radial gradient (rgba(dotColor,1) → rgba(dotColor,0)).
      ctx.beginPath();
      ctx.fillStyle = view.haloGradient;
      ctx.arc(dot.x, dot.y, band * HALO_RADIUS_FACTOR, 0, TAU);
      ctx.fill();
    } else {
      // Test-verified fallback: stroked halo ring marker.
      ctx.beginPath();
      ctx.strokeStyle = dotColor;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 1;
      ctx.arc(dot.x, dot.y, band * HALO_RADIUS_FACTOR, 0, TAU);
      ctx.stroke();
    }
    // Core: solid disk over the halo center.
    ctx.beginPath();
    ctx.fillStyle = dotColor;
    ctx.arc(dot.x, dot.y, band * 0.7, 0, TAU);
    ctx.fill();
  }
}

/** Glow decay of the current beat: 1 at the beat tick, 0 after FADE_SECONDS. */
function currentGlowDecay(
  view: ZenViewState,
  reducedMotion: boolean,
  currentIndex: number,
): number {
  if (reducedMotion || currentIndex < 0) return 0;
  return clamp01(decay(view.nowSec - (view.currentBeatGlowTSec ?? view.nowSec)));
}

/**
 * Band thickness for annulus-band rendering: the band occupies the beat's
 * angular slot on the ring. Bounded below by visibility (6px) and above by
 * readability — never grossly wider than the slot's arc (color separation) —
 * and by the 44px ceiling. Dense rings (a real song is ~450 beats) keep a
 * visible band; sparse rings expand toward the ceiling.
 */
export function TILE_DIAMETER_FOR(beatCount: number, ringRadius: number): number {
  if (beatCount <= 0) return 0;
  const slotArc = (TAU * ringRadius) / beatCount;
  return Math.max(6, Math.min(TILE_MAX_DIAMETER_PX, slotArc * 0.72));
}

export interface DrawTarget {
  width: number;
  height: number;
  beginPath(): void;
  /** widens from string: the host assigns a real CanvasGradient for the dot halo (opaque here). */
  fillStyle: string | unknown;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  rect(x: number, y: number, w: number, h: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  fill(): void;
  stroke(): void;
}