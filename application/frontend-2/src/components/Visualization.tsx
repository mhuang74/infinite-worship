'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import WaveSurfer from 'wavesurfer.js';

interface VisualizationProps {
  audioFile: File | null;
  beats: any[];
  currentBeat: any | null;
  onSeek?: (progress: number) => void;
}

const Visualization: React.FC<VisualizationProps> = ({ audioFile, beats, currentBeat, onSeek }) => {
  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurfer = useRef<WaveSurfer | null>(null);
  const isReady = useRef<boolean>(false);

  // Initialize WaveSurfer instance
  useEffect(() => {
    if (waveformRef.current && audioFile) {
      wavesurfer.current = WaveSurfer.create({
        container: waveformRef.current,
        waveColor: '#1e3a8a',           // Church navy
        progressColor: '#fbbf24',       // Church gold
        cursorColor: '#fbbf24',         // Church gold
        barWidth: 2,
        barRadius: 1,
        height: 80,
        normalize: true,
      });

      wavesurfer.current.load(URL.createObjectURL(audioFile));

      // Mark as ready when audio is loaded
      wavesurfer.current.on('ready', () => {
        isReady.current = true;
      });

      return () => {
        if (wavesurfer.current) {
          wavesurfer.current.destroy();
          wavesurfer.current = null;
          isReady.current = false;
        }
      };
    }
  }, [audioFile]);

  // Handle seek functionality
  const handleSeek = useCallback((progress: number) => {
    if (onSeek) {
      onSeek(progress);
    }
  }, [onSeek]);

  // Add click handler for seeking
  useEffect(() => {
    if (wavesurfer.current) {
      wavesurfer.current.on('click', handleSeek);

      return () => {
        if (wavesurfer.current) {
          wavesurfer.current.un('click', handleSeek);
        }
      };
    }
  }, [handleSeek]);

  // Handle seeking to current beat
  useEffect(() => {
    if (wavesurfer.current && currentBeat && isReady.current) {
      const duration = wavesurfer.current.getDuration();
      if (duration > 0) {
        const progress = currentBeat.start / duration;
        if (isFinite(progress) && progress >= 0 && progress <= 1) {
          wavesurfer.current.seekTo(progress);
        }
      }
    }
  }, [currentBeat]);

  const getBeatColor = (cluster: number) => {
    const colors = [
      'bg-church-navy-600',
      'bg-church-navy-500',
      'bg-church-gold-500',
      'bg-vintage-bronze-500',
      'bg-church-navy-700',
      'bg-church-gold-400'
    ];
    return colors[cluster % colors.length];
  };

  const getBeatBorder = (beat: any) => {
    if (currentBeat && currentBeat.id === beat.id) {
      return 'border-4 border-church-gold-400 shadow-lg shadow-church-gold-400/50';
    }
    if (currentBeat && currentBeat.jump_candidates && currentBeat.jump_candidates.includes(beat.id)) {
      return 'border-2 border-church-gold-300 animate-pulse';
    }
    return 'border border-vintage-silver-400';
  };

  return (
    <div className="space-y-4">
      
      {/* Waveform Display - Styled as Oscilloscope Screen */}
      <div className="bg-black rounded-vintage p-4 shadow-vintage-inset border-4 border-vintage-silver-600">
        <div className="bg-vintage-silver-900 rounded-sm p-3 shadow-vintage-inset">
          
          {/* Oscilloscope Grid Lines */}
          <div className="relative">
            {/* Horizontal grid lines */}
            <div className="absolute inset-0 pointer-events-none">
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className="absolute w-full border-t border-church-gold-400/20"
                  style={{ top: `${i * 25}%` }}
                />
              ))}
            </div>
            
            {/* Vertical grid lines */}
            <div className="absolute inset-0 pointer-events-none">
              {[...Array(9)].map((_, i) => (
                <div
                  key={i}
                  className="absolute h-full border-l border-church-gold-400/20"
                  style={{ left: `${i * 12.5}%` }}
                />
              ))}
            </div>

            {/* Waveform Container */}
            <div className="relative z-10">
              <div ref={waveformRef} className="cursor-pointer"></div>
            </div>
          </div>
        </div>
        
        {/* Oscilloscope Labels */}
        <div className="flex justify-between items-center mt-2 px-2">
          <span className="text-vintage-label font-vintage text-church-gold-400 uppercase">Waveform</span>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-1">
              <div className="w-2 h-2 bg-church-navy-400 rounded-full"></div>
              <span className="text-vintage-label font-vintage text-vintage-silver-400 uppercase">Audio</span>
            </div>
            <div className="flex items-center space-x-1">
              <div className="w-2 h-2 bg-church-gold-400 rounded-full animate-pulse"></div>
              <span className="text-vintage-label font-vintage text-vintage-silver-400 uppercase">Progress</span>
            </div>
          </div>
        </div>
      </div>

      {/* Beat Visualization - Styled as Tape Timeline */}
      <div className="bg-vintage-metal rounded-vintage p-4 shadow-vintage-inset border-2 border-vintage-silver-300">
        <div className="mb-3">
          <div className="flex items-center justify-between">
            <span className="text-vintage-label font-vintage text-vintage-silver-700 uppercase tracking-wider">
              Beat Segments Timeline
            </span>
            <div className="text-vintage-label font-vintage text-vintage-silver-600">
              {beats.length} Segments • Current: {currentBeat ? currentBeat.id + 1 : '-'}
            </div>
          </div>
        </div>

        {/* Timeline Container */}
        <div className="bg-vintage-silver-800 rounded-sm p-3 shadow-vintage-inset overflow-x-auto">
          <div className="flex space-x-1" style={{ minWidth: 'max-content' }}>
            {beats.map((beat, index) => (
              <div
                key={beat.id}
                className={`
                  relative transition-all duration-200 hover:scale-105 cursor-pointer
                  ${getBeatColor(beat.cluster)}
                  ${getBeatBorder(beat)}
                  rounded-sm shadow-sm
                `}
                style={{
                  width: `${Math.max(beat.duration * 50, 12)}px`,
                  height: '40px'
                }}
                title={`Beat ${index + 1} • Cluster ${beat.cluster} • ${beat.duration.toFixed(2)}s`}
                onClick={() => onSeek && onSeek(beat.start / (beats[beats.length - 1]?.start + beats[beats.length - 1]?.duration || 1))}
              >
                {/* Beat number label */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xs font-vintage text-white font-bold drop-shadow-sm">
                    {index + 1}
                  </span>
                </div>
                
                {/* Current beat indicator */}
                {currentBeat && currentBeat.id === beat.id && (
                  <div className="absolute -top-2 left-1/2 transform -translate-x-1/2">
                    <div className="w-0 h-0 border-l-2 border-r-2 border-b-4 border-transparent border-b-church-gold-400"></div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Timeline Controls */}
        <div className="flex justify-between items-center mt-3 text-vintage-label font-vintage text-vintage-silver-600">
          <span>Click segments to seek</span>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-1">
              <div className="w-3 h-3 bg-church-gold-400 border-2 border-church-gold-500 rounded-sm"></div>
              <span>Current</span>
            </div>
            <div className="flex items-center space-x-1">
              <div className="w-3 h-3 bg-church-gold-300 border-2 border-church-gold-400 rounded-sm animate-pulse"></div>
              <span>Jump Options</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Visualization;
