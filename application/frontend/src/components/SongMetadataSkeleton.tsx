'use client';

import React from 'react';

const MetaRowSkeleton: React.FC = () => (
  <div className="flex items-center justify-between py-2 border-b border-white/10 last:border-b-0">
    <div className="h-4 bg-white/10 rounded animate-pulse w-20"></div>
    <div className="h-4 bg-white/20 rounded animate-pulse w-16"></div>
  </div>
);

const SongMetadataSkeleton: React.FC = () => {
  return (
    <section className="cdpanel-inner p-4 sm:p-6">
      <header className="mb-4">
        <div className="h-5 bg-white/10 rounded animate-pulse w-24 mb-1"></div>
        <div className="h-3 bg-white/5 rounded animate-pulse w-48"></div>
      </header>
      <div className="space-y-1">
        <MetaRowSkeleton />
        <MetaRowSkeleton />
        <MetaRowSkeleton />
        <MetaRowSkeleton />
        <MetaRowSkeleton />
        <MetaRowSkeleton />
        <MetaRowSkeleton />
        <MetaRowSkeleton />
      </div>
    </section>
  );
};

export default SongMetadataSkeleton;
