'use client';

import React from 'react';

interface Song {
  song_id: string;
  original_filename: string;
  duration: number;
  tempo: number;
  beats: number;
  jump_points: number;
}

interface SongLibraryProps {
  onSongSelect: (songId: string, filename: string) => void;
  songs: Song[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  refreshing: boolean;
}

const SongLibrary: React.FC<SongLibraryProps> = ({
  onSongSelect,
  songs,
  loading,
  error,
  onRefresh,
  refreshing,
}) => {
  const formatDuration = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const refreshIconClasses = refreshing
    ? 'h-4 w-4 text-gold-400 animate-spin'
    : 'h-4 w-4 text-white/80 group-hover:text-gold-400';

  const showInitialLoading = loading && songs.length === 0;
  const showRefreshing = refreshing && songs.length > 0;

  return (
    <div className="cdpanel-inner p-4 sm:p-6">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="engraved-label">Song Library</div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          title="Refresh song list"
          className="group inline-flex h-8 w-8 items-center justify-center rounded-full text-white/80 transition-colors duration-200 hover:text-gold-400 focus:outline-none focus:ring-2 focus:ring-gold-500/50 disabled:cursor-not-allowed disabled:text-white/40"
        >
          <span className="sr-only">Refresh song library</span>
          <svg
            className={refreshIconClasses}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 12a9 9 0 0 1 15.54-5.64L21 9" />
            <path d="M21 4v5h-5" />
          </svg>
        </button>
      </div>

      {showInitialLoading && (
        <p className="text-white/70 text-sm">Loading song library...</p>
      )}

      {!showInitialLoading && showRefreshing && (
        <p className="text-white/60 text-xs">Refreshing song library...</p>
      )}

      {error && (
        <div className="mt-3 rounded-md border border-red-400/40 bg-red-500/20 text-white px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {!showInitialLoading && songs.length === 0 && !error && (
        <p className="text-white/70 text-sm">No songs in library. Upload a song first.</p>
      )}

      {songs.length > 0 && (
        <div className="mt-4 max-h-[300px] space-y-3 overflow-y-auto pr-2">
          {songs.map((song) => {
            const metadata = `${formatDuration(song.duration)} • ${Math.round(
              song.tempo,
            )} BPM • Jumps ${song.jump_points ?? 0}`;

            return (
              <div
                key={song.song_id}
                onClick={() => onSongSelect(song.song_id, song.original_filename)}
                className="group flex items-center gap-3 rounded-md bg-white/5 px-3 py-2 transition-colors duration-150 hover:bg-white/10 cursor-pointer"
              >
                <span className="truncate text-sm font-semibold text-gold-400">
                  {song.original_filename}
                </span>
                <span className="ml-auto flex-shrink-0 whitespace-nowrap text-xs text-white/60">
                  {metadata}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SongLibrary;
