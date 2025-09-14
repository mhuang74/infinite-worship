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
    <div className="p-6 bg-white text-navy rounded-lg shadow-md border border-gold flex flex-col sm:flex-row items-center justify-center space-y-4 sm:space-y-0 sm:space-x-4">
      <div className="flex space-x-4">
        <button
          onClick={onPlayPause}
          className="px-6 py-3 bg-gold text-navy rounded-full font-bold text-lg shadow-lg hover:bg-yellow-400 transition"
        >
          {isPlaying ? '⏸️ Pause' : '▶️ Play'}
        </button>
        <button
          onClick={onRestart}
          className="px-6 py-3 bg-navy text-white rounded-full font-bold text-lg shadow-lg hover:bg-blue-800 transition"
        >
          🔄 Restart
        </button>
        <button
          onClick={onStop}
          className="px-6 py-3 bg-red-500 text-white rounded-full font-bold text-lg shadow-lg hover:bg-red-600 transition"
        >
          ⏹️ Stop
        </button>
      </div>
      <div className="flex items-center space-x-2">
        <label htmlFor="jump-prob" className="font-semibold">Jump Probability:</label>
        <input
          type="range"
          id="jump-prob"
          min="0"
          max="1"
          step="0.01"
          value={jumpProbability}
          onChange={(e) => onJumpProbabilityChange(parseFloat(e.target.value))}
          className="w-32 sm:w-48"
        />
        <span className="font-bold">{Math.round(jumpProbability * 100)}%</span>
      </div>
    </div>
  );
};

export default PlaybackControls;
