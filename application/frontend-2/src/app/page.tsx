'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import axios from 'axios';
import FileUpload from '@/components/FileUpload';
import PlaybackControls from '@/components/PlaybackControls';
import Visualization from '@/components/Visualization';
import SongMetadata from '@/components/SongMetadata';
import SongLibrary from '@/components/SongLibrary';
import SongSearch from '@/components/SongSearch';
import { AudioEngine, createAudioBuffer } from '@/lib/audio';

export default function HomePage() {
  const [songData, setSongData] = useState<any>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [jumpProbability, setJumpProbability] = useState(0.15);
  const [currentBeat, setCurrentBeat] = useState<any | null>(null);
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const [selectedSongName, setSelectedSongName] = useState<string | null>(null);
  const [loadingLibrarySong, setLoadingLibrarySong] = useState(false);
  const [activeTab, setActiveTab] = useState<'upload' | 'library' | 'search'>('upload');

  const totalJumpPoints = useMemo(() => {
    if (!songData?.segments) return null;
    return songData.segments.reduce((count: number, b: any) => {
      const arr = Array.isArray(b.jump_candidates) ? b.jump_candidates : [];
      return count + (arr.length > 0 ? 1 : 0);
    }, 0);
  }, [songData]);

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

  // Effect to fetch song data when a song is selected from the library
  useEffect(() => {
    const fetchSongData = async () => {
      if (!selectedSongId) return;
      
      try {
        setLoadingLibrarySong(true);
        setError('');
        
        // Fetch song data from the API
        const response = await axios.get(`http://localhost:5555/songs/${selectedSongId}`);
        const songData = response.data;
        
        // Fetch segments data
        const segmentsResponse = await axios.get(`http://localhost:5555/segments/${selectedSongId}`);
        
        if (!segmentsResponse.data || !segmentsResponse.data.segments) {
          throw new Error('No segments data available for this song');
        }
        
        // Create a blob from the file path and create a File object
        const audioResponse = await fetch(`http://localhost:5555/uploads/${selectedSongId}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'audio/*',
          },
        });
        
        if (!audioResponse.ok) {
          throw new Error(`Failed to fetch audio file: ${audioResponse.statusText}`);
        }
        
        const blob = await audioResponse.blob();
        const file = new File([blob], songData.original_filename, { type: blob.type });
        
        // Update state with the fetched data
        setSongData(segmentsResponse.data);
        setAudioFile(file);
        
      } catch (err) {
        console.error('Error loading song from library:', err);
        setError('Failed to load song from library. Please try again.');
      } finally {
        setLoadingLibrarySong(false);
      }
    };
    
    fetchSongData();
  }, [selectedSongId]);

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
    setSelectedSongId(null);
    setSelectedSongName(null);
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
  
  const handleSongSelect = (songId: string, filename: string) => {
    setSelectedSongId(songId);
    setSelectedSongName(filename);
  };

  return (
    <main className="min-h-screen w-full px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-6xl space-y-6 sm:space-y-8">
        <header className="text-center">
          <h1 className="text-3xl sm:text-4xl font-bold text-white">Infinite Worship</h1>
          <p className="mt-1 text-sm text-white/80">When You Don't Want Worship To End...</p>
        </header>

        <section className="cdpanel p-3 sm:p-4">
          <div className="mb-4">
            <div className="flex border-b border-white/20">
              <button
                onClick={() => setActiveTab('upload')}
                className={`px-4 py-2 ${
                  activeTab === 'upload'
                    ? 'text-white border-b-2 border-blue-500'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                Upload New Song
              </button>
              <button
                onClick={() => setActiveTab('library')}
                className={`px-4 py-2 ${
                  activeTab === 'library'
                    ? 'text-white border-b-2 border-blue-500'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                Song Library
              </button>
              <button
                onClick={() => setActiveTab('search')}
                className={`px-4 py-2 ${
                  activeTab === 'search'
                    ? 'text-white border-b-2 border-blue-500'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                Search Songs
              </button>
            </div>
          </div>

          {activeTab === 'upload' && (
            <div className="cdpanel-inner p-4 sm:p-6">
              <div className="engraved-label mb-2">Upload New Song</div>
              <FileUpload onUploadSuccess={handleUploadSuccess} onUploadError={handleUploadError} />
            </div>
          )}

          {activeTab === 'library' && (
            <SongLibrary onSongSelect={handleSongSelect} />
          )}

          {activeTab === 'search' && (
            <SongSearch onSongSelect={handleSongSelect} />
          )}

          {error && (
            <div
              role="alert"
              className="mt-3 rounded-md border border-red-400/40 bg-red-500/20 text-white px-3 py-2 text-sm"
            >
              {error}
            </div>
          )}

          {loadingLibrarySong && (
            <div className="mt-3 rounded-md border border-blue-400/40 bg-blue-500/20 text-white px-3 py-2 text-sm flex items-center">
              <div className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full mr-2"></div>
              Loading song: {selectedSongName}...
            </div>
          )}

          {selectedSongId && selectedSongName && !loadingLibrarySong && (
            <div className="mt-3 rounded-md border border-green-400/40 bg-green-500/20 text-white px-3 py-2 text-sm">
              Selected song: {selectedSongName}
            </div>
          )}
        </section>

        {songData && (
          <section className="cdpanel p-3 sm:p-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
              <div className="lg:col-span-2 space-y-4">
                <Visualization
                  audioFile={audioFile}
                  beats={songData.segments}
                  currentBeat={currentBeat}
                  onSeek={handleSeek}
                />

                <PlaybackControls
                  isPlaying={isPlaying}
                  jumpProbability={jumpProbability}
                  onPlayPause={handlePlayPause}
                  onRestart={handleRestart}
                  onStop={handleStop}
                  onJumpProbabilityChange={handleJumpProbabilityChange}
                />
              </div>

              <aside className="cdpanel-inner p-4 sm:p-6">
                <SongMetadata
                  fileName={audioFile ? audioFile.name : null}
                  durationSec={audioEngineRef.current ? audioEngineRef.current.getDuration() : null}
                  beatsCount={songData?.segments ? songData.segments.length : null}
                  totalJumpPoints={totalJumpPoints}
                  currentBeat={currentBeat}
                  isPlaying={isPlaying}
                />
              </aside>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
