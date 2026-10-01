'use client';

import React, { useState, useCallback } from 'react';
import { uploadSong } from '@/lib/upload';
import type { Song } from '@/lib/types';

interface FileUploadProps {
  onUploadSuccess: (song: Song | null) => void;
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

  // Presign-then-PUT flow (ADR-0002): compute song_id client-side, get a
  // presigned URL from the BFF, PUT the file straight to R2, then finalize to
  // enqueue analysis (issue #21).
  const handleUpload = useCallback(async () => {
    if (!file) {
      onUploadError('Please select a file first.');
      return;
    }

    setIsUploading(true);
    onUploadError('');

    try {
      await uploadSong(file);
      onUploadSuccess(null);
    } catch (error) {
      console.error('Upload failed:', error);
      let errorMessage = 'An unexpected error occurred.';
      if (error instanceof Error) {
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
