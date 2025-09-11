'use client';

import React, { useState, useCallback } from 'react';
import axios from 'axios';

interface FileUploadProps {
  onUploadSuccess: (data: any) => void;
  onUploadError: (message: string) => void;
}

const FileUpload: React.FC<FileUploadProps> = ({ onUploadSuccess, onUploadError }) => {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      setFile(event.target.files[0]);
    }
  };

  const handleUpload = useCallback(async () => {
    if (!file) {
      onUploadError('Please select a file first.');
      return;
    }

    setIsUploading(true);
    onUploadError('');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await axios.post('http://localhost:5555/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      onUploadSuccess(response.data);
    } catch (error) {
      let errorMessage = 'An unexpected error occurred.';
      if (axios.isAxiosError(error)) {
        if (error.response) {
          // The request was made and the server responded with a status code
          // that falls out of the range of 2xx
          errorMessage = `Error: ${error.response.status} - ${error.response.data?.error || error.response.statusText}`;
        } else if (error.request) {
          // The request was made but no response was received
          errorMessage = 'Network Error: The server is not responding. Is the backend running?';
        } else {
          // Something happened in setting up the request that triggered an Error
          errorMessage = error.message;
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      onUploadError(errorMessage);
    } finally {
      setIsUploading(false);
    }
  }, [file, onUploadSuccess, onUploadError]);

  return (
    <div className="p-6 border-2 border-dashed rounded-lg">
      <div className="flex flex-col items-center">
        <input
          type="file"
          onChange={handleFileChange}
          className="mb-4"
          accept="audio/*"
        />
        <button
          onClick={handleUpload}
          disabled={!file || isUploading}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-400"
        >
          {isUploading ? 'Uploading...' : 'Upload Song'}
        </button>
      </div>
    </div>
  );
};

export default FileUpload;
