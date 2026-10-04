'use client';

import React, { useEffect, useRef, useCallback, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import type { Beat } from '@/lib/types';

interface VisualizationProps {
  audioFile: File | null;
  beats: Beat[];
  currentBeat: Beat | null;
  onSeek?: (progress: number) => void;
}

// §6: canvas paint cannot use color-mix(), so the per-scheme waveform colors
// are pre-resolved custom properties in globals.css, read once at create time.
const readVizColor = (name: string, fallback: string): string => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};

// §2.4 jewel palette, round-robin by cluster index. Literal class names so
// Tailwind generates them; /70 keeps them legible against the screen inset.
const JEWEL_SEGMENT_CLASSES = [
  'bg-jewel-ruby/70',
  'bg-jewel-gold/70',
  'bg-jewel-emerald/70',
  'bg-jewel-sapphire/70',
  'bg-jewel-amethyst/70',
  'bg-jewel-cyan/70',
];

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
        const beat = beats.find((b) => b.id === id);
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

  // The init effect must not re-run per beat, so the ready handler reaches
  // the latest marker calculation through a ref instead of a dep.
  const recalcRef = useRef(recalcCandidateMarkers);
  recalcRef.current = recalcCandidateMarkers;

  // Initialize WaveSurfer instance
  useEffect(() => {
    if (waveformRef.current && audioFile) {
      wavesurfer.current = WaveSurfer.create({
        container: waveformRef.current,
        waveColor: readVizColor('--wave-unplayed', 'rgba(166, 200, 255, 0.42)'),
        progressColor: readVizColor('--wave-played', 'rgba(253, 181, 21, 0.88)'),
        cursorColor: readVizColor('--wave-playhead', '#fdb515'),
        cursorWidth: 2,
        height: 88,
        barWidth: 2,
        // §5.4: thin out bars on the mobile breakpoint (the canvas cannot
        // overflow the inset; a wider gap halves bar density like the
        // mockup's every-second-bar-hidden rule).
        barGap: window.matchMedia('(max-width: 819px)').matches ? 3 : 1,
        barRadius: 2,
        normalize: true,

      });

      wavesurfer.current.load(URL.createObjectURL(audioFile));

      // Mark as ready when audio is loaded
      wavesurfer.current.on('ready', () => {
        isReady.current = true;
        recalcRef.current();
      });

      return () => {
        if (wavesurfer.current) {
          try {
            wavesurfer.current.destroy();
          } catch {
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
        if (Number.isFinite(progress) && progress >= 0 && progress <= 1) {
          wavesurfer.current.seekTo(progress);
        }
      }
    }
  }, [currentBeat]);

  // Total duration for positioning beat bar overlays
  const totalDuration = wavesurfer.current?.getDuration() || 0;

  return (
    <div>
      <div className="relative">
        <div ref={waveformRef}></div>

        {/* Jump candidate markers overlay (§6 cyan dots at bottom) */}
        <div className="pointer-events-none absolute inset-0 z-20">
          {candidateMarkers.map((m) => (
            <div
              key={`jump-${m.id}`}
              className="absolute bg-jewel-cyan"
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

      <div className="relative mt-3.5 h-[22px] w-full overflow-hidden rounded">
        {/* Beat segments: jewel-tone cluster bar (§2.4) */}
        {beats.map((beat) => {
          if (totalDuration <= 0) return null;
          const leftPercent = (beat.start / totalDuration) * 100;
          const widthPercent = (beat.duration / totalDuration) * 100;
          return (
            <div
              key={beat.id}
              id={`beat-${beat.id}`}
              className={`absolute top-0 h-full ${JEWEL_SEGMENT_CLASSES[beat.cluster % JEWEL_SEGMENT_CLASSES.length]}`}
              style={{
                left: `${leftPercent}%`,
                width: `${widthPercent}%`,
                minWidth: '1px'
              }}
            />
          );
        })}

        {/* Overlay indicators: fixed-width vertical lines */}
        <div className="pointer-events-none absolute inset-0 z-10">
          {/* Current position: 2px gold full-height line with glow (§6) */}
          {totalDuration > 0 && currentBeat && Number.isFinite(currentBeat.start) && (
            <div
              className="playhead-marker absolute"
              style={{
                left: `${(currentBeat.start / totalDuration) * 100}%`,
                width: 2,
                top: 0,
                bottom: 0,
                transform: 'translateX(-50%)'
              }}
            />
          )}

          {/* Jump candidate ticks: 1px cyan vertical lines (§6) */}
          {totalDuration > 0 &&
            Array.isArray(currentBeat?.jump_candidates) &&
            (currentBeat?.jump_candidates ?? []).map((id: number) => {
              const beat = beats.find((b) => b.id === id);
              if (!beat) return null;
              return (
                <div
                  key={`tick-${id}`}
                  className="absolute bg-jewel-cyan/80"
                  style={{
                    left: `${(beat.start / totalDuration) * 100}%`,
                    width: 1,
                    top: 0,
                    bottom: 0,
                    transform: 'translateX(-50%)'
                  }}
                />
              );
            })}
        </div>
      </div>
    </div>
  );
};

export default Visualization;
