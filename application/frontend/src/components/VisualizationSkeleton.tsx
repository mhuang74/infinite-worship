'use client';

import React from 'react';

const VisualizationSkeleton: React.FC = () => {
  return (
    <div className="p-4 sm:p-6 device-screen">
      {/* Waveform skeleton */}
      <div className="relative">
        <div className="h-[88px] bg-white/10 rounded animate-pulse"></div>
      </div>

      {/* Beats visualization skeleton */}
      <div className="relative mt-4 w-full h-8 sm:h-10 bg-gray-100 rounded animate-pulse">
        <div className="absolute inset-0 bg-white/20 rounded animate-pulse"></div>
      </div>
    </div>
  );
};

export default VisualizationSkeleton;
