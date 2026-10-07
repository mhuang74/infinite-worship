'use client';

import React, { useEffect, useRef, useState } from 'react';

interface PlaybackControlsProps {
  isPlaying: boolean;
  /** True only while the engine is starting (play clicked / autoplay); page-level song loading is shown elsewhere. */
  isPlaybackPending?: boolean;
  jumpProbability: number;
  /** Current beat id — drives the FAB's beat-synced glow (spec §4). */
  currentBeatId?: number | null;
  onPlayPause: () => void;
  onRestart: () => void;
  onJumpProbabilityChange: (value: number) => void;
  /** Enter zen mode (disabled unless a Song is loaded and playing, #40). */
  onEnterZen?: () => void;
  /** True only when playback is actually running. */
  zenAvailable?: boolean;
}

const IconPlay = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M8 5v14l11-7z" />
  </svg>
);

const IconPause = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M6 5h4v14H6zm8 0h4v14h-4z" />
  </svg>
);

const IconRestart = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
  </svg>
);

const IconExpand = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
  </svg>
);

const PlaybackControls: React.FC<PlaybackControlsProps> = ({
  isPlaying,
  isPlaybackPending = false,
  jumpProbability,
  currentBeatId = null,
  onPlayPause,
  onRestart,
  onJumpProbabilityChange,
  onEnterZen,
  zenAvailable = false,
}) => {
  const allowedValues = React.useMemo(() => Array.from({ length: 8 }, (_, i) => 0.15 + i * 0.10), []);
  const snapToAllowed = React.useCallback((v: number) => {
    const clamped = Math.min(0.85, Math.max(0.15, v));
    let closest = allowedValues[0];
    let minDiff = Math.abs(clamped - closest);
    for (const val of allowedValues) {
      const d = Math.abs(clamped - val);
      if (d < minDiff) {
        minDiff = d;
        closest = val;
      }
    }
    return closest;
  }, [allowedValues]);
  const snappedProbability = snapToAllowed(jumpProbability);
  const handleRangeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onJumpProbabilityChange(snapToAllowed(parseFloat(e.target.value)));
  };

  // Beat-synced glow (spec §4): pulse the FAB halo on each beat while playing.
  // Transform/box-shadow only (see .fab-gold in globals.css) so the 100ms
  // lookahead scheduler is never contended; reduced-motion neutralizes it
  // entirely in CSS.
  const [pulse, setPulse] = useState(false);
  const pulseTimeout = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!isPlaying || currentBeatId === null) {
      // Pause mid-pulse must not leave the FAB stuck in the beating state.
      setPulse(false);
      return;
    }
    setPulse(true);
    clearTimeout(pulseTimeout.current);
    pulseTimeout.current = window.setTimeout(() => setPulse(false), 140);
    return () => clearTimeout(pulseTimeout.current);
  }, [currentBeatId, isPlaying]);

  const remixTooltip = "How likely to jump. Usually lower value works better for fast songs with high number of jump points, and vice versa.";
  const fillPercent = ((snappedProbability - 0.15) / (0.85 - 0.15)) * 100;

  return (
    <div
      className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-4 hero:justify-start"
      role="group"
      aria-label="Playback controls"
    >
      <button
        type="button"
        onClick={onRestart}
        disabled={isPlaybackPending}
        className="grid h-11 w-11 flex-none place-items-center rounded-full border border-outline text-on-surface-variant transition-colors duration-200 hover:bg-on-surface/10 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={isPlaybackPending ? 'Loading...' : 'Restart'}
        title={isPlaybackPending ? 'Loading...' : 'Restart'}
      >
        <span className="sr-only">Restart</span>
        <IconRestart />
      </button>

      <button
        type="button"
        onClick={onPlayPause}
        disabled={isPlaybackPending}
        className={`fab-gold grid h-[72px] w-[72px] flex-none place-items-center rounded-[22px] ${pulse ? 'fab-beating' : ''} ${isPlaybackPending ? 'cursor-not-allowed' : ''}`}
        aria-label={isPlaying ? 'Pause' : isPlaybackPending ? 'Loading...' : 'Play'}
        title={isPlaying ? 'Pause' : isPlaybackPending ? 'Loading...' : 'Play'}
      >
        <span className="sr-only">{isPlaying ? 'Pause' : isPlaybackPending ? 'Loading...' : 'Play'}</span>
        {isPlaybackPending ? (
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-on-gold/40 border-t-on-gold"></div>
        ) : isPlaying ? (
          <IconPause />
        ) : (
          <IconPlay />
        )}
      </button>

      {/* Zen mode entry (spec #38 beside play/pause; enabled only while a
          Song is loaded AND actually playing). */}
      <button
        type="button"
        onClick={() => onEnterZen?.()}
        disabled={!zenAvailable}
        className="grid h-11 w-11 flex-none place-items-center rounded-full border border-outline text-on-surface-variant transition-colors duration-200 hover:bg-on-surface/10 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={zenAvailable ? 'Enter zen mode — fullscreen visualization' : 'Play a song to enter zen mode'}
        title={zenAvailable ? 'Zen mode (fullscreen visualization)' : 'Play a song first'}
      >
        <span className="sr-only">Enter zen mode</span>
        <IconExpand />
      </button>

      {/* Unified remix-probability slider on all viewports (spec §5.2); the
          mobile <select> is gone. */}
      <div className="order-3 flex w-full items-center gap-3.5 hero:order-none hero:w-auto hero:min-w-0 hero:flex-1">
        <label htmlFor="jump-prob-range" className="whitespace-nowrap text-[13px] text-on-surface-variant">
          Remix probability
        </label>
        <input
          type="range"
          id="jump-prob-range"
          min={0.15}
          max={0.85}
          step={0.1}
          value={snappedProbability}
          onChange={handleRangeChange}
          className="md3-slider min-w-0 flex-1"
          style={{ '--fill': `${fillPercent}%` } as React.CSSProperties}
          aria-valuemin={0.15}
          aria-valuemax={0.85}
          aria-valuenow={snappedProbability}
          aria-label={remixTooltip}
          title={remixTooltip}
        />
        <span className="min-w-9 text-right text-sm font-semibold tabular-nums text-gold-foreground">
          {Math.round(snappedProbability * 100)}%
        </span>
      </div>
    </div>
  );
};

export default PlaybackControls;
