'use client';

import React from 'react';
import StatusChip from '@/components/StatusChip';
import { formatClock } from '@/lib/format';
import type { Song } from '@/lib/types';

interface SongLibraryProps {
  onSongSelect: (songId: string, title: string) => void;
  songs: Song[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  refreshing: boolean;
  selectedSongId?: string | null;
}

const SongLibrary: React.FC<SongLibraryProps> = ({
  onSongSelect,
  songs,
  loading,
  error,
  onRefresh,
  refreshing,
  selectedSongId = null,
}) => {
  const showInitialLoading = loading && songs.length === 0;
  const showRefreshing = refreshing && songs.length > 0;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-2">
        <div className="text-[13px] font-semibold uppercase tracking-[0.04em] text-on-surface-variant">Song Library</div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          title="Refresh song list"
          className="grid h-9 w-9 place-items-center rounded-full text-on-surface-variant transition-colors duration-200 hover:bg-gold-foreground/10 hover:text-gold-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="sr-only">Refresh song library</span>
          <svg
            aria-hidden="true"
            className={`h-[18px] w-[18px] ${refreshing ? 'animate-spin' : ''}`}
            viewBox="0 0 24 24"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M17.65 6.35A8 8 0 1 0 19.73 14h-2.08a6 6 0 1 1-1.41-6.24L13 11h7V4l-2.35 2.35z" />
          </svg>
        </button>
      </div>

      {showInitialLoading && (
        <p className="px-3 py-2 text-sm text-on-surface-variant">Loading song library...</p>
      )}

      {!showInitialLoading && showRefreshing && (
        <p className="px-3 py-1 text-xs text-on-surface-variant">Refreshing song library...</p>
      )}

      {error && (
        <div className="banner-error mx-3 mt-2" role="alert">
          {error}
        </div>
      )}

      {!showInitialLoading && songs.length === 0 && !error && (
        <p className="px-3 py-2 text-sm text-on-surface-variant">No songs in library. Upload a song first.</p>
      )}

      {songs.length > 0 && (
        <div className="mt-1 max-h-[300px] space-y-1 overflow-y-auto p-1">
          {songs.map((song) => {
            const failed = song.status === 'failed';
            const selected = song.song_id === selectedSongId;
            const hasMeta = song.duration !== null || (failed && song.failure_reason);

            return (
              <button
                type="button"
                key={song.song_id}
                onClick={() => onSongSelect(song.song_id, song.title)}
                title={failed && song.failure_reason ? `Analysis failed: ${song.failure_reason}` : undefined}
                aria-current={selected ? 'true' : undefined}
                className={`flex w-full items-center justify-between gap-4 rounded-[14px] px-3 py-3 text-left transition-colors duration-150 ${
                  selected
                    ? 'bg-primary/[0.14] hover:bg-primary/[0.18]'
                    : 'hover:bg-on-surface/[0.06]'
                }`}
              >
                <div className="min-w-0">
                  <div className={`truncate text-[14.5px] font-medium ${selected ? 'font-semibold text-primary' : 'text-on-surface'}`}>
                    {song.title}
                  </div>
                  {hasMeta && (
                    <div className="mt-0.5 truncate text-xs text-on-surface-variant">
                      {song.duration !== null && formatClock(song.duration)}
                      {failed && song.failure_reason && (
                        <span className="text-error">
                          {song.duration !== null ? ' · ' : ''}
                          {song.failure_reason}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <StatusChip status={song.status} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SongLibrary;
