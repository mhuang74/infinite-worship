'use client';

import React from 'react';

interface PlaybackControlsProps {
  isPlaying: boolean;
  isPlaybackPending?: boolean;
  jumpProbability: number;
  onPlayPause: () => void;
  onRestart: () => void;
  onStop: () => void;
  onJumpProbabilityChange: (value: number) => void;
}

const IconPlay = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M8 5v14l11-7z" />
  </svg>
);

const IconPause = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M6 5h4v14H6zm8 0h4v14h-4z" />
  </svg>
);

const IconStop = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M6 6h12v12H6z" />
  </svg>
);

const IconRestart = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M12 6V3L8 7l4 4V8c2.76 0 5 2.24 5 5a5 5 0 11-5-5z" />
  </svg>
);

const PlaybackControls: React.FC<PlaybackControlsProps> = ({
  isPlaying,
  isPlaybackPending = false,
  jumpProbability,
  onPlayPause,
  onRestart,
  onStop,
  onJumpProbabilityChange,
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
  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const pct = parseInt(e.target.value, 10);
    onJumpProbabilityChange(pct / 100);
  };
  const handleRangeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onJumpProbabilityChange(snapToAllowed(parseFloat(e.target.value)));
  };

  const remixTooltip = "How likely to jump. Usually lower value works better for fast songs with high number of jump points, and vice versa.";

  return (
    <div
      className="transport-surface px-4 py-4 sm:px-6 sm:py-5 flex items-center justify-between gap-4 flex-wrap"
      role="group"
      aria-label="Playback controls"
    >
      <div className="button-group-spacing">
        <button
          type="button"
          onClick={onPlayPause}
          disabled={isPlaybackPending}
          className={`transport-btn w-14 h-14 sm:w-16 sm:h-16 flex items-center justify-center text-navy-900 ${isPlaying ? 'accent-glow' : ''} ${isPlaybackPending ? 'opacity-50 cursor-not-allowed' : ''}`}
          aria-label={isPlaying ? 'Pause' : isPlaybackPending ? 'Loading...' : 'Play'}
          title={isPlaying ? 'Pause' : isPlaybackPending ? 'Loading...' : 'Play'}
        >
          <span className="sr-only">{isPlaying ? 'Pause' : isPlaybackPending ? 'Loading...' : 'Play'}</span>
          {isPlaybackPending ? (
            <div className="animate-spin h-5 w-5 border-2 border-navy-900/30 border-t-navy-900 rounded-full"></div>
          ) : isPlaying ? (
            <IconPause />
          ) : (
            <IconPlay />
          )}
        </button>

        {/* <button
          type="button"
          onClick={onStop}
          className="transport-btn w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center text-navy-900"
          aria-label="Stop"
          title="Stop"
        > 
          <span className="sr-only">Stop</span>
          <IconStop />
        </button> */}

        <button
          type="button"
          onClick={onRestart}
          disabled={isPlaybackPending}
          className={`transport-btn w-14 h-14 sm:w-16 sm:h-16 flex items-center justify-center text-navy-900 ${isPlaying ? 'accent-glow' : ''} ${isPlaybackPending ? 'opacity-50 cursor-not-allowed' : ''}`}
          aria-label={isPlaybackPending ? 'Loading...' : 'Restart'}
          title={isPlaybackPending ? 'Loading...' : 'Restart'}
        >
          <span className="sr-only">Restart</span>
          <IconRestart />
        </button>
      </div>

      <div className="flex items-center gap-3 flex-1 min-w-0">
        {/* Mobile: compact select with 10% steps, 15%–85% */}
        <div className="flex sm:hidden items-center gap-3 w-full">
          <label htmlFor="jump-prob-select" className="engraved-label">Remix</label>
          <select
            id="jump-prob-select"
            value={Math.round(snappedProbability * 100)}
            onChange={handleSelectChange}
            className="w-full max-w-[180px] rounded-md bg-navy-700/40 text-navy-50 px-2 py-2"
            aria-label={remixTooltip}
            title={remixTooltip}
          >
            {allowedValues.map(v => {
              const pct = Math.round(v * 100);
              return (
                <option key={pct} value={pct}>{pct}%</option>
              );
            })}
          </select>
        </div>

        {/* ≥ sm: responsive slider, snaps to allowed values */}
        <div className="hidden sm:flex items-center gap-3 flex-1 min-w-0">
          <label htmlFor="jump-prob-range" className="engraved-label">Remix</label>
          <input
            type="range"
            id="jump-prob-range"
            min={0.15}
            max={0.85}
            step={0.1}
            value={snappedProbability}
            onChange={handleRangeChange}
            className="w-full max-w-xs md:max-w-sm lg:max-w-md accent-gold-500"
            aria-valuemin={0.15}
            aria-valuemax={0.85}
            aria-valuenow={snappedProbability}
            aria-label={remixTooltip}
            title={remixTooltip}
          />
          <span className="w-12 text-gold-400 font-semibold tabular-nums text-right">
            {Math.round(snappedProbability * 100)}%
          </span>
        </div>
      </div>
    </div>
  );
};

export default PlaybackControls;
