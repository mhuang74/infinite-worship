'use client';

import React, { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { debounce } from 'lodash';
import StatusChip from '@/components/StatusChip';
import type { Song } from '@/lib/types';

interface SongSearchProps {
  onSongSelect: (songId: string, filename: string) => void;
  selectedSongId?: string | null;
}

const formatDuration = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

const SongSearch: React.FC<SongSearchProps> = ({ onSongSelect, selectedSongId = null }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Song[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounced search function to avoid too many API calls
  const debouncedSearch = useCallback(
    debounce(async (searchQuery: string) => {
      if (!searchQuery.trim()) {
        setResults([]);
        return;
      }

      try {
        setLoading(true);
        const response = await api.get(`/api/songs/search?q=${encodeURIComponent(searchQuery)}`);
        setResults(response.data.songs || []);
        setError(null);
      } catch (err) {
        console.error('Error searching songs:', err);
        setError('Failed to search songs. Is the server running?');
      } finally {
        setLoading(false);
      }
    }, 300),
    []
  );

  useEffect(() => {
    debouncedSearch(query);

    // Cleanup function to cancel any pending debounced calls
    return () => {
      debouncedSearch.cancel();
    };
  }, [query, debouncedSearch]);

  return (
    <div>
      <div className="px-3 pb-2 pt-2 text-[13px] font-semibold uppercase tracking-[0.04em] text-on-surface-variant">Search Songs</div>

      <div className="relative px-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type to search songs..."
          className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3.5 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/70 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-gold-foreground"
        />
        {loading && (
          <div className="absolute right-6 top-2.5">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-on-surface-variant/30 border-t-on-surface-variant"></div>
          </div>
        )}
      </div>

      {error && (
        <div className="banner-error mx-3 mt-3" role="alert">
          {error}
        </div>
      )}

      {query.trim() !== '' && results.length === 0 && !loading && !error && (
        <p className="mt-3 px-3 text-sm text-on-surface-variant">No songs found matching &quot;{query}&quot;</p>
      )}

      {results.length > 0 && (
        <div className="mt-3 max-h-[300px] space-y-1 overflow-y-auto p-1">
          {results.map((song) => {
            const selected = song.song_id === selectedSongId;
            return (
              <button
                type="button"
                key={song.song_id}
                onClick={() => onSongSelect(song.song_id, song.title)}
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
                  {song.duration !== null && (
                    <div className="mt-0.5 text-xs text-on-surface-variant">{formatDuration(song.duration)}</div>
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

export default SongSearch;
