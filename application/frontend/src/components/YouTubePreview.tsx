'use client';

import React from 'react';
import Image from 'next/image';

interface VideoInfo {
  video_id: string;
  title: string;
  duration: number;
  thumbnail: string;
  uploader: string;
}

interface YouTubePreviewProps {
  videoInfo: VideoInfo;
  onExtract: () => void;
  isExtracting: boolean;
  extractionProgress: string;
}

const YouTubePreview: React.FC<YouTubePreviewProps> = ({
  videoInfo,
  onExtract,
  isExtracting,
  extractionProgress,
}) => {
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="border rounded-lg p-4 bg-gray-50">
      <h3 className="text-lg font-semibold mb-3">Video Preview</h3>

      <div className="flex gap-4 mb-4">
        {/* Thumbnail */}
        <div className="flex-shrink-0">
          {videoInfo.thumbnail ? (
            <img
              src={videoInfo.thumbnail}
              alt={videoInfo.title}
              className="w-32 h-24 object-cover rounded"
            />
          ) : (
            <div className="w-32 h-24 bg-gray-300 rounded flex items-center justify-center">
              <span className="text-gray-500 text-xs">No thumbnail</span>
            </div>
          )}
        </div>

        {/* Video Info */}
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-gray-900 truncate" title={videoInfo.title}>
            {videoInfo.title}
          </h4>
          <p className="text-sm text-gray-600 mt-1">
            <span className="font-medium">Uploader:</span> {videoInfo.uploader}
          </p>
          <p className="text-sm text-gray-600">
            <span className="font-medium">Duration:</span> {formatDuration(videoInfo.duration)}
          </p>
        </div>
      </div>

      {/* Extraction Progress */}
      {isExtracting && extractionProgress && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">{extractionProgress}</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div className="bg-blue-500 h-2 rounded-full animate-pulse" style={{ width: '60%' }}></div>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            This may take 1-2 minutes depending on song length...
          </p>
        </div>
      )}

      {/* Extract Button */}
      <button
        onClick={onExtract}
        disabled={isExtracting}
        className="w-full px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
      >
        {isExtracting ? (
          <span className="flex items-center justify-center">
            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Extracting & Analyzing...
          </span>
        ) : (
          'Extract & Analyze'
        )}
      </button>
    </div>
  );
};

export default YouTubePreview;
