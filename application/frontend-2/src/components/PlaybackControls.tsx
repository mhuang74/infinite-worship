'use client';

import React from 'react';

interface PlaybackControlsProps {
  isPlaying: boolean;
  jumpProbability: number;
  onPlayPause: () => void;
  onRestart: () => void;
  onStop: () => void;
  onJumpProbabilityChange: (value: number) => void;
}

const PlaybackControls: React.FC<PlaybackControlsProps> = ({
  isPlaying,
  jumpProbability,
  onPlayPause,
  onRestart,
  onStop,
  onJumpProbabilityChange,
}) => {
  return (
    <div className="p-6 bg-gray-100 rounded-lg flex items-center justify-center space-x-4">
      <button
        onClick={onPlayPause}
        className="px-4 py-2 bg-green-500 text-white rounded"
      >
        {isPlaying ? 'Pause' : 'Play'}
      </button>
      <button
        onClick={onRestart}
        className="px-4 py-2 bg-gray-500 text-white rounded"
      >
        Restart
      </button>
      <button
        onClick={onStop}
        className="px-4 py-2 bg-red-500 text-white rounded"
      >
        Stop
      </button>
      <div className="flex items-center space-x-2">
        <label htmlFor="jump-prob">Jump Probability:</label>
        <input
          type="range"
          id="jump-prob"
          min="0"
          max="1"
          step="0.01"
          value={jumpProbability}
          onChange={(e) => onJumpProbabilityChange(parseFloat(e.target.value))}
          className="w-48"
        />
        <span>{Math.round(jumpProbability * 100)}%</span>
      </div>
    </div>
  );
};

export default PlaybackControls;
