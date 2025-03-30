'use client';

import { useEffect, useRef } from 'react';

interface Segment {
  id: number;
  start: number;
  duration: number;
  cluster: number;
  next: number;
  jump_candidates?: number[];
}

interface SegmentVisualizerProps {
  segments: Segment[];
  currentSegment: number;
  nextSegment: number;
  currentTime: number;
  infiniteMode?: boolean;
}

export default function SegmentVisualizer({
  segments,
  currentSegment,
  nextSegment,
  currentTime,
  infiniteMode = false,
}: SegmentVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Calculate the total duration of the song
  const totalDuration = segments.length > 0
    ? segments.reduce((total, segment) => total + segment.duration, 0)
    : 0;

  // Draw the segments on the canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || segments.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (ctx) {
      // Increase canvas size
      canvas.width = 1000; // Adjust width as needed
      canvas.height = 300; // Adjust height as needed

      // Increase line width
      ctx.lineWidth = 3;
    }

    // Clear the canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Calculate segment widths based on their duration
    const segmentWidths = segments.map(segment => 
      (segment.duration / totalDuration) * canvas.width
    );

    // Draw each segment
    let xPosition = 0;
    segments.forEach((segment, index) => {
      const width = segmentWidths[index];
      
      // Determine segment color based on cluster
      const hue = (segment.cluster * 30) % 360; // Different color for each cluster
      
      // Highlight current and next segments
      let color;
      if (index === currentSegment) {
        color = `hsl(${hue}, 100%, 10%)`; // Bright color for current segment
      } else if (index === nextSegment) {
        color = `hsl(${hue}, 90%, 30%)`; // Lighter color for next segment
      } else if (infiniteMode && segment.jump_candidates && segment.jump_candidates.includes(currentSegment)) {
        // Highlight segments that are jump candidates for the current segment
        color = `hsl(${hue}, 90%, 40%)`; // Medium bright for jump candidates
      } else {
        color = `hsl(${hue}, 40%, 80%)`; // Even lighter for other segments
      }
      
      // Draw the segment
      ctx.fillStyle = color;
      ctx.fillRect(xPosition, 0, width, canvas.height);
      
      // Add a border
      // ctx.strokeStyle = '#ffffff';
      // ctx.lineWidth = 1;
      // ctx.strokeRect(xPosition, 0, width, canvas.height);
      
      // Move to the next position
      xPosition += width;
    });

    // Draw playback position indicator
    const playbackPosition = (currentTime / totalDuration) * canvas.width;
    ctx.fillStyle = '#000000';
    ctx.fillRect(playbackPosition - 1, 0, 2, canvas.height);

    // If in infinite mode, draw jump paths
    if (infiniteMode && segments[currentSegment]) {
      const currentX = segments.slice(0, currentSegment).reduce((sum, seg) => sum + (seg.duration / totalDuration) * canvas.width, 0);
      const currentWidth = segmentWidths[currentSegment];
      const currentMidX = currentX + (currentWidth / 2);
      
      // Draw a line to the next segment
      if (segments[nextSegment]) {
        const nextX = segments.slice(0, nextSegment).reduce((sum, seg) => sum + (seg.duration / totalDuration) * canvas.width, 0);
        const nextWidth = segmentWidths[nextSegment];
        const nextMidX = nextX + (nextWidth / 2);
        
        // Draw an arc from current to next
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(79, 70, 229, 0.7)'; // Indigo with transparency
        ctx.lineWidth = 6;
        
        // Calculate control points for a curved line
        const controlY = canvas.height * 1.5;
        
        ctx.moveTo(currentMidX, canvas.height);
        ctx.quadraticCurveTo(
          (currentMidX + nextMidX) / 2, 
          controlY, 
          nextMidX, 
          canvas.height
        );
        ctx.stroke();
      }
    }
  }, [segments, currentSegment, nextSegment, currentTime, totalDuration, infiniteMode]);

  return (
    <div className="w-full mb-8">
      <h3 className="text-lg font-medium text-gray-800 mb-2">
        Song Segments
        {infiniteMode && <span className="ml-2 text-sm text-indigo-600">(Infinite Remix Mode)</span>}
      </h3>
      <div className="relative bg-gray-100 rounded-lg overflow-hidden">
        <canvas 
          ref={canvasRef} 
          width={1000} 
          height={300}
          className="w-full h-[150px]"
        />
        
        <div className="mt-2 flex justify-between text-xs text-gray-500">
          <span>0:00</span>
          <span>{Math.floor(totalDuration / 60)}:{Math.floor(totalDuration % 60).toString().padStart(2, '0')}</span>
        </div>
      </div>
      
      <div className="mt-4 grid grid-cols-3 gap-4">
        <div className="bg-white p-3 rounded-lg shadow-sm">
          <h4 className="text-sm font-medium text-gray-700">Total Segments</h4>
          <p className="text-2xl font-bold text-indigo-600">{segments.length}</p>
        </div>
        <div className="bg-white p-3 rounded-lg shadow-sm">
          <h4 className="text-sm font-medium text-gray-700">Unique Clusters</h4>
          <p className="text-2xl font-bold text-indigo-600">
            {new Set(segments.map(s => s.cluster)).size}
          </p>
        </div>
        <div className="bg-white p-3 rounded-lg shadow-sm">
          <h4 className="text-sm font-medium text-gray-700">Current Segment</h4>
          <p className="text-2xl font-bold text-indigo-600">{currentSegment}</p>
          <p className="text-xs text-gray-500">Next: {nextSegment}</p>
        </div>
      </div>
    </div>
  );
} 