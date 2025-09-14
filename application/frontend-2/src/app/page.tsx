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
    <div className="min-h-screen bg-gradient-to-br from-vintage-silver-200 to-vintage-silver-300 py-4 px-4 sm:py-8 sm:px-6 lg:px-8">
      {/* Vintage Audio Equipment Housing */}
      <div className="max-w-6xl mx-auto">
        
        {/* Church Branding Header */}
        <div className="mb-8 text-center">
          <div className="inline-block bg-church-gradient px-8 py-4 rounded-vintage shadow-vintage-panel">
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white tracking-wide font-vintage">
              INFINITE WORSHIP
            </h1>
            <div className="flex items-center justify-center mt-2 space-x-2">
              <div className="w-2 h-2 bg-church-gold-400 rounded-full animate-vintage-glow"></div>
              <p className="text-church-gold-400 text-sm uppercase tracking-widest font-vintage">
                Digital Audio System
              </p>
              <div className="w-2 h-2 bg-church-gold-400 rounded-full animate-vintage-glow"></div>
            </div>
          </div>
        </div>

        {/* Main Vintage Audio Equipment Panel */}
        <div className="bg-vintage-brushed rounded-2xl shadow-vintage-panel border-4 border-vintage-silver-400 p-6 sm:p-8">
          
          {/* Top Equipment Panel */}
          <div className="bg-vintage-metal rounded-vintage p-4 mb-6 border-2 border-vintage-silver-300 shadow-vintage-inset">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 bg-red-500 rounded-full shadow-lg"></div>
                <span className="text-vintage-label font-vintage text-vintage-silver-700 uppercase tracking-wider">POWER</span>
              </div>
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-1">
                  <div className="w-2 h-2 bg-church-gold-400 rounded-full"></div>
                  <span className="text-vintage-label font-vintage text-vintage-silver-700 uppercase">READY</span>
                </div>
                {isPlaying && (
                  <div className="flex items-center space-x-1">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                    <span className="text-vintage-label font-vintage text-vintage-silver-700 uppercase">PLAYING</span>
                  </div>
                )}
              </div>
            </div>
            
            {/* File Upload Section - Styled as Tape/CD Input */}
            <FileUpload onUploadSuccess={handleUploadSuccess} onUploadError={handleUploadError} />
            {error && (
              <div className="mt-4 p-3 bg-red-100 border border-red-400 rounded-vintage">
                <p className="text-red-700 text-sm font-vintage">{error}</p>
              </div>
            )}
          </div>

          {/* Main Display and Controls Section - Only shown when song is loaded */}
          {songData && (
            <>
              {/* Song Information Display Panel */}
              <div className="mb-6">
                <div className="bg-church-navy-900 rounded-vintage p-1 shadow-vintage-inset mb-4">
                  <div className="bg-black rounded-sm p-4">
                    <SongMetadata songData={songData} />
                  </div>
                </div>
              </div>

              {/* Waveform Visualization Panel */}
              <div className="mb-6">
                <div className="bg-vintage-metal rounded-vintage p-4 border-2 border-vintage-silver-300 shadow-vintage-inset">
                  <div className="flex items-center mb-3">
                    <div className="w-3 h-3 bg-church-gold-400 rounded-full mr-2"></div>
                    <span className="text-vintage-label font-vintage text-vintage-silver-700 uppercase tracking-wider">
                      WAVEFORM MONITOR
                    </span>
                  </div>
                  <Visualization audioFile={audioFile} beats={songData.segments} currentBeat={currentBeat} onSeek={handleSeek} />
                </div>
              </div>

              {/* Transport Controls Panel */}
              <div className="bg-vintage-metal rounded-vintage p-6 border-2 border-vintage-silver-300 shadow-vintage-inset">
                <div className="flex items-center mb-4">
                  <div className="w-3 h-3 bg-church-gold-400 rounded-full mr-2"></div>
                  <span className="text-vintage-label font-vintage text-vintage-silver-700 uppercase tracking-wider">
                    TRANSPORT CONTROLS
                  </span>
                </div>
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

          {/* Empty State - When no song is loaded */}
          {!songData && (
            <div className="text-center py-12">
              <div className="bg-vintage-metal rounded-vintage p-8 border-2 border-vintage-silver-300 shadow-vintage-inset">
                <div className="w-24 h-24 mx-auto mb-4 bg-church-navy-900 rounded-full flex items-center justify-center shadow-vintage-inset">
                  <svg className="w-12 h-12 text-church-gold-400" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
                  </svg>
                </div>
                <p className="text-vintage-display font-vintage text-vintage-silver-700 mb-2">
                  No Audio Loaded
                </p>
                <p className="text-vintage-label font-vintage text-vintage-silver-600 uppercase tracking-wider">
                  Upload a song to begin worship
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Equipment Model Information */}
        <div className="mt-8 text-center">
          <div className="inline-block bg-vintage-silver-800 text-vintage-silver-200 px-4 py-2 rounded-vintage text-xs font-vintage uppercase tracking-widest">
            Model: IW-2024 • Professional Audio System • Church Edition
          </div>
        </div>
      </div>
    </div>
  );
}
