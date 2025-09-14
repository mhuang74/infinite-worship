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
        waveColor: '#FFD95A',      // gold-400
        progressColor: '#F5C518',  // gold-500
        cursorColor: '#FFFFFF',
        height: 88,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
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
      'bg-gold-500',
      'bg-gold-400',
      'bg-navy-600',
      'bg-navy-700',
      'bg-white/40',
      'bg-white/20'
    ];
    return colors[cluster % colors.length];
  };

  return (
    <div className="p-4 sm:p-6 device-screen">
      <div ref={waveformRef}></div>
      <div className="flex mt-4 w-full overflow-x-auto gap-[1px]">
        {beats.map((beat) => (
          <div
            key={beat.id}
            className={`h-8 sm:h-10 ${getBeatColor(beat.cluster)} ${
              currentBeat && currentBeat.id === beat.id ? 'border-2 border-gold-400' : ''
            } ${
              currentBeat && currentBeat.jump_candidates.includes(beat.id) ? 'animate-pulse' : ''
            }`}
            style={{ width: `${Math.max(2, Math.floor(beat.duration * 100))}px` }}
          />
        ))}
      </div>
    </div>
  );
};

export default Visualization;
