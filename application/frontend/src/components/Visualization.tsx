'use client';

import React, { useEffect, useRef, useCallback, useState } from 'react';
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

  // Positions for jump-candidate indicators (in px from left of waveform)
  const [candidateMarkers, setCandidateMarkers] = useState<{ id: number; left: number }[]>([]);

  const recalcCandidateMarkers = useCallback(() => {
    if (!wavesurfer.current || !isReady.current || !currentBeat || !waveformRef.current) {
      setCandidateMarkers([]);
      return;
    }
    const duration = wavesurfer.current.getDuration();
    const width = waveformRef.current.clientWidth;

    if (!duration || duration <= 0 || !width) {
      setCandidateMarkers([]);
      return;
    }

    const ids: number[] = Array.isArray(currentBeat.jump_candidates) ? currentBeat.jump_candidates : [];
    const markers = ids
      .map((id: number) => {
        const beat = (beats as any[]).find((b: any) => b.id === id);
        if (!beat) return null;
        const progress = beat.start / duration;
        const left = Math.max(0, Math.min(width, progress * width));
        return { id, left };
      })
      .filter(Boolean) as { id: number; left: number }[];

    setCandidateMarkers(markers);
  }, [beats, currentBeat]);

  useEffect(() => {
    recalcCandidateMarkers();
  }, [recalcCandidateMarkers]);

  useEffect(() => {
    const onResize = () => recalcCandidateMarkers();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [recalcCandidateMarkers]);

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
        recalcCandidateMarkers();
      });

      return () => {
        if (wavesurfer.current) {
          try {
            wavesurfer.current.destroy();
          } catch (error) {
            // Ignore cleanup errors
          }
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

  // Handle seeking to current beat (waveform only)
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
      'bg-blue-100',
      'bg-yellow-100',
      'bg-gray-50',
      'bg-cyan-100',
      'bg-amber-100',
      'bg-indigo-100'
    ];
    return colors[cluster % colors.length];
  };

  return (
    <div className="p-4 sm:p-6 device-screen">
      <div className="relative">
        <div ref={waveformRef}></div>

        {/* Jump candidate markers overlay (dots at bottom, more transparent than the cursor) */}
        <div className="pointer-events-none absolute inset-0 z-20">
          {candidateMarkers.map((m) => (
            <div
              key={`jump-${m.id}`}
              className="absolute bg-yellow/40 border border-white/80"
              style={{
                left: `${m.left}px`,
                width: 4,
                height: 4,
                bottom: -4,
                transform: 'translateX(-50%)',
                borderRadius: 2
              }}
            />
          ))}
        </div>
      </div>

      <div className="relative mt-4 w-full h-8 sm:h-10 bg-gray-100 rounded">
        {beats.map((beat) => {
          const duration = wavesurfer.current?.getDuration() || 0;
          if (duration <= 0) return null;
          const leftPercent = (beat.start / duration) * 100;
          const widthPercent = (beat.duration / duration) * 100;
          return (
            <div
              key={beat.id}
              id={`beat-${beat.id}`}
              className={`absolute top-0 h-full ${getBeatColor(beat.cluster)} ${
                currentBeat && currentBeat.id === beat.id ? 'border-2 border-gold-400' : ''
              } ${
                currentBeat && currentBeat.jump_candidates.includes(beat.id) ? 'animate-pulse' : ''
              }`}
              style={{
                left: `${leftPercent}%`,
                width: `${widthPercent}%`,
                minWidth: '1px'
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

export default Visualization;
