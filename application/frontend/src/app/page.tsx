'use client';

import { useState, useEffect } from 'react';
import SongUploader from '@/components/SongUploader';
import AudioPlayer from '@/components/AudioPlayer';
import SegmentVisualizer from '@/components/SegmentVisualizer';
import PlaybackProgress from '@/components/PlaybackProgress';
import { uploadSong, generateMockSongData } from '@/services/api';
import { SongData, PlaybackState, Segment } from '@/types';

export default function Home() {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [songData, setSongData] = useState<SongData | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useMockData, setUseMockData] = useState(false);
  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    currentSegment: 0,
    nextSegment: 0,
    beatsUntilJump: 0,
    currentTime: 0,
  });
  const [infinitePlaybackActive, setInfinitePlaybackActive] = useState(false);

  // Handle song upload
  const handleSongUpload = async (file: File) => {
    setAudioFile(file);
    setIsProcessing(true);
    setError(null);
    setUseMockData(false);
    
    try {
      // Try to use the real API
      const data = await uploadSong(file);
      setSongData(data);
      
      // Initialize playback state
      if (data.segments.length > 0) {
        const firstSegment = data.segments[0];
        setPlaybackState({
          currentSegment: 0,
          nextSegment: firstSegment.next,
          beatsUntilJump: 4, // Arbitrary initial value
          currentTime: 0,
        });
      }
    } catch (err: any) {
      console.error('Error processing song with API:', err);
      
      // Extract error message
      let errorMessage = 'Failed to process song with API.';
      if (err.response && err.response.data && err.response.data.error) {
        errorMessage = err.response.data.error;
      } else if (err.message) {
        errorMessage = err.message;
      }
      
      setError(`${errorMessage} Using mock data instead.`);
      setUseMockData(true);
      
      // Fallback to mock data
      const audio = new Audio();
      const objectUrl = URL.createObjectURL(file);
      
      audio.onloadedmetadata = () => {
        const duration = audio.duration;
        const mockData = generateMockSongData(duration);
        setSongData(mockData);
        
        // Initialize playback state
        if (mockData.segments.length > 0) {
          const firstSegment = mockData.segments[0];
          setPlaybackState({
            currentSegment: 0,
            nextSegment: firstSegment.next,
            beatsUntilJump: 4, // Arbitrary initial value
            currentTime: 0,
          });
        }
        
        URL.revokeObjectURL(objectUrl);
      };
      
      audio.src = objectUrl;
    } finally {
      setIsProcessing(false);
    }
  };

  // Update current segment based on playback time
  const handleTimeUpdate = (currentTime: number, beatsUntilJump: number) => {
    if (!songData) return;
    
    // Find the current segment based on time
    let currentSegmentIndex = 0;
    let accumulatedTime = 0;
    
    for (let i = 0; i < songData.segments.length; i++) {
      accumulatedTime += songData.segments[i].duration;
      if (currentTime < accumulatedTime) {
        currentSegmentIndex = i;
        break;
      }
    }
    
    // Calculate beats until jump (for demo purposes)
    const segment = songData.segments[currentSegmentIndex];
    const nextSegmentIndex = segment.next;
    
    setPlaybackState({
      currentSegment: currentSegmentIndex,
      nextSegment: nextSegmentIndex,
      beatsUntilJump,
      currentTime,
    });
  };

  // Handle segment change from the AudioPlayer in infinite mode
  const handleSegmentChange = (segmentIndex: number) => {
    if (!songData || segmentIndex >= songData.segments.length) return;
    
    const segment = songData.segments[segmentIndex];
    setInfinitePlaybackActive(true);
    
    setPlaybackState(prev => ({
      ...prev,
      currentSegment: segmentIndex,
      nextSegment: segment.next,
      beatsUntilJump: 4, // Reset beats until jump
    }));
  };

  // Handle retry with mock data
  const handleUseMockData = () => {
    if (!audioFile) return;
    
    setIsProcessing(true);
    setError(null);
    setUseMockData(true);
    
    const audio = new Audio();
    const objectUrl = URL.createObjectURL(audioFile);
    
    audio.onloadedmetadata = () => {
      const duration = audio.duration;
      const mockData = generateMockSongData(duration);
      setSongData(mockData);
      
      // Initialize playback state
      if (mockData.segments.length > 0) {
        const firstSegment = mockData.segments[0];
        setPlaybackState({
          currentSegment: 0,
          nextSegment: firstSegment.next,
          beatsUntilJump: 4, // Arbitrary initial value
          currentTime: 0,
        });
      }
      
      URL.revokeObjectURL(objectUrl);
      setIsProcessing(false);
    };
    
    audio.src = objectUrl;
  };

  return (
    <main className="flex min-h-screen flex-col items-center p-8 bg-gray-50">
      <div className="max-w-4xl w-full">
        <h1 className="text-3xl font-bold text-center mb-2 text-indigo-800">Infinite Worship</h1>
        <p className="text-center text-gray-600 mb-8">Upload a song, visualize segments, and experience intelligent playback</p>
        
        <SongUploader onSongUpload={handleSongUpload} />
        
        {isProcessing && (
          <div className="w-full bg-white rounded-lg shadow-md p-6 mb-8 text-center">
            <div className="animate-pulse flex flex-col items-center">
              <div className="h-8 w-8 mb-4 border-t-4 border-indigo-600 rounded-full animate-spin"></div>
              <p className="text-gray-600">Processing song... This may take a minute.</p>
            </div>
          </div>
        )}
        
        {error && (
          <div className="w-full bg-red-50 border border-red-200 rounded-lg p-4 mb-8">
            <p className="text-red-600 mb-2">{error}</p>
            {!useMockData && (
              <button 
                onClick={handleUseMockData}
                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
              >
                Use Mock Data
              </button>
            )}
          </div>
        )}
        
        {audioFile && !isProcessing && (
          <AudioPlayer 
            audioFile={audioFile}
            currentSegment={playbackState.currentSegment}
            nextSegment={playbackState.nextSegment}
            segments={songData?.segments || []}
            onTimeUpdate={handleTimeUpdate}
            onSegmentChange={handleSegmentChange}
          />
        )}
        
        {songData && !isProcessing && (
          <>
            <SegmentVisualizer 
              segments={songData.segments}
              currentSegment={playbackState.currentSegment}
              nextSegment={playbackState.nextSegment}
              currentTime={playbackState.currentTime}
              infiniteMode={infinitePlaybackActive}
            />
            
            <PlaybackProgress 
              currentTime={playbackState.currentTime}
              duration={songData.duration}
              currentSegment={playbackState.currentSegment}
              nextSegment={playbackState.nextSegment}
              beatsUntilJump={playbackState.beatsUntilJump}
              infiniteMode={infinitePlaybackActive}
            />
            
            <div className="bg-white rounded-lg shadow-md p-6 mb-8">
              <h3 className="text-lg font-medium text-gray-800 mb-4">Song Information</h3>
              {useMockData && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
                  <p className="text-yellow-700 text-sm">
                    <span className="font-medium">Note:</span> Using mock data for visualization. The actual audio processing failed.
                  </p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600">
                    <span className="font-medium">Duration:</span>
                    <span className="ml-2">
                      {Math.floor(songData.duration / 60)}:{Math.floor(songData.duration % 60).toString().padStart(2, '0')}
                    </span>
                  </p>
                  <p className="text-sm text-gray-600">
                    <span className="font-medium">Tempo:</span>
                    <span className="ml-2">{Math.round(songData.tempo)} BPM</span>
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">
                    <span className="font-medium">Total Segments:</span>
                    <span className="ml-2">{songData.segments.length}</span>
                  </p>
                  <p className="text-sm text-gray-600">
                    <span className="font-medium">Sample Rate:</span>
                    <span className="ml-2">{songData.sample_rate} Hz</span>
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
