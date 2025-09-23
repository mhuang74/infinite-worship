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
  return (
    <div
      className="transport-surface px-4 py-4 sm:px-6 sm:py-5 flex items-center justify-between gap-4"
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
          className="transport-btn w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center text-navy-900"
          aria-label="Restart"
          title="Restart"
        >
          <span className="sr-only">Restart</span>
          <IconRestart />
        </button>
      </div>

      <div className="flex items-center gap-3">
        <label htmlFor="jump-prob" className="engraved-label">Auto Remix</label>
        <input
          type="range"
          id="jump-prob"
          min="0"
          max="1"
          step="0.01"
          value={jumpProbability}
          onChange={(e) => onJumpProbabilityChange(parseFloat(e.target.value))}
          className="w-36 sm:w-48 accent-gold-500"
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={jumpProbability}
          aria-label="Auto remix jump probability"
          title="Auto remix jump probability"
        />
        <span className="w-12 text-gold-400 font-semibold tabular-nums">
          {Math.round(jumpProbability * 100)}%
        </span>
      </div>
    </div>
  );
};

export default PlaybackControls;
