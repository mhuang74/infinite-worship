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
import { loadSongForPlayback } from '@/lib/player';
import { isPlayable } from '@/lib/upload';
import type { Song } from '@/lib/types';

export default function HomePage() {
  const APP_DESCRIPTION = 'Infinite Worship uses song and audio characteristics to detect smooth transition points for endless remixing. Currently limited to within a song. The ultimate goal is to smoothly transition between songs!';

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

  const [pollingSongId, setPollingSongId] = useState<string | null>(null);

  // Song id whose Analysis + audio are already loaded into the player, so a
  // library refresh does not refetch them (they are immutable once ready).
  const loadedSongIdRef = useRef<string | null>(null);
  // Consecutive polls that did not see the polling target; a few misses mean
  // the Song vanished from the library and polling should give up.
  const pollMissesRef = useRef(0);

  const selectedSongIdRef = useRef<string | null>(null);

  const loadSongs = useCallback(async ({ autoplayRandom = false, silent = false }: { autoplayRandom?: boolean; silent?: boolean } = {}) => {
    try {
      if (!silent) {
        setLibraryLoading(true);
      }
      setLibraryError(null);

      const response = await api.get('/api/songs');
      const fetchedSongs: Song[] = response.data.songs || [];
      setSongs(fetchedSongs);

      if (autoplayRandom && fetchedSongs.length > 0) {
        const playableSongs = fetchedSongs.filter((song: Song) => song.status === 'ready');
        if (playableSongs.length === 0) {
          selectedSongIdRef.current = null;
          setSelectedSongId(null);
          setSelectedSongName(null);
        } else {
          const randomIndex = Math.floor(Math.random() * playableSongs.length);
          const randomSong = playableSongs[randomIndex];
          selectedSongIdRef.current = randomSong.song_id;
          setShouldAutoplay(true);
          setSelectedSongId(randomSong.song_id);
          setSelectedSongName(randomSong.title);
        }
      } else if (selectedSongIdRef.current) {
        const matchingSong = fetchedSongs.find((song: Song) => song.song_id === selectedSongIdRef.current);
        if (!matchingSong) {
          selectedSongIdRef.current = null;
          setSelectedSongId(null);
          setSelectedSongName(null);
        } else {
          setSelectedSongName(matchingSong.title);
        }
      }
    } catch (err) {
      console.error('Error fetching songs:', err);
      setLibraryError('Failed to load song library. Is the server running?');
    } finally {
      setLibraryLoading(false);
    }
  }, []);

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

  // Effect to fetch song data when a song is selected from the library.
  // Serverless stack (issue #22): load the Analysis JSON + audio blob directly
  // from the Song's public R2 URLs (CORS-open custom domain) — no BFF proxy.
  // Only `ready` Songs are playable (ADR-0002); failed Songs show why.
  useEffect(() => {
    const loadSelectedSong = async () => {
      if (!selectedSongId) return;

      const song = songs.find((s) => s.song_id === selectedSongId);
      if (!song) {
        setError('Selected song is no longer in the library. Refresh and try again.');
        return;
      }

      if (!isPlayable(song.status)) {
        // Stop any running playback and clear the loaded song — the engine
        // effect tears down when audioFile/songData go null.
        audioEngineRef.current?.stop();
        audioEngineRef.current = null;
        loadedSongIdRef.current = null;
        setSongData(null);
        setAudioFile(null);
        setCurrentBeat(null);
        setIsPlaying(false);
        setIsPlaybackPending(false);
        if (song.status === 'failed') {
          setError(`Song "${song.title}" failed analysis${song.failure_reason ? `: ${song.failure_reason}` : '.'}`);
        } else {
          // pending/processing: not playable yet; clear any stale error
          setError(`Song "${song.title}" is ${song.status} — it becomes playable when analysis finishes.`);
        }
        return;
      }

      try {
        // The Analysis + audio are immutable once the Song is ready; skip the
        // refetch when this Song is already loaded (library refreshes must not
        // re-download the blob — see the polling effect). The ref is cleared
        // everywhere the player state is cleared.
        if (loadedSongIdRef.current === song.song_id) {
          return;
        }

        setLoadingLibrarySong(true);
        setError('');

        const loaded = await loadSongForPlayback(song);

        loadedSongIdRef.current = song.song_id;
        // Update state with the fetched data
        setSongData({ segments: loaded.beats });
        setAudioFile(loaded.audioFile);
      } catch (err) {
        console.error('Error loading song from storage:', err);
        setError('Failed to load song from storage. Please try again.');
      } finally {
        setLoadingLibrarySong(false);
      }
    };

    loadSelectedSong();
  }, [selectedSongId, songs]);

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

  useEffect(() => {
    loadSongs({ autoplayRandom: true });
  }, [loadSongs]);

  // Status polling (issue #23): after an upload, the Song row starts as
  // `pending` and the Worker moves it to `processing` → `ready` | `failed`.
  // Re-fetch the library every 3s until the polled Song reaches a terminal
  // status; the interval is cleared on terminal status, on a new upload, and
  // on unmount. Silent refreshes never spin the library refresh affordance.
  useEffect(() => {
    if (!pollingSongId) return;

    pollMissesRef.current = 0;
    let cancelled = false;

    const tick = async () => {
      try {
        const response = await api.get('/api/songs');
        if (cancelled) return;
        const fetchedSongs: Song[] = response.data.songs || [];
        setSongs(fetchedSongs);

        const polled = fetchedSongs.find((song: Song) => song.song_id === pollingSongId);
        if (!polled) {
          // Song vanished from the library (e.g. deleted) — give up soon.
          pollMissesRef.current += 1;
          if (pollMissesRef.current >= 3) {
            setPollingSongId(null);
          }
          return;
        }

        pollMissesRef.current = 0;
        if (polled.status === 'ready' || polled.status === 'failed') {
          setPollingSongId(null);
        }
      } catch (err) {
        // Transient network/BFF errors: keep polling; the next tick retries.
        console.error('Status poll failed:', err);
      }
    };

    const interval = setInterval(tick, 3000);
    void tick();

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pollingSongId]);

  // Presign-then-PUT upload finished; the Song row exists as `pending` and the
  // audio is in R2. No playback setup — analysis (finalize) is ticket #21.
  // Poll the library until the new Song reaches a terminal status (issue #23).
  const handleUploadSuccess = (songId: string) => {
    setError('');
    selectedSongIdRef.current = null;
    setSelectedSongId(null);
    setSelectedSongName(null);
    setPollingSongId(songId);
    loadSongs();
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
  
  const handleSongSelect = (songId: string, title: string) => {
    selectedSongIdRef.current = songId;
    setShouldAutoplay(true);
    setSelectedSongId(songId);
    setSelectedSongName(title);
  };

  return (
    <main className="min-h-screen w-full px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-6xl space-y-6 sm:space-y-8">
        <header className="text-center">
          <div className="flex items-center justify-center">
            <h1 className="text-3xl sm:text-4xl font-bold text-white" title={APP_DESCRIPTION}>Infinite Worship</h1>
            <button
              className="ml-2 text-white/60 hover:text-white text-lg"
              onClick={() => alert(APP_DESCRIPTION)}
              title="More info"
            >
              ℹ️
            </button>
          </div>
          <p className="mt-1 text-sm text-white/80">Smooth Remix of Your Favorite Worship Songs</p>
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
           <SongLibrary
             onSongSelect={handleSongSelect}
             songs={songs}
             loading={libraryLoading}
             error={libraryError}
             onRefresh={() => {
               void loadSongs();
             }}
             refreshing={libraryLoading}
           />
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
