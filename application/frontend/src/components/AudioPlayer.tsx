'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Segment } from '@/types';

// Extended AudioBufferSourceNode interface with our custom properties
interface ExtendedAudioBufferSourceNode extends AudioBufferSourceNode {
  startTime?: number;
  endTime?: number;
  segmentIndex?: number;
}

interface AudioPlayerProps {
  audioFile: File | null;
  currentSegment: number;
  nextSegment: number;
  segments?: Segment[];
  onTimeUpdate: (currentTime: number, beatsUntilJump: number) => void;
  onSegmentChange?: (segmentIndex: number, nextJumpFrom: number, nextJumpTo: number) => void;
}

export default function AudioPlayer({ 
  audioFile, 
  currentSegment, 
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
  const sourceNodesRef = useRef<ExtendedAudioBufferSourceNode[]>([]);
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
  const currentPlayingSegmentRef = useRef<number>(0);
  const lastReportedSegmentRef = useRef<number>(0);
  const [infiniteMode] = useState(true);
  const [jumpLikelihood, setJumpLikelihood] = useState(20); // Default 20% likelihood to jump
  const nextJumpFrom = useRef(-1);
  const nextJumpTo = useRef(-1);
  const [beatsUntilJump, setBeatsUntilJump] = useState(4);
  const lastAudioFileRef = useRef<File | null>(null);
  // Add a debounce ref to prevent multiple rapid reinitializations
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const initializingRef = useRef<boolean>(false);
  const lastJumpTimeRef = useRef<number | null>(null);
  const JUMP_GRACEPERIOD = 16; // Seconds
  const [isScheduling, setIsScheduling] = useState(false); // Add this state
  const bufferAhead: number = 30;


  // Initialize Web Audio API
  const initializeWebAudio = useCallback((url: string) => {
    // Skip if already decoded for this file
    if (audioDecoded && audioBufferRef.current) {
      console.log('Audio already decoded, skipping initialization');
      return;
    }

    try {
      // Create audio context if it doesn't exist
      if (!audioContextRef.current) {
        // Use a try-catch for creating the AudioContext
        try {
          console.log('Creating new AudioContext');
          audioContextRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
          gainNodeRef.current = audioContextRef.current.createGain();
          gainNodeRef.current.connect(audioContextRef.current.destination);
          gainNodeRef.current.gain.value = volume / 100;
        } catch (error) {
          console.error('Failed to create AudioContext:', error);
          setUseWebAudioAPI(false);
          setUseNativeAudio(true);
          return;
        }
      }
      
      console.log('Fetching and decoding audio data');
      
      // Add a timeout to the fetch operation to prevent hanging requests
      const controller = new AbortController();
      const signal = controller.signal;
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      // Fetch and decode audio data
      fetch(url, { signal })
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          clearTimeout(timeoutId);
          return response.arrayBuffer();
        })
        .then(arrayBuffer => {
          if (!audioContextRef.current) {
            throw new Error('AudioContext not available');
          }
          return audioContextRef.current.decodeAudioData(arrayBuffer);
        })
        .then(audioBuffer => {
          audioBufferRef.current = audioBuffer;
          setDuration(audioBuffer.duration);
          setAudioDecoded(true);
          console.log('Audio decoded successfully, duration:', audioBuffer.duration);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          console.error('Error fetching or decoding audio data:', error);
          setUseWebAudioAPI(false);
          setUseNativeAudio(true);
        });
    } catch (error) {
      console.error('Error initializing Web Audio API:', error);
      setUseWebAudioAPI(false);
      setUseNativeAudio(true);
    }
  }, [volume, audioDecoded]);


  // Clean up audio nodes
  const cleanupAudioNodes = useCallback(() => {

    console.debug('>>>>> Cleaning up audio nodes');
    console.debug('Current source nodes:', sourceNodesRef.current);
    console.debug('Current scheduled segments:', scheduledSegmentsRef.current);
    console.debug('Current playing segment:', currentPlayingSegmentRef.current);

    // Stop and disconnect all source nodes
    sourceNodesRef.current.forEach(node => {
      try {
        node.stop();
        node.disconnect();
      } catch (e) {
        // Ignore errors if node is already stopped
        console.error(`Error stopping node: ${e}`);
      }
    });
    sourceNodesRef.current = [];
    
    // Reset scheduled time
    scheduledEndTimeRef.current = 0;
    nextScheduleTimeRef.current = 0;
    scheduledSegmentsRef.current = [];
    currentPlayingSegmentRef.current = currentSegment;
  }, [currentSegment]);

  
  // Create audio URL from file
  useEffect(() => {
    // Only create a new URL if the audioFile changes or we don't have a URL yet
    if (audioFile && (!audioUrlRef.current || audioFile !== lastAudioFileRef.current)) {
      // Save the current audioFile reference to compare in the future
      lastAudioFileRef.current = audioFile;
      
      console.log('Creating new audio URL for file:', audioFile.name);
      
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
      
      // Set native audio source - always initialize as a fallback
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.load();
      }
      
      // Initialize Web Audio API context
      if (useWebAudioAPI) {
        initializeWebAudio(url);
      }
    }
    
    // Cleanup function
    return () => {
      // Only revoke the URL when the component unmounts or audioFile changes
      if (audioUrlRef.current && audioFile !== lastAudioFileRef.current) {
        console.log('Revoking audio URL');
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
        
        // Clean up audio nodes
        cleanupAudioNodes();
      }
    };
  }, [audioFile, useWebAudioAPI, initializeWebAudio, cleanupAudioNodes]);

  // Add a function to stop specific audio nodes
  const stopAudioNodesBeforeTime = useCallback((time: number) => {
    if (sourceNodesRef.current.length === 0) return;

    // Find nodes that started before the given time and stop them
    const indexesToRemove: number[] = [];
    
    const startTime = performance.now();
    sourceNodesRef.current.forEach((node, index) => {
      if (node.endTime && node.endTime < time) {
        try {
          node.stop();
          node.disconnect();
          indexesToRemove.push(index);
        } catch (e) {
          // Ignore errors if node is already stopped
          console.error(`Error stopping node: ${e}`);
        }
      }
    });
    
    // Remove stopped nodes from the array (in reverse order to maintain correct indices)
    for (let i = indexesToRemove.length - 1; i >= 0; i--) {
      sourceNodesRef.current.splice(indexesToRemove[i], 1);
      scheduledSegmentsRef.current.splice(indexesToRemove[i], 1); // Also remove from scheduledSegmentsRef
    }
    
    const endTime = performance.now();
    console.debug(`stopAudioNodesBeforeTime removed ${indexesToRemove.length} audio nodes before time ${time.toFixed(2)} using ${(endTime - startTime).toFixed(2)} milliseconds`);

  }, []);

  // Initialize WaveSurfer
  useEffect(() => {
    let wavesurfer: WaveSurfer | null = null;
    let isComponentMounted = true;
    
    // Define a function to handle the initialization
    const initializeWaveSurfer = () => {
      // Prevent multiple simultaneous initializations
      if (initializingRef.current) {
        console.log('WaveSurfer initialization already in progress, skipping');
        return;
      }
      
      initializingRef.current = true;
      
      // Add a check to prevent reinitializing if already created with the same file
      if (waveformRef.current && audioFile && !wavesurferReady) {
        // Store a reference to the current file to avoid recreating for the same file
        const fileUrl = audioUrlRef.current;
        
        // Destroy previous instance if it exists
        if (wavesurferRef.current) {
          console.log('Destroying previous WaveSurfer instance');
          wavesurferRef.current.destroy();
          wavesurferRef.current = null;
        }

        try {
         
          // Create new WaveSurfer instance
          wavesurfer = WaveSurfer.create({
            container: waveformRef.current,
            waveColor: '#4F46E5',
            progressColor: '#818CF8',
            cursorColor: '#4F46E5',
            barWidth: 2,
            barRadius: 3,
            cursorWidth: 1,
            height: 50,
            barGap: 2,
            normalize: true,
            backend: 'WebAudio', // Ensure the backend is set to 'WebAudio'
          });

          // Load audio file
          if (fileUrl) {
            console.log('Initializing WaveSurfer with audio file URL:', fileUrl);
            
            // Add loading check to prevent AbortError
            const loadPromise = wavesurfer.load(fileUrl);
            loadPromise.catch(err => {
              // Only handle the error if the component is still mounted
              if (isComponentMounted) {
                console.error('WaveSurfer error:', err);
                setUseNativeAudio(true);
                initializingRef.current = false;
              }
            });
          } else {
            console.log('Initializing WaveSurfer with audio file blob:', audioFile.name);
            
            // Add loading check to prevent AbortError
            const loadPromise = wavesurfer.loadBlob(audioFile);
            loadPromise.catch(err => {
              // Only handle the error if the component is still mounted
              if (isComponentMounted) {
                console.error('WaveSurfer error:', err);
                setUseNativeAudio(true);
                initializingRef.current = false;
              }
            });
          }

          // Set up event listeners
          wavesurfer.on('ready', () => {
            if (isComponentMounted) {
              console.log('WaveSurfer is ready');
              wavesurferRef.current = wavesurfer;
              if (wavesurfer) {
                setDuration(wavesurfer.getDuration());
                wavesurfer.setVolume(volume / 100);
              }
              setWavesurferReady(true);
              initializingRef.current = false;
            }
          });

          wavesurfer.on('audioprocess', () => {
            console.debug('WaveSurfer event triggered: audioprocess');
            if (isComponentMounted && wavesurfer) {
              const time = wavesurfer.getCurrentTime();
              console.info('WaveSurfer audioprocess event, current time:', time); // Add debug log
              setCurrentTime(time);
              currentTimeRef.current = time;
              onTimeUpdate(time, beatsUntilJump);
            }
          });

          wavesurfer.on('play', () => {
            console.debug('WaveSurfer event triggered: play');
            if (isComponentMounted) {
              console.info('WaveSurfer play event');
              setIsPlaying(true);
            }
          });
          
          wavesurfer.on('pause', () => {
            console.debug('WaveSurfer event triggered: pause');
            if (isComponentMounted) {
              console.info('WaveSurfer pause event');
              setIsPlaying(false);
            }
          });
          
          wavesurfer.on('finish', () => {
            if (isComponentMounted) {
              console.info('WaveSurfer finish event');
              setIsPlaying(false);
            }
          });

          wavesurfer.on('error', (err) => {
            if (isComponentMounted) {
              console.error('WaveSurfer error:', err);
              setUseNativeAudio(true);
              initializingRef.current = false;
            }
          });
        } catch (error) {
          if (isComponentMounted) {
            console.error('Error initializing WaveSurfer:', error);
            setUseNativeAudio(true);
            initializingRef.current = false;
          }
        }
      } else {
        initializingRef.current = false;
      }
    };
    
    // Clear any existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    
    // Debounce the initialization to prevent rapid repeated calls
    debounceTimerRef.current = setTimeout(() => {
      initializeWaveSurfer();
    }, 300); // 300ms debounce

    // Initial scheduling
    console.debug('Initial scheduling of segments');
    scheduleSegments();

    // Clean up on unmount or when dependencies change
    return () => {
      isComponentMounted = false;
      
      // Clear debounce timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      
      if (wavesurfer) {
        console.debug('Cleaning up WaveSurfer instance');
        console.debug('Current WaveSurfer state:', {
          isPlaying: wavesurfer.isPlaying(),
          duration: wavesurfer.getDuration(),
          currentTime: wavesurfer.getCurrentTime(),
        });
        try {
          wavesurfer.destroy();
        } catch (e) {
          console.log('Error during wavesurfer cleanup:', e);
        }
      }
    };
  });

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
        onTimeUpdate(time, beatsUntilJump);
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
  }, [onTimeUpdate, beatsUntilJump]);

  // // Update displayed segments and next jump target
  // useEffect(() => {
  //   if (infiniteMode && segments.length > 0 && currentPlayingSegmentRef.current < segments.length) {
  //     const currentSegment = segments[currentPlayingSegmentRef.current];
  //     setDisplayedCurrentSegment(currentPlayingSegmentRef.current);
      
  //     // Calculate next jump target based on jump likelihood and available candidates
  //     if (currentSegment.jump_candidates && currentSegment.jump_candidates.length > 0 && Math.random() * 100 < jumpLikelihood) {
  //       // Pick a random jump candidate
  //       const jumpCandidateIndex = Math.floor(Math.random() * currentSegment.jump_candidates.length);
  //       const jumpTarget = currentSegment.jump_candidates[jumpCandidateIndex];
  //       setnextJumpTo(jumpTarget);
  //     } else {
  //       // Use sequential next segment if not jumping
  //       setnextJumpTo(currentSegment.next);
  //     }
  //   } else {
  //     // In normal mode, use the segments from props
  //     setDisplayedCurrentSegment(currentSegment);
  //     setnextJumpTo(nextSegment);
  //   }
  // }, [currentSegment, nextSegment, infiniteMode, segments, currentPlayingSegmentRef.current, jumpLikelihood]);

  // Update beats until jump
  useEffect(() => {
    if (segments.length > 0 && currentPlayingSegmentRef.current < segments.length) {
      const currentSegment = segments[currentPlayingSegmentRef.current];
      const segmentDuration = currentSegment.duration;
      const segmentStart = currentSegment.start;
      const segmentProgress = (currentTimeRef.current - segmentStart) / segmentDuration;
      const beatsUntilJump = Math.max(0, Math.floor((1 - segmentProgress) * 4));
      setBeatsUntilJump(beatsUntilJump);
    }
  }, [segments]);

  // Report current segment to parent component
  useEffect(() => {
    if (infiniteMode && isPlaying && segments.length > 0) {
      const reportInterval = setInterval(() => {
        // Only report if the segment has changed
        if (currentPlayingSegmentRef.current !== lastReportedSegmentRef.current) {
          lastReportedSegmentRef.current = currentPlayingSegmentRef.current;
          onTimeUpdate(currentTimeRef.current, beatsUntilJump);

          // console.debug('Reporting current segment:', currentPlayingSegmentRef.current);
          // console.debug('Next jump from:', nextJumpFrom.current);
          // console.debug('Next jump to:', nextJumpTo.current);

          
          // if already passed JumpFrom point, clear jump info
          if (currentPlayingSegmentRef.current >= nextJumpFrom.current) {
            // console.debug("Clearing jump info")
            nextJumpFrom.current = -1;
            nextJumpTo.current = -1;
          }

          // Notify parent component about segment change
          if (onSegmentChange) {
            onSegmentChange(currentPlayingSegmentRef.current, nextJumpFrom.current, nextJumpTo.current);
          }
        }
      }, 100);
      
      return () => clearInterval(reportInterval);
    }
  }, [infiniteMode, isPlaying, segments.length, onTimeUpdate, onSegmentChange, beatsUntilJump]);

  // Schedule audio segments for playback
  const scheduleSegments = useCallback(() => {
    if (isScheduling) {
      console.debug('scheduleSegments is already running, skipping this call');
      return;
    }

    setIsScheduling(true); // Set the flag to indicate the function is running

    if (!audioContextRef.current || !audioBufferRef.current || !isPlaying || !useWebAudioAPI || !audioDecoded || segments.length === 0) {
      setIsScheduling(false);  // Reset the flag if early return
      return;
    }

    const context = audioContextRef.current;
    const buffer = audioBufferRef.current;
    const currentTime = context.currentTime;
      
    // Start scheduling from the current scheduled end time or current time
    const startTime = Math.max(currentTime, scheduledEndTimeRef.current);
    let scheduleTime = startTime;
    
    // Find the current segment based on playback time
    let nextSegmentToSchedule = currentPlayingSegmentRef.current;
    
    // Calculate how many more segments we need to schedule - limit by buffer length
    const segmentsToSchedule = Math.max(0, bufferAhead - scheduledSegmentsRef.current.length);
    
    console.debug(`Scheduling up to ${segmentsToSchedule} more segments, starting with segment ${nextSegmentToSchedule}. Currently have ${scheduledSegmentsRef.current.length} segments in queue`);
    
    // Schedule multiple segments ahead
    for (let i = 0; i < segmentsToSchedule; i++) {

      /// Determine next segment to schedule

      if (scheduledSegmentsRef.current.length > 0) {
        const lastScheduledSegment = scheduledSegmentsRef.current[scheduledSegmentsRef.current.length - 1];
        // look at last segment to determine to move forward or jump
        const segment = segments[lastScheduledSegment];

        if (infiniteMode) {
          const dice = Math.random() * 100
          const since_last_jump = Math.round(Math.abs(scheduleTime - (lastJumpTimeRef.current ?? 0)));
          // Use jump likelihood to decide whether to use the defined next segment or pick a jump candidate
          const jump = (dice < jumpLikelihood) && 
            (since_last_jump >= JUMP_GRACEPERIOD) && 
            segment.jump_candidates && 
            (segment.jump_candidates.length > 0);

          const metadata = `Dice: ${dice.toFixed(2)}, Likelihood: ${jumpLikelihood}, Since Last Jump: ${since_last_jump}, Last Jump: ${lastJumpTimeRef.current?.toFixed(0)}, Schedule Time: ${scheduleTime.toFixed(0)}, Jump Grace: ${JUMP_GRACEPERIOD}`;
          
          if (jump) {
            // Pick a random jump candidate
            const jumpCandidateIndex = Math.floor(Math.random() * segment.jump_candidates.length);
            const jumpTarget = segment.jump_candidates[jumpCandidateIndex];
            console.info(`>>> Jump from ${lastScheduledSegment} to ${jumpTarget}. candidates: ${segment.jump_candidates.length}. ` + metadata);
            nextSegmentToSchedule = jumpTarget;
            lastJumpTimeRef.current = scheduleTime;
            nextJumpFrom.current = lastScheduledSegment;
            nextJumpTo.current = jumpTarget;
          } else {
            // Follow the predefined next segment
            nextSegmentToSchedule = segment?.next || 0;
            console.debug(`No Jump. ` + metadata);
          }
        } else {
          // Sequential mode
          nextSegmentToSchedule = (nextSegmentToSchedule + 1) % segments.length;
        }

      } else if (nextSegmentToSchedule === 0 && currentSegment > 0) {
        // If we're starting fresh and the parent component has a current segment, use that
        nextSegmentToSchedule = currentSegment;
        currentPlayingSegmentRef.current = currentSegment;
      }      

      // Create source node with our extended type
      const sourceNode = context.createBufferSource() as ExtendedAudioBufferSourceNode;
      sourceNode.buffer = buffer;
      sourceNode.connect(gainNodeRef.current!);

      const segment = segments[nextSegmentToSchedule];
      
      // Store the start time directly on the node for easier cleanup
      sourceNode.startTime = scheduleTime;
      sourceNode.endTime = scheduleTime + segment.duration;
      sourceNode.segmentIndex = nextSegmentToSchedule;
      
      // Calculate segment start and duration
      const segmentStart = segment.start;
      const segmentDuration = segment.duration;
      
      // Make sure we schedule with proper stop time to avoid overlaps
      sourceNode.start(scheduleTime, segmentStart, segmentDuration);
      
      // Create an event to update the current playing segment
      const segmentIndex = nextSegmentToSchedule;
      
      // Schedule a timeout to update the current playing segment
      const timeUntilSegmentStarts = (scheduleTime - context.currentTime) * 1000;
      setTimeout(() => {
        if (!isPlaying) return; // Skip update if we're not playing anymore
        
        currentPlayingSegmentRef.current = segmentIndex;
      }, timeUntilSegmentStarts);
      
      console.debug(`Scheduled segment ${nextSegmentToSchedule} at time ${scheduleTime.toFixed(2)}, duration: ${segmentDuration.toFixed(2)}, song location: ${segmentStart.toFixed(2)}, horizon: ${(scheduleTime - currentTime).toFixed(2)}s ahead`);
      
      // Keep track of the scheduled end time
      scheduleTime += segmentDuration;
      scheduledEndTimeRef.current = scheduleTime;
      
      // Store the source node for later cleanup
      sourceNodesRef.current.push(sourceNode);
      
      // Add this segment to our scheduled segments list
      scheduledSegmentsRef.current.push(nextSegmentToSchedule);
      
    }
    
    // Schedule the next check - make it more responsive when we have few segments scheduled
    const nextCheckDelay = scheduledSegmentsRef.current.length < bufferAhead / 2 ? 0.1 : 0.5;
    nextScheduleTimeRef.current = startTime + nextCheckDelay;

    setIsScheduling(false); // Reset the flag after execution
  }, [isPlaying, useWebAudioAPI, audioDecoded, bufferAhead, segments, currentSegment, jumpLikelihood, isScheduling, infiniteMode]);

  // Periodically check if we need to schedule more audio 
  useEffect(() => {
    if (!isPlaying || !useWebAudioAPI || !audioDecoded) {
      return;
    }
    
    // Initial scheduling
    console.debug('Initial scheduling of segments');
    scheduleSegments();
    
    // Set up interval to check if we need to schedule more segments
    const intervalId = setInterval(() => {
      if (audioContextRef.current) {

        const currentTime = audioContextRef.current.currentTime;
        // console.debug('Calling stopAudioNodesBeforeTime with currentTime:', currentTime);
        // Stop any nodes that should be finished by now
        stopAudioNodesBeforeTime(currentTime);

        // Calculate time ahead
        const timeAhead = scheduledEndTimeRef.current - currentTime;
        const remainingSegments = scheduledSegmentsRef.current.length;
        
        // Check if we need to schedule more segments based on time and count
        const needMoreSegments = 
          remainingSegments < bufferAhead / 2 || // Below half capacity
          timeAhead < 3.0 || // Less than 3 seconds ahead
          audioContextRef.current.currentTime >= nextScheduleTimeRef.current; // Reached scheduled check time
          
        if (needMoreSegments) {

          console.debug('More segments need to be scheduled:', {
            timeAhead: scheduledEndTimeRef.current - currentTime,
            remainingSegments: scheduledSegmentsRef.current.length,
            bufferAhead,
            nextScheduleTime: nextScheduleTimeRef.current,
            currentTime: audioContextRef.current.currentTime,
            needMoreSegments
          });

          scheduleSegments();
        }
      }
    }, 250); 
    
    return () => {
      clearInterval(intervalId);
    };
  });
  
  // Reset scheduled segments when currentSegment changes from parent
  useEffect(() => {
    if (!infiniteMode && useWebAudioAPI && audioDecoded) {

      console.debug('Resetting scheduled segments due to currentSegment change:', { currentSegment, isPlaying, useWebAudioAPI, audioDecoded });

      // Only reset if we're not in infinite mode
      cleanupAudioNodes();
      
      // If playing, schedule new segments starting from the current segment
      if (isPlaying) {
        scheduleSegments();
      }
    }
  }, [currentSegment, isPlaying, useWebAudioAPI, audioDecoded, cleanupAudioNodes, scheduleSegments, infiniteMode]);

  // Handle play/pause
  const togglePlayPause = () => {
    console.log('Toggle play/pause called. Current state:', { isPlaying, useNativeAudio, wavesurferReady, useWebAudioAPI });
    
    if (useWebAudioAPI && audioContextRef.current && audioDecoded) {
      console.log('Using Web Audio API for playback');
      
      if (isPlaying) {
        // Pause playback
        audioContextRef.current.suspend();
        setIsPlaying(false);
        // cleanupAudioNodes();
      } else {
        // // Resume or start playback - make sure we have a clean slate
        // cleanupAudioNodes();
        
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
        // Adding a non-null assertion to fix TypeScript errors
        const wavesurfer = wavesurferRef.current!;
        wavesurfer.play().catch(err => {
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
      console.warn('No playback method is ready, trying native audio as fallback');
      setUseNativeAudio(true);
      if (audioRef.current && audioUrlRef.current) {
        audioRef.current.src = audioUrlRef.current;
        audioRef.current.play().catch(err => {
          console.error('Error playing fallback audio:', err);
        });
      }
    }
  };

  // Handle volume change
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseInt(e.target.value);
    setVolume(newVolume);
  };

  // Handle jump likelihood change
  const handleJumpLikelihoodChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newLikelihood = parseInt(e.target.value);
    setJumpLikelihood(newLikelihood);
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
      
      <div className="mb-6" ref={waveformRef} style={{ height: '50px' }}></div>
      
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
      
     
      {/* Jump Likelihood Slider */}
      {(
        <div className="flex items-center mb-4">
          <span className="text-sm font-medium text-gray-700 mr-2">Jump Likelihood:</span>
          <input
            type="range"
            min="0"
            max="100"
            value={jumpLikelihood}
            onChange={handleJumpLikelihoodChange}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
          <span className="ml-2 text-sm text-indigo-600">{jumpLikelihood}%</span>
        </div>
      )}
      
      {useNativeAudio && (
        <div className="mt-4 p-2 bg-yellow-50 rounded-md text-sm text-yellow-700">
          Using native audio player due to Web Audio API initialization issues.
        </div>
      )}
      
    </div>
  );
} 