'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import api from '@/lib/api';
import FileUpload from '@/components/FileUpload';
import PlaybackControls from '@/components/PlaybackControls';
import Visualization from '@/components/Visualization';
import SongMetadata from '@/components/SongMetadata';
import SongLibrary from '@/components/SongLibrary';
import SongSearch from '@/components/SongSearch';
import { AudioEngine, createAudioBuffer } from '@/lib/audio';

interface Song {
  song_id: string;
  original_filename: string;
  duration: number;
  tempo: number;
  beats: number;
  jump_points: number;
}

export default function HomePage() {
  const [songData, setSongData] = useState<any>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPlaybackPending, setIsPlaybackPending] = useState(false);
  const [jumpProbability, setJumpProbability] = useState(0.15);
  const [currentBeat, setCurrentBeat] = useState<any | null>(null);
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const [selectedSongName, setSelectedSongName] = useState<string | null>(null);
  const [loadingLibrarySong, setLoadingLibrarySong] = useState(false);
  const [activeTab, setActiveTab] = useState<'upload' | 'library' | 'search'>('library');
  const [songs, setSongs] = useState<Song[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [shouldAutoplay, setShouldAutoplay] = useState(false);
  const [totalJumps, setTotalJumps] = useState(0);
  const [totalPlayingTimeSec, setTotalPlayingTimeSec] = useState(0);

  const isPlayerReady = Boolean(songData && audioFile);

  // Effect to reset counters when song changes
  useEffect(() => {
    setTotalJumps(0);
    setTotalPlayingTimeSec(0);
  }, [songData]);

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

          const onJump = (jumps: number) => {
            setTotalJumps(jumps);
          };

          const onPlaybackStarted = () => {
            setIsPlaying(true);
            setIsPlaybackPending(false);
          };

          audioEngineRef.current = new AudioEngine(audioContextRef.current, audioBuffer, songData.segments, onBeatChange, onJump, onPlaybackStarted);

          // Set initial state
          setCurrentBeat(songData.segments[0]);
          setIsPlaying(shouldAutoplay);
          setIsPlaybackPending(shouldAutoplay);

          // Auto-play if flagged
          if (shouldAutoplay) {
            audioEngineRef.current.play();
            setShouldAutoplay(false);
          }

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
        const response = await api.get(`/songs/${selectedSongId}`);
        const songData = response.data;
        
        // Fetch segments data
        const segmentsResponse = await api.get(`/segments/${selectedSongId}`);
        
        if (!segmentsResponse.data || !segmentsResponse.data.segments) {
          throw new Error('No segments data available for this song');
        }
        
        // Create a blob from the file path and create a File object
        const audioResponse = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/uploads/${selectedSongId}`, {
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
      setIsPlaybackPending(false);
    } else {
      setIsPlaybackPending(true);
      audioEngineRef.current.play();
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

  // Effect to track playing time
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPlaying) {
      interval = setInterval(() => {
        setTotalPlayingTimeSec(prevTime => prevTime + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying]);

  // Effect to fetch songs and randomly select one on initial load
  useEffect(() => {
    const fetchSongsAndSelectRandom = async () => {
      try {
        setLibraryLoading(true);
        setLibraryError(null);
        const response = await api.get('/songs');
        const fetchedSongs = response.data.songs || [];
        setSongs(fetchedSongs);

        // Randomly select a song if library is not empty
        if (fetchedSongs.length > 0) {
          const randomIndex = Math.floor(Math.random() * fetchedSongs.length);
          const randomSong = fetchedSongs[randomIndex];
          setShouldAutoplay(true);
          setSelectedSongId(randomSong.song_id);
          setSelectedSongName(randomSong.original_filename);
        }
      } catch (err) {
        console.error('Error fetching songs:', err);
        setLibraryError('Failed to load song library. Is the server running?');
      } finally {
        setLibraryLoading(false);
      }
    };

    fetchSongsAndSelectRandom();
  }, []);

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
    setTotalPlayingTimeSec(0);
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
    setShouldAutoplay(true);
    setSelectedSongId(songId);
    setSelectedSongName(filename);
  };

  return (
    <main className="min-h-screen w-full px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-6xl space-y-6 sm:space-y-8">
        <header className="text-center">
          <h1 className="text-3xl sm:text-4xl font-bold text-white">Infinite Worship</h1>
          <p className="mt-1 text-sm text-white/80">Infinite Remix of Your Favorite Worship Songs</p>
        </header>

        <section className="cdpanel p-3 sm:p-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
            <div className="lg:col-span-2 space-y-4">
              {isPlayerReady ? (
                <Visualization
                  audioFile={audioFile}
                  beats={songData!.segments}
                  currentBeat={currentBeat}
                  onSeek={handleSeek}
                />
              ) : (
                <div className="p-4 sm:p-6 device-screen">
                  <div className="relative">
                    <div className="h-[88px] w-full bg-white/10 rounded animate-pulse" />
                  </div>
                  <div className="relative mt-4 w-full h-8 sm:h-10 bg-white/10 rounded animate-pulse" />
                </div>
              )}

              <div className="h-24 flex items-center justify-center text-white/70 text-sm">
                {loadingLibrarySong ? (
                  <div className="flex center">
                    <div className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full mr-2"></div>
                    Loading: {selectedSongName}...
                  </div>
                ) : selectedSongId && selectedSongName ? (
                  `Selected: ${selectedSongName}`
                ) : (
                  'No song selected'
                )}
              </div>

              <PlaybackControls
                isPlaying={isPlaying}
                isPlaybackPending={!isPlayerReady || isPlaybackPending}
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
                totalPlayingTimeSec={totalPlayingTimeSec}
                totalJumps={totalJumps}
              />
            </aside>
          </div>
        </section>

        <section className="cdpanel p-3 sm:p-4">
          <div className="mb-4">
            <div className="flex border-b border-white/20">
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
            </div>
          </div>

          {activeTab === 'library' && (
            <SongLibrary onSongSelect={handleSongSelect} songs={songs} loading={libraryLoading} error={libraryError} />
          )}

          {activeTab === 'search' && (
            <SongSearch onSongSelect={handleSongSelect} />
          )}

          {activeTab === 'upload' && (
            <div className="cdpanel-inner p-4 sm:p-6">
              <div className="engraved-label mb-2">Upload New Song</div>
              <FileUpload onUploadSuccess={handleUploadSuccess} onUploadError={handleUploadError} />
            </div>
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


        </section>
      </div>
    </main>
  );
}
