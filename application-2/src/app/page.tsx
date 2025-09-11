'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import FileUpload from '@/components/FileUpload';
import PlaybackControls from '@/components/PlaybackControls';
import Visualization from '@/components/Visualization';
import { AudioEngine, createAudioBuffer } from '@/lib/audio';

export default function HomePage() {
  const [songData, setSongData] = useState<any>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [jumpProbability, setJumpProbability] = useState(0.25);
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

  const handlePlayPause = () => {
    if (!audioEngineRef.current) return;
    if (isPlaying) {
      audioEngineRef.current.pause();
      setIsPlaying(false);
    } else {
      audioEngineRef.current.play();
      setIsPlaying(true);
    }
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

  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <div className="z-10 w-full max-w-5xl items-center justify-between font-mono text-sm lg:flex">
        <h1 className="text-4xl font-bold">Infinite Worship</h1>
      </div>

      <div className="w-full max-w-5xl">
        <div className="mb-8">
          <FileUpload onUploadSuccess={handleUploadSuccess} onUploadError={handleUploadError} />
          {error && <p className="text-red-500 mt-2">{error}</p>}
        </div>

        {songData && (
          <>
            <div className="mb-8">
              <Visualization audioFile={audioFile} beats={songData.segments} currentBeat={currentBeat} />
            </div>
            <div>
              <PlaybackControls
                isPlaying={isPlaying}
                jumpProbability={jumpProbability}
                onPlayPause={handlePlayPause}
                onRestart={handleRestart}
                onStop={handleStop}
                onJumpProbabilityChange={handleJumpProbabilityChange}
              />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
