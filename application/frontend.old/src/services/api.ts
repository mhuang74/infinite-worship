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
  } catch (error: unknown) {
    console.error('Error uploading song:', error);
    
    // Enhance error message based on the type of error
    if (axios.isAxiosError(error)) {
      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        const errorMessage = error.response.data?.error || 'Server error';
        throw new Error(`Server error: ${errorMessage}`);
      } else if (error.request) {
        // The request was made but no response was received
        throw new Error('No response from server. Please check if the backend is running.');
      }
    } else {
      // Something happened in setting up the request that triggered an Error
      throw error;
    }
  }
  throw new Error('Unexpected error occurred during song upload.')
};

// Unused. In future, can get song data for previous processed songs.
export const getSongSegments = async (songId: string): Promise<SongData> => {
  try {
    const response = await api.get(`/segments/${songId}`);
    return response.data;
  } catch (error: unknown) {
    console.error('Error uploading song:', error);
    
    // Enhance error message based on the type of error
    if (axios.isAxiosError(error)) {
      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        const errorMessage = error.response.data?.error || 'Server error';
        throw new Error(`Server error: ${errorMessage}`);
      } else if (error.request) {
        // The request was made but no response was received
        throw new Error('No response from server. Please check if the backend is running.');
      }
    } else {
      // Something happened in setting up the request that triggered an Error
      throw error;
    }
  }
  throw new Error('Unexpected error occurred during retrieving song segments.')
};

