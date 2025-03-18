'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Segment } from '@/types';

interface AudioPlayerProps {
  audioFile: File | null;
  currentSegment: number;
  nextSegment: number;
  segments?: Segment[];
  onTimeUpdate: (currentTime: number) => void;
  onSegmentChange?: (segmentIndex: number) => void;
}

export default function AudioPlayer({ 
  audioFile, 
  currentSegment, 
  nextSegment,
  segments = [],
  onTimeUpdate,
  onSegmentChange
}: AudioPlayerProps) {
  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioUrlRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const sourceNodesRef = useRef<AudioBufferSourceNode[]>([]);
  const gainNodeRef = useRef<GainNode | null>(null);
  const scheduledEndTimeRef = useRef<number>(0);
  const currentTimeRef = useRef<number>(0);
  const nextScheduleTimeRef = useRef<number>(0);
  const scheduledSegmentsRef = useRef<number[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(80);
  const [wavesurferReady, setWavesurferReady] = useState(false);
  const [useNativeAudio, setUseNativeAudio] = useState(false);
  const [useWebAudioAPI, setUseWebAudioAPI] = useState(true);
  const [audioDecoded, setAudioDecoded] = useState(false);
  const [bufferAhead, setBufferAhead] = useState(3); // Number of segments to buffer ahead
  const currentPlayingSegmentRef = useRef<number>(0);
  const lastReportedSegmentRef = useRef<number>(0);
  const [infiniteMode, setInfiniteMode] = useState(true);
  const [displayedCurrentSegment, setDisplayedCurrentSegment] = useState(currentSegment);
  const [displayedNextSegment, setDisplayedNextSegment] = useState(nextSegment);

  // Create audio URL from file
  useEffect(() => {
    if (audioFile) {
      // Revoke previous URL if it exists
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
      }
      
      // Create new URL
      const url = URL.createObjectURL(audioFile);
      audioUrlRef.current = url;
      
      // Reset state
      setIsPlaying(false);
      setCurrentTime(0);
      setWavesurferReady(false);
      setAudioDecoded(false);
      
      // Set native audio source
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.load();
      }
      
      // Initialize Web Audio API context
      if (useWebAudioAPI) {
        initializeWebAudio(url);
      }
      
      return () => {
        if (audioUrlRef.current) {
          URL.revokeObjectURL(audioUrlRef.current);
          audioUrlRef.current = null;
        }
        
        // Clean up audio nodes
        cleanupAudioNodes();
      };
    }
  }, [audioFile]);

  // Initialize Web Audio API
  const initializeWebAudio = useCallback((url: string) => {
    try {
      // Create audio context if it doesn't exist
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        gainNodeRef.current = audioContextRef.current.createGain();
        gainNodeRef.current.connect(audioContextRef.current.destination);
        gainNodeRef.current.gain.value = volume / 100;
      }
      
      // Fetch and decode audio data
      fetch(url)
        .then(response => response.arrayBuffer())
        .then(arrayBuffer => audioContextRef.current!.decodeAudioData(arrayBuffer))
        .then(audioBuffer => {
          audioBufferRef.current = audioBuffer;
          setDuration(audioBuffer.duration);
          setAudioDecoded(true);
          console.log('Audio decoded successfully, duration:', audioBuffer.duration);
        })
        .catch(error => {
          console.error('Error decoding audio data:', error);
          setUseWebAudioAPI(false);
          setUseNativeAudio(true);
        });
    } catch (error) {
      console.error('Error initializing Web Audio API:', error);
      setUseWebAudioAPI(false);
      setUseNativeAudio(true);
    }
  }, [volume]);

  // Clean up audio nodes
  const cleanupAudioNodes = useCallback(() => {
    // Stop and disconnect all source nodes
    sourceNodesRef.current.forEach(node => {
      try {
        node.stop();
        node.disconnect();
      } catch (e) {
        // Ignore errors if node is already stopped
      }
    });
    sourceNodesRef.current = [];
    
    // Reset scheduled time
    scheduledEndTimeRef.current = 0;
    nextScheduleTimeRef.current = 0;
    scheduledSegmentsRef.current = [];
    currentPlayingSegmentRef.current = currentSegment;
  }, [currentSegment]);

  // Initialize WaveSurfer
  useEffect(() => {
    if (waveformRef.current && audioFile) {
      // Destroy previous instance if it exists
      if (wavesurferRef.current) {
        wavesurferRef.current.destroy();
      }

      try {
        console.log('Initializing WaveSurfer with audio file:', audioFile);
        
        // Create new WaveSurfer instance
        const wavesurfer = WaveSurfer.create({
          container: waveformRef.current,
          waveColor: '#4F46E5',
          progressColor: '#818CF8',
          cursorColor: '#4F46E5',
          barWidth: 2,
          barRadius: 3,
          cursorWidth: 1,
          height: 80,
          barGap: 2,
          normalize: true,
          backend: 'WebAudio'
        });

        // Load audio file
        if (audioUrlRef.current) {
          console.log('Loading audio from URL:', audioUrlRef.current);
          wavesurfer.load(audioUrlRef.current);
        } else {
          console.log('Loading audio from Blob');
          wavesurfer.loadBlob(audioFile);
        }

        // Set up event listeners
        wavesurfer.on('ready', () => {
          console.log('WaveSurfer is ready');
          wavesurferRef.current = wavesurfer;
          setDuration(wavesurfer.getDuration());
          wavesurfer.setVolume(volume / 100);
          setWavesurferReady(true);
        });

        wavesurfer.on('audioprocess', () => {
          const time = wavesurfer.getCurrentTime();
          setCurrentTime(time);
          currentTimeRef.current = time;
          onTimeUpdate(time);
        });

        wavesurfer.on('play', () => {
          console.log('WaveSurfer play event');
          setIsPlaying(true);
        });
        
        wavesurfer.on('pause', () => {
          console.log('WaveSurfer pause event');
          setIsPlaying(false);
        });
        
        wavesurfer.on('finish', () => {
          console.log('WaveSurfer finish event');
          setIsPlaying(false);
        });

        wavesurfer.on('error', (err) => {
          console.error('WaveSurfer error:', err);
          setUseNativeAudio(true);
        });

        // Clean up on unmount
        return () => {
          wavesurfer.destroy();
        };
      } catch (error) {
        console.error('Error initializing WaveSurfer:', error);
        setUseNativeAudio(true);
      }
    }
  }, [audioFile, onTimeUpdate]);

  // Update volume when it changes
  useEffect(() => {
    if (wavesurferRef.current && wavesurferReady) {
      wavesurferRef.current.setVolume(volume / 100);
    }
    if (audioRef.current) {
      audioRef.current.volume = volume / 100;
    }
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = volume / 100;
    }
  }, [volume, wavesurferReady]);

  // Handle native audio timeupdate
  useEffect(() => {
    const audioElement = audioRef.current;
    if (audioElement) {
      const handleTimeUpdate = () => {
        const time = audioElement.currentTime;
        setCurrentTime(time);
        currentTimeRef.current = time;
        onTimeUpdate(time);
      };
      
      const handleDurationChange = () => {
        setDuration(audioElement.duration);
      };
      
      const handlePlay = () => {
        setIsPlaying(true);
      };
      
      const handlePause = () => {
        setIsPlaying(false);
      };
      
      const handleEnded = () => {
        setIsPlaying(false);
      };
      
      audioElement.addEventListener('timeupdate', handleTimeUpdate);
      audioElement.addEventListener('durationchange', handleDurationChange);
      audioElement.addEventListener('play', handlePlay);
      audioElement.addEventListener('pause', handlePause);
      audioElement.addEventListener('ended', handleEnded);
      
      return () => {
        audioElement.removeEventListener('timeupdate', handleTimeUpdate);
        audioElement.removeEventListener('durationchange', handleDurationChange);
        audioElement.removeEventListener('play', handlePlay);
        audioElement.removeEventListener('pause', handlePause);
        audioElement.removeEventListener('ended', handleEnded);
      };
    }
  }, [onTimeUpdate]);

  // Update displayed segments
  useEffect(() => {
    if (infiniteMode) {
      // In infinite mode, we display the currently playing segment from our internal tracking
      setDisplayedCurrentSegment(currentPlayingSegmentRef.current);
      if (segments.length > 0 && currentPlayingSegmentRef.current < segments.length) {
        setDisplayedNextSegment(segments[currentPlayingSegmentRef.current].next);
      }
    } else {
      // In normal mode, we use the segments from props
      setDisplayedCurrentSegment(currentSegment);
      setDisplayedNextSegment(nextSegment);
    }
  }, [currentSegment, nextSegment, infiniteMode, segments, currentPlayingSegmentRef.current]);

  // Report current segment to parent component
  useEffect(() => {
    if (infiniteMode && isPlaying && segments.length > 0) {
      const reportInterval = setInterval(() => {
        // Only report if the segment has changed
        if (currentPlayingSegmentRef.current !== lastReportedSegmentRef.current) {
          lastReportedSegmentRef.current = currentPlayingSegmentRef.current;
          onTimeUpdate(currentTimeRef.current);
          // Notify parent component about segment change
          if (onSegmentChange) {
            onSegmentChange(currentPlayingSegmentRef.current);
          }
        }
      }, 100);
      
      return () => clearInterval(reportInterval);
    }
  }, [infiniteMode, isPlaying, segments.length, onTimeUpdate, onSegmentChange]);

  // Schedule audio segments for playback
  const scheduleSegments = useCallback(() => {
    if (!audioContextRef.current || !audioBufferRef.current || !isPlaying || !useWebAudioAPI || !audioDecoded || segments.length === 0) {
      return;
    }

    const context = audioContextRef.current;
    const buffer = audioBufferRef.current;
    const currentTime = context.currentTime;
    
    // If we have already scheduled enough audio, don't schedule more yet
    if (scheduledEndTimeRef.current > currentTime + 1.0 && scheduledSegmentsRef.current.length >= bufferAhead) {
      return;
    }
    
    // Start scheduling from the current scheduled end time or current time
    const startTime = Math.max(currentTime, scheduledEndTimeRef.current);
    let scheduleTime = startTime;
    
    // Find the current segment based on playback time
    let nextSegmentToSchedule = currentPlayingSegmentRef.current;
    
    // If we've already scheduled some segments, start from the last one
    if (scheduledSegmentsRef.current.length > 0) {
      const lastScheduledSegment = scheduledSegmentsRef.current[scheduledSegmentsRef.current.length - 1];
      // Move to the next segment
      nextSegmentToSchedule = segments[lastScheduledSegment]?.next || 0;
    } else if (nextSegmentToSchedule === 0 && currentSegment > 0) {
      // If we're starting fresh and the parent component has a current segment, use that
      nextSegmentToSchedule = currentSegment;
      currentPlayingSegmentRef.current = currentSegment;
    }
    
    // Calculate how many more segments we need to schedule
    const segmentsToSchedule = Math.max(0, bufferAhead - scheduledSegmentsRef.current.length);
    
    console.log(`Scheduling ${segmentsToSchedule} more segments, starting with segment ${nextSegmentToSchedule}`);
    
    // Schedule multiple segments ahead
    for (let i = 0; i < segmentsToSchedule; i++) {
      if (nextSegmentToSchedule >= segments.length) {
        // We've reached the end of the song, loop back to the beginning
        nextSegmentToSchedule = 0;
      }
      
      const segment = segments[nextSegmentToSchedule];
      if (!segment) {
        console.warn(`Segment ${nextSegmentToSchedule} not found`);
        break;
      }
      
      const sourceNode = context.createBufferSource();
      sourceNode.buffer = buffer;
      sourceNode.connect(gainNodeRef.current!);
      
      // Calculate segment start and duration
      const segmentStart = segment.start;
      const segmentDuration = segment.duration;
      
      // Schedule this segment
      sourceNode.start(scheduleTime, segmentStart, segmentDuration);
      
      // Create an event to update the current playing segment
      const segmentIndex = nextSegmentToSchedule;
      
      // Schedule a timeout to update the current playing segment
      const timeUntilSegmentStarts = (scheduleTime - context.currentTime) * 1000;
      setTimeout(() => {
        currentPlayingSegmentRef.current = segmentIndex;
        // Force a re-render to update the displayed segment
        setDisplayedCurrentSegment(segmentIndex);
        if (segments.length > 0 && segmentIndex < segments.length) {
          setDisplayedNextSegment(segments[segmentIndex].next);
        }
      }, timeUntilSegmentStarts);
      
      console.log(`Scheduled segment ${nextSegmentToSchedule} at time ${scheduleTime.toFixed(2)}, duration: ${segmentDuration.toFixed(2)}, starts at: ${segmentStart.toFixed(2)}`);
      
      // Keep track of the scheduled end time
      scheduleTime += segmentDuration;
      scheduledEndTimeRef.current = scheduleTime;
      
      // Store the source node for later cleanup
      sourceNodesRef.current.push(sourceNode);
      
      // Add this segment to our scheduled segments list
      scheduledSegmentsRef.current.push(nextSegmentToSchedule);
      
      // Move to the next segment - for infinite remix, follow the "next" property
      nextSegmentToSchedule = infiniteMode ? segment.next : (nextSegmentToSchedule + 1) % segments.length;
    }
    
    // Schedule the next check
    nextScheduleTimeRef.current = startTime + 0.25; // Check again in 250ms
  }, [isPlaying, useWebAudioAPI, audioDecoded, bufferAhead, segments, currentSegment, infiniteMode]);

  // Reset scheduled segments when currentSegment changes from parent
  useEffect(() => {
    if (!infiniteMode && useWebAudioAPI && audioDecoded) {
      // Only reset if we're not in infinite mode
      cleanupAudioNodes();
      
      // If playing, schedule new segments starting from the current segment
      if (isPlaying) {
        scheduleSegments();
      }
    }
  }, [currentSegment, isPlaying, useWebAudioAPI, audioDecoded, cleanupAudioNodes, scheduleSegments, infiniteMode]);

  // Periodically check if we need to schedule more audio
  useEffect(() => {
    if (!isPlaying || !useWebAudioAPI || !audioDecoded) {
      return;
    }
    
    // Initial scheduling
    scheduleSegments();
    
    // Set up interval to check if we need to schedule more segments
    const intervalId = setInterval(() => {
      if (audioContextRef.current && audioContextRef.current.currentTime >= nextScheduleTimeRef.current) {
        scheduleSegments();
      }
    }, 100); // Check every 100ms
    
    return () => {
      clearInterval(intervalId);
    };
  }, [isPlaying, useWebAudioAPI, audioDecoded, scheduleSegments]);

  // Handle play/pause
  const togglePlayPause = () => {
    console.log('Toggle play/pause called. Current state:', { isPlaying, useNativeAudio, wavesurferReady, useWebAudioAPI });
    
    if (useWebAudioAPI && audioContextRef.current && audioDecoded) {
      console.log('Using Web Audio API for playback');
      
      if (isPlaying) {
        // Pause playback
        audioContextRef.current.suspend();
        setIsPlaying(false);
        cleanupAudioNodes();
      } else {
        // Resume or start playback
        audioContextRef.current.resume();
        setIsPlaying(true);
        // Schedule segments immediately
        setTimeout(() => scheduleSegments(), 0);
      }
    } else if (useNativeAudio && audioRef.current) {
      console.log('Using native audio element for playback');
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play().catch(err => {
          console.error('Error playing audio:', err);
        });
      }
    } else if (wavesurferRef.current && wavesurferReady) {
      console.log('Using WaveSurfer for playback');
      if (isPlaying) {
        wavesurferRef.current.pause();
      } else {
        wavesurferRef.current.play().catch(err => {
          console.error('Error playing wavesurfer:', err);
          // Fall back to native audio
          setUseNativeAudio(true);
          if (audioRef.current) {
            audioRef.current.play().catch(err => {
              console.error('Error playing fallback audio:', err);
            });
          }
        });
      }
    } else {
      console.warn('No playback method is ready');
    }
  };

  // Handle volume change
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseInt(e.target.value);
    setVolume(newVolume);
  };

  // Format time (seconds to MM:SS)
  const formatTime = (time: number) => {
    if (isNaN(time)) return '00:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="w-full bg-white rounded-lg shadow-md p-6 mb-8">
      {/* Hidden native audio element as fallback */}
      <audio ref={audioRef} preload="metadata" className="hidden" />
      
      <div className="mb-6" ref={waveformRef}></div>
      
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-gray-500">{formatTime(currentTime)}</span>
        <div className="flex items-center space-x-4">
          <button
            onClick={togglePlayPause}
            className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-full p-3 focus:outline-none"
          >
            {isPlaying ? (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
            )}
          </button>
          <div className="flex items-center">
            <svg className="w-5 h-5 text-gray-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15.536a5 5 0 001.414-7.072m-2.828 9.9a9 9 0 010-12.728"></path>
            </svg>
            <input
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={handleVolumeChange}
              className="w-24 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
            />
          </div>
        </div>
        <span className="text-sm text-gray-500">{formatTime(duration)}</span>
      </div>
      
      <div className="flex items-center justify-between">
        <div className="text-sm">
          <span className="font-medium text-gray-700">Current Segment:</span>
          <span className="ml-2 text-indigo-600">{displayedCurrentSegment}</span>
        </div>
        <div className="text-sm">
          <span className="font-medium text-gray-700">Next Jump:</span>
          <span className="ml-2 text-indigo-600">{displayedNextSegment}</span>
        </div>
        <div className="text-sm">
          <label className="inline-flex items-center">
            <input
              type="checkbox"
              checked={infiniteMode}
              onChange={() => setInfiniteMode(!infiniteMode)}
              className="form-checkbox h-4 w-4 text-indigo-600"
            />
            <span className="ml-2 text-gray-700">Infinite Remix</span>
          </label>
        </div>
      </div>
      
      {useNativeAudio && (
        <div className="mt-4 p-2 bg-yellow-50 rounded-md text-sm text-yellow-700">
          Using native audio player due to Web Audio API initialization issues.
        </div>
      )}
      
      {/* Progress Bar */}
      <div className="mt-4">
        <div className="relative h-2 bg-gray-200 rounded-full overflow-hidden">
          <div 
            className="absolute h-full bg-indigo-600 transition-all duration-300 ease-in-out"
            style={{ width: `${(currentTime / duration) * 100}%` }}
          ></div>
        </div>
        <div className="mt-1 flex justify-between text-xs text-gray-500">
          <span>Current Segment: {displayedCurrentSegment}</span>
          <span>Next Jump: {displayedNextSegment}</span>
        </div>
      </div>
      
      {/* Debug Panel */}
      <div className="mt-4 p-3 border border-gray-200 rounded-md bg-gray-50">
        <details>
          <summary className="text-sm font-medium text-gray-700 cursor-pointer">Debug Information</summary>
          <div className="mt-2 text-xs font-mono">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p><span className="font-bold">Audio File:</span> {audioFile ? audioFile.name : 'None'}</p>
                <p><span className="font-bold">File Size:</span> {audioFile ? (audioFile.size / 1024 / 1024).toFixed(2) + ' MB' : 'N/A'}</p>
                <p><span className="font-bold">File Type:</span> {audioFile ? audioFile.type : 'N/A'}</p>
                <p><span className="font-bold">URL Created:</span> {audioUrlRef.current ? 'Yes' : 'No'}</p>
              </div>
              <div>
                <p><span className="font-bold">WaveSurfer Ready:</span> {wavesurferReady ? 'Yes' : 'No'}</p>
                <p><span className="font-bold">Using Native Audio:</span> {useNativeAudio ? 'Yes' : 'No'}</p>
                <p><span className="font-bold">Using Web Audio API:</span> {useWebAudioAPI ? 'Yes' : 'No'}</p>
                <p><span className="font-bold">Audio Decoded:</span> {audioDecoded ? 'Yes' : 'No'}</p>
                <p><span className="font-bold">Is Playing:</span> {isPlaying ? 'Yes' : 'No'}</p>
                <p><span className="font-bold">Duration:</span> {formatTime(duration)}</p>
                <p><span className="font-bold">Buffer Ahead:</span> {bufferAhead} segments</p>
                <p><span className="font-bold">Infinite Mode:</span> {infiniteMode ? 'Yes' : 'No'}</p>
                <p><span className="font-bold">Scheduled Segments:</span> {scheduledSegmentsRef.current.length}</p>
                <p><span className="font-bold">Current Playing Segment:</span> {currentPlayingSegmentRef.current}</p>
              </div>
            </div>
            <div className="mt-2 flex space-x-2">
              <button 
                onClick={() => {
                  if (audioRef.current && audioUrlRef.current) {
                    console.log('Forcing native audio playback');
                    setUseWebAudioAPI(false);
                    setUseNativeAudio(true);
                    audioRef.current.play().catch(err => {
                      console.error('Error forcing audio playback:', err);
                    });
                  }
                }}
                className="px-2 py-1 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300"
              >
                Force Native Audio
              </button>
              <button 
                onClick={() => {
                  setBufferAhead(prev => Math.min(prev + 1, 30));
                }}
                className="px-2 py-1 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300"
              >
                Increase Buffer
              </button>
              <button 
                onClick={() => {
                  setBufferAhead(prev => Math.max(prev - 1, 1));
                }}
                className="px-2 py-1 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300"
              >
                Decrease Buffer
              </button>
              <button 
                onClick={() => {
                  cleanupAudioNodes();
                  scheduleSegments();
                }}
                className="px-2 py-1 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300"
              >
                Reset Buffer
              </button>
              <button 
                onClick={() => {
                  setInfiniteMode(!infiniteMode);
                  cleanupAudioNodes();
                  if (isPlaying) {
                    setTimeout(() => scheduleSegments(), 0);
                  }
                }}
                className="px-2 py-1 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300"
              >
                Toggle Infinite Mode
              </button>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
} 