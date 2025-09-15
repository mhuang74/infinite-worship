'use client';

import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { debounce } from 'lodash';

interface Song {
  song_id: string;
  original_filename: string;
  duration: number;
  tempo: number;
  beats: number;
  jump_points: number;
}

interface SongSearchProps {
  onSongSelect: (songId: string, filename: string) => void;
}

const SongSearch: React.FC<SongSearchProps> = ({ onSongSelect }) => {
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
        const response = await axios.get(`http://localhost:5555/songs/search?q=${encodeURIComponent(searchQuery)}`);
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
        <p className="mt-3 text-white/70 text-sm">No songs found matching "{query}"</p>
      )}
      
      {results.length > 0 && (
        <div className="mt-3 space-y-2 max-h-[300px] overflow-y-auto pr-2">
          {results.map((song) => (
            <div 
              key={song.song_id}
              onClick={() => onSongSelect(song.song_id, song.original_filename)}
              className="flex items-center justify-between p-2 rounded-md bg-white/5 hover:bg-white/10 cursor-pointer transition-colors"
            >
              <div className="flex-1 truncate">
                <div className="font-medium text-white truncate">{song.original_filename}</div>
                <div className="text-xs text-white/60 flex space-x-2">
                  <span>{formatDuration(song.duration)}</span>
                  <span>•</span>
                  <span>{song.tempo.toFixed(1)} BPM</span>
                  <span>•</span>
                  <span>{song.beats} beats</span>
                  {song.jump_points && (
                    <>
                      <span>•</span>
                      <span>{song.jump_points} jump points</span>
                    </>
                  )}
                </div>
              </div>
              <button className="ml-2 px-2 py-1 text-xs bg-blue-500/30 hover:bg-blue-500/50 rounded text-white">
                Select
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SongSearch;