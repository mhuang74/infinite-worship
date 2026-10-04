'use client';

import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import api from '@/lib/api';
import FileUpload from '@/components/FileUpload';
import Header from '@/components/Header';
import PlaybackControls from '@/components/PlaybackControls';
import Visualization from '@/components/Visualization';
import SongMetadata from '@/components/SongMetadata';
import SongLibrary from '@/components/SongLibrary';
import SongSearch from '@/components/SongSearch';
import { AudioEngine, createAudioBuffer } from '@/lib/audio';
import { loadSongForPlayback } from '@/lib/player';
import { isPlayable } from '@/lib/upload';
import type { Beat, Song } from '@/lib/types';

const formatClock = (seconds: number | null): string => {
  if (seconds == null || !Number.isFinite(seconds)) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const TABS = [
  { id: 'library', label: 'Song Library' },
  { id: 'search', label: 'Search Songs' },
  { id: 'upload', label: 'Upload New Song' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function HomePage() {
  const [songData, setSongData] = useState<{ segments: Beat[] } | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPlaybackPending, setIsPlaybackPending] = useState(false);
  const [jumpProbability, setJumpProbability] = useState(0.15);
  const [currentBeat, setCurrentBeat] = useState<Beat | null>(null);
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const [selectedSongName, setSelectedSongName] = useState<string | null>(null);
  const [loadingLibrarySong, setLoadingLibrarySong] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('library');
  // Sliding tab indicator (§5.3): measured from the active tab button.
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = tabRefs.current[activeTab];
    if (!el) return;
    const update = () => setIndicator({ left: el.offsetLeft + 12, width: el.offsetWidth - 24 });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [activeTab]);
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
    return songData.segments.reduce((count: number, b: Beat) => {
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
          const onBeatChange = (beat: Beat) => {
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
      <div className="mx-auto w-full max-w-[1080px] space-y-6 sm:space-y-8">
        <Header />

        {/* Hero now-playing card (spec §5.2) */}
        <section className="rounded-[28px] border border-outline-variant/55 bg-surface-container-low p-5 shadow-[0_1px_2px_rgba(0,0,0,0.3),0_4px_16px_rgba(0,0,0,0.18)] sm:p-7">
          <div className="grid grid-cols-1 gap-7 lg:grid-cols-[1fr_300px]">
            <div className="min-w-0">
              <h2 className="type-display">{selectedSongName ?? 'No song selected'}</h2>
              <p className="mb-5 mt-1.5 text-[13px] text-on-surface-variant">
                {songData
                  ? `${formatClock(audioEngineRef.current ? audioEngineRef.current.getDuration() : null)} · ${songData.segments.length} beats · ${totalJumpPoints ?? 0} jump points`
                  : 'Pick a song from the library below'}
              </p>

              {/* Screen inset: waveform + jewel beat-cluster bar */}
              <div className="rounded-2xl border border-outline-variant/45 bg-surface-container-lowest p-4 sm:px-5">
                {isPlayerReady ? (
                  <Visualization
                    audioFile={audioFile}
                    beats={songData!.segments}
                    currentBeat={currentBeat}
                    onSeek={handleSeek}
                  />
                ) : (
                  <div aria-hidden="true">
                    <div className="flex h-[88px] items-center gap-[2px]">
                      {Array.from({ length: 48 }, (_, i) => (
                        <div
                          key={i}
                          className="min-w-[1px] flex-1 animate-pulse rounded-sm bg-surface-container-highest"
                          style={{ height: `${20 + 55 * Math.abs(Math.sin(i * 1.7))}%` }}
                        />
                      ))}
                    </div>
                    <div className="mt-3.5 h-[22px] animate-pulse rounded bg-surface-container-highest/60" />
                  </div>
                )}
              </div>

              {/* Status strip */}
              <div className="mt-4 flex h-5 items-center gap-2.5 text-[13px] text-on-surface-variant">
                {loadingLibrarySong ? (
                  <>
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-on-surface-variant/30 border-t-on-surface-variant" />
                    Loading: {selectedSongName}&hellip;
                  </>
                ) : currentBeat && isPlayerReady ? (
                  <>
                    {isPlaying && <span className="live-dot" aria-hidden="true" />}
                    {isPlaying
                      ? `Remixing — beat ${currentBeat.id} · cluster ${currentBeat.cluster} · jump ${totalJumps} of ∞`
                      : `Paused — beat ${currentBeat.id} · cluster ${currentBeat.cluster}`}
                  </>
                ) : (
                  'Select a song from the library to begin'
                )}
              </div>

              <PlaybackControls
                isPlaying={isPlaying}
                isPlaybackPending={!isPlayerReady || isPlaybackPending}
                jumpProbability={jumpProbability}
                currentBeatId={currentBeat?.id ?? null}
                onPlayPause={handlePlayPause}
                onRestart={handleRestart}
                onJumpProbabilityChange={handleJumpProbabilityChange}
              />
            </div>

            <aside className="min-w-0 self-start">
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

        {/* MD3 primary tabs (§5.3) with sliding gold indicator */}
        <nav aria-label="Sections" className="relative mx-1 flex border-b border-outline-variant/60" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              ref={(el) => { tabRefs.current[tab.id] = el; }}
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`h-12 flex-1 px-3 text-sm font-semibold transition-colors duration-200 sm:flex-none sm:px-5 ${
                activeTab === tab.id
                  ? 'text-gold-foreground'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {tab.label}
            </button>
          ))}
          {indicator && (
            <span
              className="tab-indicator"
              style={{ left: indicator.left, width: indicator.width }}
              aria-hidden="true"
            />
          )}
        </nav>

        {/* Loading-song state: thin gold linear progress under the tab bar (§5.3) */}
        {loadingLibrarySong && (
          <div className="loading-bar mx-1" role="progressbar" aria-label={`Loading song: ${selectedSongName}`} />
        )}

        <section className="mt-4 rounded-[20px] border border-outline-variant/45 bg-surface-container-low p-2.5 sm:p-3">
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
              selectedSongId={selectedSongId}
            />
          )}

          {activeTab === 'search' && (
            <SongSearch onSongSelect={handleSongSelect} selectedSongId={selectedSongId} />
          )}

          {activeTab === 'upload' && (
            <div>
              <div className="px-3 pb-2 pt-2 text-[13px] font-semibold uppercase tracking-[0.04em] text-on-surface-variant">Upload New Song</div>
              <div className="px-3 pb-3">
                <FileUpload onUploadSuccess={handleUploadSuccess} onUploadError={handleUploadError} />
              </div>
            </div>
          )}

          {error && (
            <div role="alert" className="banner-error mx-3 my-3">
              {error}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
