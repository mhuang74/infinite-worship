'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import api from '@/lib/api';
import FileUpload from '@/components/FileUpload';
import Header from '@/components/Header';
import PlaybackControls from '@/components/PlaybackControls';
import ZenMode from '@/components/ZenMode';
import Visualization from '@/components/Visualization';
import SongMetadata from '@/components/SongMetadata';
import SongLibrary from '@/components/SongLibrary';
import CatalogBrowse from '@/components/CatalogBrowse';
import type { CatalogSong } from '@/components/CatalogBrowse';
import { AudioEngine, createAudioBuffer } from '@/lib/audio';
import { loadSongForPlayback } from '@/lib/player';
import type { LyricLine } from '@/lib/lrc';
import { importSong, isPlayable, removeSong } from '@/lib/upload';
import { formatClock } from '@/lib/format';
import type { Beat, Song, JumpEvent } from '@/lib/types';

const TABS = [
  { id: 'library', label: 'Song Library' },
  { id: 'upload', label: 'Upload New Song' },
  { id: 'catalog', label: 'Catalog' },
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
  useEffect(() => {
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
  // Library filter text; lives here so switching tabs and back keeps it.
  const [libraryFilter, setLibraryFilter] = useState('');
  // Catalog tab visibility (issue #58): the browse BFF route reports the
  // server-side SOW_CATALOG_ENABLED flag per request; when off no Catalog tab
  // renders and the app is exactly today's. The tab list filters on it below.
  // Fired only AFTER the first Library load resolves (issue #63): on a
  // cookie-less first visit the parallel mount fetches would each hit the
  // mint path; sequencing keeps /api/songs as the identity-establishing
  // request (its Set-Cookie is in the jar before anything else calls the
  // BFF).
  const [catalogEnabled, setCatalogEnabled] = useState(false);
  const [libraryLoadedOnce, setLibraryLoadedOnce] = useState(false);
  useEffect(() => {
    if (!libraryLoadedOnce) return;
    let cancelled = false;
    api
      .get('/api/catalog')
      .then((response) => {
        if (!cancelled) setCatalogEnabled(Boolean(response.data.enabled));
      })
      .catch((err) => {
        // Route failure (e.g. cold start): keep the tab hidden; the flag is
        // re-checked on the next full page load.
        console.error('Catalog flag check failed:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [libraryLoadedOnce]);
  const visibleTabs = TABS.filter((tab) => tab.id !== 'catalog' || catalogEnabled);
  const [shouldAutoplay, setShouldAutoplay] = useState(false);
  const [totalJumps, setTotalJumps] = useState(0);
  const [totalPlayingTimeSec, setTotalPlayingTimeSec] = useState(0);
  // Zen mode (issues #38–#42): fullscreen overlay over this page. The Engine
  // is NOT torn down across the transition — statistics keep accumulating.
  const [zenActive, setZenActive] = useState(false);
  // Widened jump events (issue #39): kept for the zen arc drawing; the
  // existing counter derives from jump.count as before.
  const [jumpEvents, setJumpEvents] = useState<JumpEvent[]>([]);
  // Jump epoch: the engine restarts its count (count=0 event) on Restart and
  // when an audio file reloads in place — the new count re-uses old values.
  // Zen arc stamps are keyed by (epoch, count) so a restarted engine's jumps
  // freshen correctly (review finding).
  const jumpEpochRef = useRef(0);
  const [jumpEpoch, setJumpEpoch] = useState(0);
  // Per-beat playback tallies (beat.id → play count): drives growth ribs +
  // cap pulses in zen mode. Reset on new-song load, kept across Restart.
  const [beatPlayCounts, setBeatPlayCounts] = useState<Map<number, number>>(new Map());
  // Timed lyric lines of the loaded Song (issue #60): imports only; null when
  // the Song has no LRC or it failed the ≥2-line validity bar. Kept beside
  // songData so a song switch replaces (or clears) them atomically.
  const [lyrics, setLyrics] = useState<LyricLine[] | null>(null);

  const [pollingSongId, setPollingSongId] = useState<string | null>(null);
  // Catalog card whose import POST is in flight (CTA spinner, #59).
  const [importingHash, setImportingHash] = useState<string | null>(null);
  // Library row whose removal is in flight (issue #63); row button disabled
  // until the entry delete resolves.
  const [removingSongId, setRemovingSongId] = useState<string | null>(null);

  // Song id whose Analysis + audio are already loaded into the player, so a
  // library refresh does not refetch them (they are immutable once ready).
  const loadedSongIdRef = useRef<string | null>(null);
  // Consecutive polls that did not see the polling target; a few misses mean
  // the Song vanished from the library and polling should give up.
  const pollMissesRef = useRef(0);

  const selectedSongIdRef = useRef<string | null>(null);

  const loadSongs = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    try {
      if (!silent) {
        setLibraryLoading(true);
      }
      setLibraryError(null);

      const response = await api.get('/api/songs');
      const fetchedSongs: Song[] = response.data.songs || [];
      setSongs(fetchedSongs);
      setLibraryLoadedOnce(true);

      if (selectedSongIdRef.current) {
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
    setJumpEvents([]);
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
          // Legacy Safari exposes webkitAudioContext, which the DOM types
          // lack — one unchecked widening of `window`, then plain access.
          const win = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
          const AudioContextCtor = win.AudioContext ?? win.webkitAudioContext;
          if (!AudioContextCtor) {
            setError('Web Audio API is not available in this browser.');
            return;
          }
          audioContextRef.current = new AudioContextCtor();
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
            // One tally per scheduled beat — the engine's onBeatChange fires
            // exactly once per audible playback (seek/crossfade paths included),
            // which is the "played back several times" semantics growth ribs
            // need. State copy per tick (≤N entries at ~2-4Hz) is acceptable
            // for repaint driving; the Map is small and immutable thereafter.
            setBeatPlayCounts((prev) => {
              const next = new Map(prev);
              next.set(beat.id, (next.get(beat.id) ?? 0) + 1);
              return next;
            });
          };

          const onJump = (jump: JumpEvent) => {
            setTotalJumps(jump.count);
            // Count 0: the engine reset its counter (Restart / audio reload).
            // A NEW jump list generation begins — trim stale events for zen
            // and bump the stamp epoch so restarted counts draw fresh arcs.
            if (jump.count === 0) {
              jumpEpochRef.current += 1;
              setJumpEpoch(jumpEpochRef.current);
              setJumpEvents([]);
              return;
            }
            // Widened event (issue #39): retain the pair for zen arc drawing.
            // Zen only needs ~1s of arc life; keep a small bounded tail so a
            // long session never accumulates thousands of events (review).
            setJumpEvents((prev) => [...prev.slice(-7), jump]);
          };

          const onPlaybackStarted = () => {
            setIsPlaying(true);
            setIsPlaybackPending(false);
          };

          // Lyrics are an immutable engine input (issue #69): known before the
          // engine exists (the loader sets them in the same batched update as
          // songData/audioFile, so this effect's closure already has the value
          // belonging to the loaded Song) — no setter.
          audioEngineRef.current = new AudioEngine(audioContextRef.current, audioBuffer, songData.segments, onBeatChange, onJump, onPlaybackStarted, lyrics);

          // Set initial state
          setCurrentBeat(songData.segments[0]);
          setIsPlaying(shouldAutoplay);
          setIsPlaybackPending(shouldAutoplay);

          // Auto-play if flagged
          if (shouldAutoplay) {
            // The engine effect runs outside the click gesture that selected
            // the song (fetch + decode intervene), so the context may still
            // be suspended; resume() from within the click-initiated task
            // chain lets the first play produce sound.
            await audioContextRef.current.resume();
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
  }, [audioFile, songData, lyrics]);

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
        setLyrics(null);
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
        // New song ⇒ fresh play counts (growth ribs restart; Restart keeps them).
        setBeatPlayCounts(new Map());
        // Update state with the fetched data
        setSongData({ segments: loaded.beats });
        setAudioFile(loaded.audioFile);
        setLyrics(loaded.lyrics);
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
      // Browsers suspend a freshly created AudioContext until a user gesture
      // touches it; resume() here makes the first click produce sound.
      void audioContextRef.current?.resume();
      setIsPlaybackPending(true);
      audioEngineRef.current.play();
    }
  }, [isPlaying]);

  // Zen mode double-tap-on-tile: route the tapped beat to the engine's real
  // jump path (onJump → arcs + counter). No-op while paused (engine guards).
  const handleZenJumpToBeat = useCallback((beat: Beat) => {
    audioEngineRef.current?.jumpToBeat(beat);
  }, []);

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
    loadSongs();
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

  // Catalog import (map #48, ticket #59): POST /api/catalog/import with the
  // card's content hash — the BFF copies audio + LRC, inserts the row
  // (pending, or ready via the dedupe fast path), and enqueues analysis.
  // On accepted/pending, poll the library until the Imported Song reaches a
  // terminal status (same loop as the upload flow); the returned status
  // already covers instant-ready (200) and existing-row (200) cases.
  const handleCatalogImport = useCallback(
    async (catalogSong: CatalogSong) => {
      setError('');
      setImportingHash(catalogSong.content_hash);
      try {
        const result = await importSong(catalogSong.content_hash);
        if (result.status === 'pending') {
          selectedSongIdRef.current = null;
          setSelectedSongId(null);
          setSelectedSongName(null);
          setPollingSongId(result.song_id);
        }
        // Refresh on every outcome: 200 ready adds the playable row, but a
        // 200 failed must also re-render the card as the failed chip with
        // its failure_reason (#53) — the row is the state surface.
        await loadSongs({ silent: true });
      } catch (err) {
        console.error('Catalog import failed:', err);
        setError(err instanceof Error ? err.message : 'Catalog import failed');
      } finally {
        setImportingHash(null);
      }
    },
    [loadSongs],
  );

  // Library removal (issue #63): delete the Library entry only — the Song
  // row stays (invisible infrastructure). If the removed Song is the one
  // playing, stop playback and clear the player: nothing keeps playing from
  // a Library the user just removed it from. Catalog cards for imports flip
  // back to "Add to Library" on the next loadSongs() since the entry is the
  // join key (CatalogBrowse joins against the library list).
  const handleRemoveSong = useCallback(
    async (songId: string) => {
      setError('');
      setRemovingSongId(songId);
      try {
        await removeSong(songId);
        if (selectedSongIdRef.current === songId) {
          selectedSongIdRef.current = null;
          setSelectedSongId(null);
          setSelectedSongName(null);
          audioEngineRef.current?.stop();
          audioEngineRef.current = null;
          loadedSongIdRef.current = null;
          setSongData(null);
          setAudioFile(null);
          setLyrics(null);
          setCurrentBeat(null);
          setIsPlaying(false);
          setIsPlaybackPending(false);
        }
        setSongs((prev) => prev.filter((s) => s.song_id !== songId));
      } catch (err) {
        console.error('Library removal failed:', err);
        setError(err instanceof Error ? err.message : 'Failed to remove song');
      } finally {
        setRemovingSongId(null);
      }
    },
    [],
  );

  const handlePlayRandom = useCallback(() => {
    const playable = songs.filter((s) => s.status === 'ready');
    if (playable.length === 0) {
      setError('No ready songs to play yet — upload one or check back soon.');
      return;
    }
    const song = playable[Math.floor(Math.random() * playable.length)];
    handleSongSelect(song.song_id, song.title);
  }, [songs]);

  return (
    <main className="min-h-screen w-full px-4 py-8 hero:py-12">
      {/* relative: content stacks above the fixed body::before page glows */}
      <div className="relative mx-auto w-full max-w-[1080px] space-y-6 hero:space-y-8">
        <Header />

        {/* Hero now-playing card (spec §5.2) */}
        <section className="rounded-[28px] border border-outline-variant/55 bg-surface-container-low p-5 shadow-[0_1px_2px_rgba(0,0,0,0.3),0_4px_16px_rgba(0,0,0,0.18)] hero:p-7">
          <div className="grid grid-cols-1 gap-7 hero:grid-cols-[1fr_300px]">
            <div className="min-w-0">
              <h2 className="type-display">
                {selectedSongName ?? (
                  <>
                    {'No song selected '}
                    <button
                      type="button"
                      onClick={handlePlayRandom}
                      className="text-gold-foreground underline decoration-2 underline-offset-4"
                    >
                      Let it flow
                    </button>
                  </>
                )}
              </h2>
              <p className="mb-5 mt-1.5 text-[13px] text-on-surface-variant">
                {songData
                  ? `${formatClock(audioEngineRef.current ? audioEngineRef.current.getDuration() : null)} · ${songData.segments.length} beats · ${totalJumpPoints ?? 0} jump points`
                  : 'Pick a song from the library below'}
              </p>

              {/* Screen inset: waveform + jewel beat-cluster bar */}
              <div className="rounded-2xl border border-outline-variant/45 bg-surface-container-lowest p-4 hero:px-5">
                {songData && audioFile ? (
                  <Visualization
                    audioFile={audioFile}
                    beats={songData.segments}
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
                isPlaybackPending={isPlaybackPending}
                jumpProbability={jumpProbability}
                currentBeatId={currentBeat?.id ?? null}
                onPlayPause={handlePlayPause}
                onRestart={handleRestart}
                onJumpProbabilityChange={handleJumpProbabilityChange}
                onEnterZen={() => setZenActive(true)}
                zenAvailable={isPlaying}
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
        <div aria-label="Sections" className="relative mx-1 flex border-b border-outline-variant/60" role="tablist">
          {visibleTabs.map((tab) => (
            <button
              type="button"
              key={tab.id}
              ref={(el) => { tabRefs.current[tab.id] = el; }}
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`h-12 flex-1 px-2.5 text-[13px] font-semibold transition-colors duration-200 hero:flex-none hero:px-5 hero:text-sm ${
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
        </div>

        {/* Loading-song state: thin gold linear progress under the tab bar (§5.3) */}
        {loadingLibrarySong && (
          <div className="loading-bar mx-1" role="progressbar" aria-label={`Loading song: ${selectedSongName}`} />
        )}

        <section className="mt-4 rounded-[20px] border border-outline-variant/45 bg-surface-container-low p-2.5 hero:p-3">
          {activeTab === 'library' && (
            <SongLibrary
              onSongSelect={handleSongSelect}
              onRemove={(songId) => {
                void handleRemoveSong(songId);
              }}
              removingSongId={removingSongId}
              songs={songs}
              loading={libraryLoading}
              error={libraryError}
              onRefresh={() => {
                void loadSongs();
              }}
              refreshing={libraryLoading}
              selectedSongId={selectedSongId}
              filter={libraryFilter}
              onFilterChange={setLibraryFilter}
            />
          )}

          {activeTab === 'catalog' && (
            <CatalogBrowse
              songs={songs}
              selectedSongId={selectedSongId}
              loadingSong={loadingLibrarySong}
              importingHash={importingHash}
              onPlayImported={(song) => handleSongSelect(song.song_id, song.title)}
              onImport={(song) => {
                void handleCatalogImport(song);
              }}
            />
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
            <div role="alert" className="banner-error mx-3 my-3 flex items-center justify-between gap-3">
              <span>{error}</span>
              <button
                type="button"
                aria-label="Dismiss error"
                onClick={() => setError('')}
                className="flex h-11 w-11 shrink-0 place-items-center rounded-full text-on-surface-variant transition-colors hover:text-on-surface"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                </svg>
              </button>
            </div>
          )}
        </section>
      </div>

      {/* Zen mode overlay (issues #38–#42): renders above everything; the
          engine is untouched, so audio + stats continue across entry/exit. */}
      {zenActive && songData && (
        <ZenMode
          beats={songData.segments}
          currentBeat={currentBeat}
          jumps={jumpEvents}
          jumpEpoch={jumpEpoch}
          beatPlayCounts={beatPlayCounts}
          lyrics={lyrics}
          isPlaying={isPlaying}
          onTogglePlayback={handlePlayPause}
          onJumpToBeat={handleZenJumpToBeat}
          onExit={() => setZenActive(false)}
        />
      )}
    </main>
  );
}
