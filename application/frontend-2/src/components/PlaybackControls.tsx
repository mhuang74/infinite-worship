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
    <div className="space-y-6">
      
      {/* Main Transport Controls */}
      <div className="flex items-center justify-center space-x-6 sm:space-x-8">
        
        {/* Restart Button */}
        <button
          onClick={onRestart}
          className="group relative w-16 h-16 sm:w-18 sm:h-18 lg:w-20 lg:h-20 rounded-vintage-button bg-vintage-metal border-4 border-vintage-silver-400 shadow-vintage-button hover:shadow-vintage-outset active:shadow-vintage-inset transition-all duration-150 transform hover:scale-105 active:scale-95"
          title="Restart from beginning"
        >
          <div className="absolute inset-2 rounded-vintage-button bg-church-navy-800 flex items-center justify-center">
            <svg className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6 text-church-gold-400 group-hover:text-white transition-colors duration-150" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
              <path d="M4 12l1-1v2z"/>
            </svg>
          </div>
          <div className="absolute -bottom-8 left-1/2 transform -translate-x-1/2">
            <span className="text-vintage-label font-vintage text-vintage-silver-700 uppercase tracking-wider whitespace-nowrap">Restart</span>
          </div>
        </button>

        {/* Main Play/Pause Button */}
        <button
          onClick={onPlayPause}
          className={`
            group relative w-20 h-20 sm:w-22 sm:h-22 lg:w-24 lg:h-24 rounded-vintage-button border-6 transition-all duration-150 transform hover:scale-105 active:scale-95
            ${isPlaying
              ? 'bg-church-gold-400 border-church-gold-600 shadow-vintage-outset animate-vintage-glow'
              : 'bg-vintage-metal border-vintage-silver-400 shadow-vintage-button hover:shadow-vintage-outset active:shadow-vintage-inset'
            }
          `}
          title={isPlaying ? 'Pause playback' : 'Start playback'}
        >
          <div className={`
            absolute inset-2 rounded-vintage-button flex items-center justify-center transition-all duration-150
            ${isPlaying
              ? 'bg-church-gold-500'
              : 'bg-church-navy-800 group-hover:bg-church-navy-700'
            }
          `}>
            {isPlaying ? (
              <svg className="w-5 h-5 sm:w-6 sm:h-6 lg:w-7 lg:h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
              </svg>
            ) : (
              <svg className="w-5 h-5 sm:w-6 sm:h-6 lg:w-7 lg:h-7 text-church-gold-400 group-hover:text-white transition-colors duration-150 ml-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z"/>
              </svg>
            )}
          </div>
          <div className="absolute -bottom-8 left-1/2 transform -translate-x-1/2">
            <span className="text-vintage-label font-vintage text-vintage-silver-700 uppercase tracking-wider">
              {isPlaying ? 'Pause' : 'Play'}
            </span>
          </div>
        </button>

        {/* Stop Button */}
        <button
          onClick={onStop}
          className="group relative w-16 h-16 sm:w-18 sm:h-18 lg:w-20 lg:h-20 rounded-vintage-button bg-vintage-metal border-4 border-vintage-silver-400 shadow-vintage-button hover:shadow-vintage-outset active:shadow-vintage-inset transition-all duration-150 transform hover:scale-105 active:scale-95"
          title="Stop playback"
        >
          <div className="absolute inset-2 rounded-vintage-button bg-church-navy-800 flex items-center justify-center">
            <div className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6 bg-church-gold-400 group-hover:bg-white transition-colors duration-150 rounded-sm"></div>
          </div>
          <div className="absolute -bottom-8 left-1/2 transform -translate-x-1/2">
            <span className="text-vintage-label font-vintage text-vintage-silver-700 uppercase tracking-wider">Stop</span>
          </div>
        </button>
      </div>

      {/* Probability Control Section */}
      <div className="mt-12 bg-vintage-silver-100 rounded-vintage p-6 shadow-vintage-inset border border-vintage-silver-300">
        
        {/* Control Label */}
        <div className="flex items-center mb-4">
          <div className="w-2 h-2 bg-church-gold-400 rounded-full mr-2"></div>
          <span className="text-vintage-label font-vintage text-vintage-silver-700 uppercase tracking-wider">
            Jump Probability Control
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-center">
          
          {/* Control Knob Section */}
          <div className="lg:col-span-2">
            <div className="relative">
              
              {/* Vintage Slider Track */}
              <div className="relative h-3 bg-vintage-silver-700 rounded-full shadow-vintage-inset border border-vintage-silver-600">
                <div
                  className="absolute h-full bg-church-gold-400 rounded-full transition-all duration-200 shadow-lg"
                  style={{ width: `${jumpProbability * 100}%` }}
                ></div>
              </div>
              
              {/* Slider Input */}
              <input
                type="range"
                id="jump-prob"
                min="0"
                max="1"
                step="0.01"
                value={jumpProbability}
                onChange={(e) => onJumpProbabilityChange(parseFloat(e.target.value))}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              
              {/* Tick marks */}
              <div className="flex justify-between mt-2 px-1">
                <span className="text-vintage-label font-vintage text-vintage-silver-600">0</span>
                <span className="text-vintage-label font-vintage text-vintage-silver-600">25</span>
                <span className="text-vintage-label font-vintage text-vintage-silver-600">50</span>
                <span className="text-vintage-label font-vintage text-vintage-silver-600">75</span>
                <span className="text-vintage-label font-vintage text-vintage-silver-600">100</span>
              </div>
            </div>
          </div>

          {/* Digital Display */}
          <div className="flex justify-center lg:justify-end">
            <div className="bg-black rounded-sm px-4 py-3 shadow-vintage-inset border-2 border-vintage-silver-600 min-w-[120px]">
              <div className="text-center">
                <div className="text-church-gold-400 text-2xl sm:text-3xl font-vintage font-mono leading-none">
                  {Math.round(jumpProbability * 100).toString().padStart(2, '0')}
                </div>
                <div className="text-church-gold-400 text-vintage-label font-vintage mt-1 opacity-75">
                  PERCENT
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Description */}
        <div className="mt-4 text-center">
          <p className="text-vintage-label text-vintage-silver-600 font-vintage uppercase tracking-wider">
            Controls randomness of musical transitions
          </p>
        </div>
      </div>

      {/* Status Indicators */}
      <div className="flex justify-center space-x-6 mt-6">
        <div className="flex items-center space-x-2">
          <div className={`w-3 h-3 rounded-full shadow-lg transition-all duration-200 ${isPlaying ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></div>
          <span className="text-vintage-label font-vintage text-vintage-silver-700 uppercase">Playback</span>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 bg-church-gold-400 rounded-full shadow-lg"></div>
          <span className="text-vintage-label font-vintage text-vintage-silver-700 uppercase">Ready</span>
        </div>
      </div>
    </div>
  );
};

export default PlaybackControls;
