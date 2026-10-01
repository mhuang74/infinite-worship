'use client';

import React, { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { debounce } from 'lodash';
import type { Song } from '@/lib/types';

interface SongSearchProps {
  onSongSelect: (songId: string, filename: string) => void;
}

const SongSearch: React.FC<SongSearchProps> = ({ onSongSelect }) => {
  const statusBadgeClasses: Record<string, string> = {
    pending: 'border-yellow-300/40 bg-yellow-300/10 text-yellow-300',
    processing: 'border-blue-300/40 bg-blue-300/10 text-blue-300',
    ready: 'border-green-400/40 bg-green-400/10 text-green-400',
    failed: 'border-red-400/40 bg-red-400/10 text-red-400',
  };

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
        const response = await api.get(`/songs/search?q=${encodeURIComponent(searchQuery)}`);
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

  const formatDuration = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="cdpanel-inner p-4 sm:p-6">
      <div className="engraved-label mb-2">Search Songs</div>
      
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type to search songs..."
          className="w-full p-2 bg-black/30 border border-white/20 rounded-md text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        {loading && (
          <div className="absolute right-3 top-2.5">
            <div className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full"></div>
          </div>
        )}
      </div>
      
      {error && (
        <div className="mt-3 rounded-md border border-red-400/40 bg-red-500/20 text-white px-3 py-2 text-sm">
          {error}
        </div>
      )}
      
      {query.trim() !== '' && results.length === 0 && !loading && !error && (
        <p className="mt-3 text-white/70 text-sm">No songs found matching &quot;{query}&quot;</p>
      )}
      
      {results.length > 0 && (
        <div className="mt-4 max-h-[300px] space-y-3 overflow-y-auto pr-2">
          {results.map((song) => {
            return (
              <div
                key={song.song_id}
                onClick={() => onSongSelect(song.song_id, song.title)}
                className="group flex items-center gap-3 rounded-md bg-white/5 px-3 py-2 transition-colors duration-150 hover:bg-white/10 cursor-pointer"
              >
                <span className="truncate text-sm font-semibold text-gold-400">
                  {song.title}
                </span>
                <span className="ml-auto flex-shrink-0 whitespace-nowrap text-xs text-white/60">
                  {song.duration !== null ? formatDuration(song.duration) : null}
                </span>
                <span
                  className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadgeClasses[song.status] ?? 'border-white/30 bg-white/10 text-white/60'}`}
                >
                  {song.status}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SongSearch;