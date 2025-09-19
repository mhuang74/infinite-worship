'use client';

import React, { useState, useEffect } from 'react';
import axios from 'axios';

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
}

const SongLibrary: React.FC<SongLibraryProps> = ({ onSongSelect }) => {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSongs = async () => {
      try {
        setLoading(true);
        const response = await axios.get('http://localhost:5001/songs');
        setSongs(response.data.songs || []);
        setError(null);
      } catch (err) {
        console.error('Error fetching songs:', err);
        setError('Failed to load song library. Is the server running?');
      } finally {
        setLoading(false);
      }
    };

    fetchSongs();
  }, []);

  const formatDuration = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="cdpanel-inner p-4 sm:p-6">
      <div className="engraved-label mb-2">Song Library</div>
      
      {loading && <p className="text-white/70 text-sm">Loading song library...</p>}
      
      {error && (
        <div className="mt-3 rounded-md border border-red-400/40 bg-red-500/20 text-white px-3 py-2 text-sm">
          {error}
        </div>
      )}
      
      {!loading && songs.length === 0 && !error && (
        <p className="text-white/70 text-sm">No songs in library. Upload a song first.</p>
      )}
      
      {songs.length > 0 && (
        <div className="mt-3 space-y-2 max-h-[300px] overflow-y-auto pr-2">
          {songs.map((song) => (
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

export default SongLibrary;