'use client';

import React from 'react';

interface SongMetadataProps {
  songData: any;
  audioFile: File | null;
}

const SongMetadata: React.FC<SongMetadataProps> = ({ songData, audioFile }) => {
  if (!songData || !audioFile) return null;

  const segments = songData.segments || [];
  const totalDuration = segments.length > 0 ? segments[segments.length - 1].start + segments[segments.length - 1].duration : 0;

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const uniqueClusters = new Set(segments.map((s: any) => s.cluster)).size;
  const bpm = songData.bpm || 'N/A';

  return (
    <div className="p-4 bg-white text-navy rounded-lg shadow-md border border-gold">
      <h3 className="text-lg font-bold mb-2 text-gold">Song Metadata</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div><strong>Name:</strong> {audioFile.name}</div>
        <div><strong>Duration:</strong> {formatDuration(totalDuration)}</div>
        <div><strong>BPM:</strong> {bpm}</div>
        <div><strong>Beats:</strong> {segments.length}</div>
        <div><strong>Clusters:</strong> {uniqueClusters}</div>
        <div><strong>Segments:</strong> {segments.length}</div>
      </div>
    </div>
  );
};

export default SongMetadata;