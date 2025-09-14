'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import FileUpload from '@/components/FileUpload';
import PlaybackControls from '@/components/PlaybackControls';
import Visualization from '@/components/Visualization';
import SongMetadata from '@/components/SongMetadata';
import { AudioEngine, createAudioBuffer } from '@/lib/audio';

export default function HomePage() {
  const [songData, setSongData] = useState<any>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [jumpProbability, setJumpProbability] = useState(0.15);
  const [currentBeat, setCurrentBeat] = useState<any | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const audioEngineRef = useRef<AudioEngine | null>(null);

  // Effect to create or destroy the AudioEngine instance when a song is loaded/unloaded
  useEffect(() => {
    const setupEngine = async () => {
      if (audioFile && songData) {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        
        // Stop and clear the old engine instance if it exists
        if (audioEngineRef.current) {
          audioEngineRef.current.stop();
          audioEngineRef.current = null;
        }

        try {
          const audioBuffer = await createAudioBuffer(audioFile, audioContextRef.current);
          
          // Callback for the engine to update the UI
          const onBeatChange = (beat: any) => {
            setCurrentBeat(beat);
          };

          audioEngineRef.current = new AudioEngine(audioContextRef.current, audioBuffer, songData.segments, onBeatChange);
          
          // Set initial state
          setCurrentBeat(songData.segments[0]);
          setIsPlaying(false);

        } catch (e) {
          setError('Failed to decode audio file.');
          console.error(e);
        }
      }
    };

    setupEngine();

    // Cleanup on component unmount
    return () => {
      audioEngineRef.current?.stop();
    };
  }, [audioFile, songData]);

  const handlePlayPause = useCallback(() => {
    if (!audioEngineRef.current) return;
    if (isPlaying) {
      audioEngineRef.current.pause();
      setIsPlaying(false);
    } else {
      audioEngineRef.current.play();
      setIsPlaying(true);
    }
  }, [isPlaying]);

  // Effect to handle spacebar play/pause
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        event.preventDefault();
        handlePlayPause();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handlePlayPause]);

  const handleUploadSuccess = (data: any) => {
    // This will trigger the useEffect above to set up the new engine
    setSongData(data);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    if (fileInput && fileInput.files) {
      setAudioFile(fileInput.files[0]);
    }
    setError('');
  };

  const handleUploadError = (message: string) => {
    setError(message);
  };

  const handleRestart = () => {
    if (!audioEngineRef.current) return;
    audioEngineRef.current.restart();
    setIsPlaying(true);
  };

  const handleStop = () => {
    if (!audioEngineRef.current) return;
    audioEngineRef.current.stop();
    setIsPlaying(false);
  };

  const handleJumpProbabilityChange = (value: number) => {
    setJumpProbability(value);
    if (audioEngineRef.current) {
      audioEngineRef.current.setJumpProbability(value);
    }
  };

  const handleSeek = (progress: number) => {
    if (!audioEngineRef.current || !songData) return;

    // Get the precise duration from the audio buffer
    const totalDuration = audioEngineRef.current.getDuration();
    const targetTime = progress * totalDuration;

    audioEngineRef.current.seekToTime(targetTime);
  };

  return (
    <main className="min-h-screen bg-navy text-white p-4">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold text-center mb-8 text-gold">Infinite Worship</h1>

        <div className="mb-8">
          <FileUpload onUploadSuccess={handleUploadSuccess} onUploadError={handleUploadError} />
          {error && <p className="text-red-500 mt-2">{error}</p>}
        </div>

        {songData && (
          <div className="flex flex-col lg:flex-row gap-8">
            <div className="flex-1">
              <div className="bg-white rounded-full p-6 shadow-2xl border-4 border-gold">
                <Visualization audioFile={audioFile} beats={songData.segments} currentBeat={currentBeat} onSeek={handleSeek} />
              </div>
              <div className="mt-6">
                <PlaybackControls
                  isPlaying={isPlaying}
                  jumpProbability={jumpProbability}
                  onPlayPause={handlePlayPause}
                  onRestart={handleRestart}
                  onStop={handleStop}
                  onJumpProbabilityChange={handleJumpProbabilityChange}
                />
              </div>
            </div>
            <div className="lg:w-1/3">
              <SongMetadata songData={songData} audioFile={audioFile} />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
