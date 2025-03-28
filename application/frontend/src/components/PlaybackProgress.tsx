'use client';

import { useEffect, useRef } from 'react';

interface PlaybackProgressProps {
  currentTime: number;
  duration: number;
  currentSegment: number;
  nextSegment: number;
  beatsUntilJump: number;
  infiniteMode?: boolean;
}

export default function PlaybackProgress({
  currentTime,
  duration,
  currentSegment,
  nextSegment,
  beatsUntilJump,
  infiniteMode = false,
}: PlaybackProgressProps) {
  const progressRef = useRef<HTMLDivElement>(null);

  // Calculate progress percentage
  const progressPercentage = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Update progress bar width
  useEffect(() => {
    if (progressRef.current) {
      progressRef.current.style.width = `${progressPercentage}%`;
    }
  }, [progressPercentage]);


  useEffect(() => {
    console.log('beatsUntilJump updated:', beatsUntilJump);
  }, [beatsUntilJump]);


  return (
    <div className="w-full bg-white rounded-lg shadow-md p-6 mb-8">
      <h3 className="text-lg font-medium text-gray-800 mb-4">
        Playback Progress
        {infiniteMode && <span className="ml-2 text-sm text-indigo-600">(Infinite Remix Mode)</span>}
      </h3>
      
      <div className="relative h-4 bg-gray-200 rounded-full overflow-hidden mb-4">
        <div
          ref={progressRef}
          className="absolute top-0 left-0 h-full bg-indigo-600 transition-all duration-300 ease-in-out"
          style={{ width: `${progressPercentage}%` }}
        ></div>
      </div>
      
      <div className="grid grid-cols-3 gap-4 text-center">
        <div className="bg-gray-50 p-3 rounded-lg">
          <h4 className="text-xs font-medium text-gray-500 mb-1">Current Segment</h4>
          <p className="text-xl font-bold text-indigo-600">{currentSegment}</p>
        </div>
        
        <div className="bg-gray-50 p-3 rounded-lg">
          <h4 className="text-xs font-medium text-gray-500 mb-1">Next Jump</h4>
          <p className="text-xl font-bold text-indigo-600">{nextSegment}</p>
        </div>
        
        <div className="bg-gray-50 p-3 rounded-lg">
          <h4 className="text-xs font-medium text-gray-500 mb-1">
            {infiniteMode ? 'Jump Countdown' : 'Beats Until Jump'}
          </h4>
          <p className={`text-xl font-bold ${beatsUntilJump <= 3 ? 'text-red-500' : 'text-indigo-600'}`}>
            {beatsUntilJump}
          </p>
        </div>
      </div>
      
      <div className="mt-4 flex justify-between text-sm text-gray-500">
        <div>
          <span className="font-medium">Current Time:</span>
          <span className="ml-2">
            {Math.floor(currentTime / 60)}:{Math.floor(currentTime % 60).toString().padStart(2, '0')}
          </span>
        </div>
        <div>
          <span className="font-medium">Duration:</span>
          <span className="ml-2">
            {infiniteMode ? '∞' : `${Math.floor(duration / 60)}:${Math.floor(duration % 60).toString().padStart(2, '0')}`}
          </span>
        </div>
      </div>
      
      {infiniteMode && (
        <div className="mt-4 p-2 bg-indigo-50 rounded-md text-sm text-indigo-700">
          <p className="flex items-center">
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
            </svg>
            Playing in infinite remix mode - song will continue indefinitely by jumping between similar segments
          </p>
        </div>
      )}
    </div>
  );
} 