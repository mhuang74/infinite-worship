'use client';

import React from 'react';

interface SongMetadataProps {
  songData: {
    filename: string;
    duration: number;
    tempo: number;
    clusters: number;
    segments: any[];
  };
}

const SongMetadata: React.FC<SongMetadataProps> = ({ songData }) => {
  // Extract song name from filename (remove path and extension)
  const getSongName = (filename: string) => {
    const nameWithExt = filename.split('/').pop() || filename;
    return nameWithExt.replace(/\.[^/.]+$/, '');
  };

  const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const metadata = [
    { label: 'Song Name', value: getSongName(songData.filename) },
    { label: 'Duration', value: formatDuration(songData.duration) },
    { label: 'BPM', value: Math.round(songData.tempo) },
    { label: 'Clusters', value: songData.clusters },
    { label: 'Segments', value: songData.segments.length },
  ];

  return (
    <div className="bg-slate-700/50 rounded-xl p-6 border border-purple-500/20">
      <h2 className="text-2xl font-bold text-white mb-6 flex items-center">
        <svg className="w-6 h-6 mr-3 text-purple-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        Song Metadata
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {metadata.map((item, index) => (
          <div key={index} className="bg-slate-600/50 rounded-lg p-4 border border-purple-500/10 hover:border-purple-500/30 transition-colors duration-200">
            <div className="text-purple-300 text-sm font-medium uppercase tracking-wide mb-1">
              {item.label}
            </div>
            <div className="text-white text-lg font-semibold">
              {item.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SongMetadata;
