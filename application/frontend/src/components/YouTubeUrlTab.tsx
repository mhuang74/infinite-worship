'use client';

import React, { useState, useCallback } from 'react';
import axios from 'axios';
import api from '@/lib/api';
import YouTubePreview from './YouTubePreview';

interface YouTubeUrlTabProps {
  onExtractSuccess: (data: any) => void;
  onExtractError: (message: string) => void;
}

interface VideoInfo {
  video_id: string;
  title: string;
  duration: number;
  thumbnail: string;
  uploader: string;
}

const YouTubeUrlTab: React.FC<YouTubeUrlTabProps> = ({
  onExtractSuccess,
  onExtractError,
}) => {
  const [url, setUrl] = useState('');
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [isLoadingInfo, setIsLoadingInfo] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState('');
  const [validationError, setValidationError] = useState('');

  // YouTube URL validation patterns
  const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|m\.youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/;

  const validateUrl = (urlStr: string): boolean => {
    if (!urlStr.trim()) {
      setValidationError('');
      return false;
    }
    if (!youtubeRegex.test(urlStr)) {
      setValidationError('Please enter a valid YouTube URL');
      return false;
    }
    setValidationError('');
    return true;
  };

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newUrl = e.target.value;
    setUrl(newUrl);
    validateUrl(newUrl);
    // Reset video info when URL changes
    if (videoInfo) {
      setVideoInfo(null);
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
      validateUrl(text);
      if (youtubeRegex.test(text)) {
        // Auto-fetch info after paste
        fetchVideoInfo(text);
      }
    } catch (error) {
      console.error('Failed to read clipboard:', error);
    }
  };

  const handleClear = () => {
    setUrl('');
    setVideoInfo(null);
    setValidationError('');
    setExtractionProgress('');
    onExtractError('');
  };

  const fetchVideoInfo = useCallback(async (urlToFetch?: string) => {
    const targetUrl = urlToFetch || url;

    if (!validateUrl(targetUrl)) {
      return;
    }

    setIsLoadingInfo(true);
    onExtractError('');

    try {
      const response = await api.post('/youtube-info', { url: targetUrl });
      setVideoInfo(response.data);
    } catch (error) {
      let errorMessage = 'Failed to fetch video information.';
      if (axios.isAxiosError(error)) {
        if (error.response) {
          errorMessage = error.response.data?.message || error.response.data?.error || errorMessage;
        } else if (error.request) {
          errorMessage = 'Network Error: Cannot reach the server.';
        }
      }
      onExtractError(errorMessage);
      setVideoInfo(null);
    } finally {
      setIsLoadingInfo(false);
    }
  }, [url, onExtractError]);

  const handleExtract = useCallback(async () => {
    if (!validateUrl(url)) {
      onExtractError('Please enter a valid YouTube URL');
      return;
    }

    setIsExtracting(true);
    setExtractionProgress('Validating URL...');
    onExtractError('');

    try {
      // First get video info if we don't have it
      if (!videoInfo) {
        setExtractionProgress('Fetching video information...');
        const infoResponse = await api.post('/youtube-info', { url });
        setVideoInfo(infoResponse.data);
      }

      // Start extraction
      setExtractionProgress('Downloading audio from YouTube...');

      const response = await api.post('/extract-youtube', { url });

      setExtractionProgress('Analyzing beats and musical structure...');

      // Success!
      onExtractSuccess(response.data);
      handleClear(); // Clear form after successful extraction
    } catch (error) {
      let errorMessage = 'Extraction failed.';
      if (axios.isAxiosError(error)) {
        if (error.response) {
          const status = error.response.status;
          if (status === 429) {
            const retryAfter = error.response.data?.retry_after || 3600;
            const minutes = Math.ceil(retryAfter / 60);
            errorMessage = `Rate limit exceeded. Please try again in ${minutes} minute${minutes > 1 ? 's' : ''}.`;
          } else {
            errorMessage = error.response.data?.message || error.response.data?.error || errorMessage;
          }
        } else if (error.request) {
          errorMessage = 'Network Error: The server is not responding.';
        }
      }
      onExtractError(errorMessage);
      setExtractionProgress('');
    } finally {
      setIsExtracting(false);
    }
  }, [url, videoInfo, onExtractSuccess, onExtractError]);

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="p-6 border-2 border-dashed rounded-lg">
      <div className="flex flex-col space-y-4">
        {/* URL Input */}
        <div>
          <label htmlFor="youtube-url" className="block text-sm font-medium mb-2">
            YouTube URL
          </label>
          <div className="flex gap-2">
            <input
              id="youtube-url"
              type="text"
              value={url}
              onChange={handleUrlChange}
              onBlur={() => url && fetchVideoInfo()}
              placeholder="https://www.youtube.com/watch?v=..."
              className="flex-1 px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isExtracting}
            />
            <button
              onClick={handlePaste}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
              disabled={isExtracting}
            >
              Paste
            </button>
            <button
              onClick={handleClear}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
              disabled={isExtracting}
            >
              Clear
            </button>
          </div>
          {validationError && (
            <p className="text-red-500 text-sm mt-1">{validationError}</p>
          )}
        </div>

        {/* Loading State */}
        {isLoadingInfo && (
          <div className="text-center py-4">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            <p className="mt-2 text-gray-600">Fetching video information...</p>
          </div>
        )}

        {/* Video Preview */}
        {videoInfo && !isLoadingInfo && (
          <YouTubePreview
            videoInfo={videoInfo}
            onExtract={handleExtract}
            isExtracting={isExtracting}
            extractionProgress={extractionProgress}
          />
        )}

        {/* Fetch Button (if no video info yet) */}
        {!videoInfo && !isLoadingInfo && url && !validationError && (
          <button
            onClick={() => fetchVideoInfo()}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Preview Video
          </button>
        )}
      </div>
    </div>
  );
};

export default YouTubeUrlTab;
