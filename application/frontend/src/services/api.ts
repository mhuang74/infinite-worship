'use client';

import axios from 'axios';
import { SongData } from '@/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

// Add a timeout to the axios requests
const api = axios.create({
  baseURL: API_URL,
  timeout: 300000, // 5 min timeout
});

// Check if the API is available
export const checkApiAvailability = async (): Promise<boolean> => {
  try {
    const response = await api.get('/health', { timeout: 5000 });
    return response.status === 200;
  } catch (error) {
    console.error('API health check failed:', error);
    return false;
  }
};

export const uploadSong = async (file: File): Promise<SongData> => {
  const formData = new FormData();
  formData.append('file', file);

  try {
    // First check if the API is available
    const isApiAvailable = await checkApiAvailability();
    if (!isApiAvailable) {
      throw new Error('API server is not available. Please check if the backend is running.');
    }

    const response = await api.post('/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      // Add progress tracking
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          console.log(`Upload progress: ${percentCompleted}%`);
        }
      },
    });
    
    return response.data;
  } catch (error: any) {
    console.error('Error uploading song:', error);
    
    // Enhance error message based on the type of error
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      const errorMessage = error.response.data?.error || 'Server error';
      throw new Error(`Server error: ${errorMessage}`);
    } else if (error.request) {
      // The request was made but no response was received
      throw new Error('No response from server. Please check if the backend is running.');
    } else {
      // Something happened in setting up the request that triggered an Error
      throw error;
    }
  }
};

export const getSongSegments = async (songId: string): Promise<SongData> => {
  try {
    const response = await api.get(`/segments/${songId}`);
    return response.data;
  } catch (error: any) {
    console.error('Error fetching song segments:', error);
    
    if (error.response) {
      const errorMessage = error.response.data?.error || 'Server error';
      throw new Error(`Server error: ${errorMessage}`);
    } else if (error.request) {
      throw new Error('No response from server. Please check if the backend is running.');
    } else {
      throw error;
    }
  }
};

// For development/demo purposes, generate mock data
export const generateMockSongData = (duration: number): SongData => {
  const segmentCount = Math.floor(Math.random() * 20) + 30; // 30-50 segments
  const clusterCount = Math.floor(Math.random() * 5) + 5; // 5-10 clusters
  
  const segments: any[] = [];
  let currentTime = 0;
  
  for (let i = 0; i < segmentCount; i++) {
    const segmentDuration = (duration / segmentCount) * (0.8 + Math.random() * 0.4); // Slightly variable durations
    const cluster = Math.floor(Math.random() * clusterCount);
    const segment = Math.floor(i / 3); // Group segments into logical sections
    
    segments.push({
      id: i,
      start: currentTime,
      duration: segmentDuration,
      cluster,
      segment,
      is: i % 3, // Position within segment
      amplitude: 0.5 + Math.random() * 0.5,
      next: (i + 1) % segmentCount,
      jump_candidates: Array.from({ length: Math.floor(Math.random() * 5) }, () => 
        Math.floor(Math.random() * segmentCount)
      ),
    });
    
    currentTime += segmentDuration;
  }
  
  return {
    segments,
    duration,
    tempo: 120 + Math.random() * 40, // 120-160 BPM
    sample_rate: 44100,
  };
}; 