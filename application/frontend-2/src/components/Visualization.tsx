'use client';

import React, { useEffect, useRef } from 'react';
import WaveSurfer from 'wavesurfer.js';

interface VisualizationProps {
  audioFile: File | null;
  beats: any[];
  currentBeat: any | null;
}

const Visualization: React.FC<VisualizationProps> = ({ audioFile, beats, currentBeat }) => {
  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurfer = useRef<WaveSurfer | null>(null);

  useEffect(() => {
    if (waveformRef.current && audioFile) {
      wavesurfer.current = WaveSurfer.create({
        container: waveformRef.current,
        waveColor: 'violet',
        progressColor: 'purple',
      });

      wavesurfer.current.load(URL.createObjectURL(audioFile));

      return () => {
        wavesurfer.current?.destroy();
      };
    }
  }, [audioFile]);

  useEffect(() => {
    if (wavesurfer.current && currentBeat) {
      const progress = currentBeat.start / wavesurfer.current.getDuration();
      wavesurfer.current.seekTo(progress);
    }
  }, [currentBeat]);

  const getBeatColor = (cluster: number) => {
    const colors = ['bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-yellow-500', 'bg-purple-500', 'bg-pink-500'];
    return colors[cluster % colors.length];
  };

  return (
    <div className="p-6 bg-gray-100 rounded-lg">
      <div ref={waveformRef}></div>
      <div className="flex mt-4" style={{ width: '100%', overflowX: 'auto' }}>
        {beats.map((beat) => (
          <div
            key={beat.id}
            className={`h-10 ${getBeatColor(beat.cluster)} ${
              currentBeat && currentBeat.id === beat.id ? 'border-4 border-yellow-300' : ''
            } ${
              currentBeat && currentBeat.jump_candidates.includes(beat.id) ? 'animate-pulse' : ''
            }`}
            style={{ width: `${beat.duration * 100}px` }}
          ></div>
        ))}
      </div>
    </div>
  );
};

export default Visualization;
