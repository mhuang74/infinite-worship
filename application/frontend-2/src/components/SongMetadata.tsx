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
    {
      label: 'Song Title',
      value: getSongName(songData.filename),
      icon: (
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
        </svg>
      )
    },
    {
      label: 'Duration',
      value: formatDuration(songData.duration),
      icon: (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    },
    {
      label: 'Tempo (BPM)',
      value: Math.round(songData.tempo),
      icon: (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      )
    },
    {
      label: 'Clusters',
      value: songData.clusters,
      icon: (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      )
    },
    {
      label: 'Segments',
      value: songData.segments.length,
      icon: (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      )
    },
  ];

  return (
    <div className="space-y-4">
      
      {/* Header Section */}
      <div className="flex items-center mb-6">
        <div className="w-4 h-4 bg-church-gold-400 rounded-full mr-3 animate-vintage-glow"></div>
        <h2 className="text-xl font-bold text-church-gold-400 font-vintage uppercase tracking-wider">
          Song Information
        </h2>
        <div className="flex-1 ml-4 h-px bg-church-gold-400/30"></div>
      </div>

      {/* Metadata Display Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {metadata.map((item, index) => (
          <div
            key={index}
            className="bg-vintage-silver-900/80 rounded-vintage border border-church-gold-400/20 p-4 hover:border-church-gold-400/40 transition-all duration-200 shadow-vintage-inset group"
          >
            <div className="flex items-start space-x-3">
              
              {/* Icon */}
              <div className="flex-shrink-0 w-6 h-6 bg-church-navy-800 rounded-vintage flex items-center justify-center shadow-vintage-inset group-hover:bg-church-navy-700 transition-colors duration-200">
                <div className="text-church-gold-400 group-hover:text-church-gold-300 transition-colors duration-200">
                  {item.icon}
                </div>
              </div>
              
              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="text-church-gold-400 text-xs font-vintage font-medium uppercase tracking-widest mb-1">
                  {item.label}
                </div>
                <div className="text-white text-lg font-vintage font-bold break-all">
                  {item.value}
                </div>
              </div>
            </div>

            {/* Decorative Element */}
            <div className="mt-3 h-px bg-gradient-to-r from-church-gold-400/0 via-church-gold-400/30 to-church-gold-400/0"></div>
          </div>
        ))}
      </div>

      {/* Additional Technical Info */}
      <div className="mt-6 bg-church-navy-900/50 rounded-vintage p-4 border border-church-gold-400/10">
        <div className="flex items-center justify-between text-xs font-vintage text-church-gold-400/70 uppercase tracking-wider">
          <div>
            File: {songData.filename.split('/').pop()?.split('.').pop()?.toUpperCase()} Format
          </div>
          <div>
            Analysis Complete
          </div>
          <div className="flex items-center space-x-1">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <span>Ready</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SongMetadata;
