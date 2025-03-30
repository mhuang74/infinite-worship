'use client';

import { useState, useRef } from 'react';

interface SongUploaderProps {
  onSongUpload: (file: File) => void;
}

export default function SongUploader({ onSongUpload }: SongUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type.includes('audio')) {
        setSelectedFile(file);
        onSongUpload(file);
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      
      // Validate file type
      const validTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg'];
      if (!validTypes.includes(file.type)) {
        setError('Please upload a valid audio file (MP3, WAV, or OGG).');
        return;
      }
      
      // Validate file size (max 30MB)
      const maxSize = 30 * 1024 * 1024; // 30MB in bytes
      if (file.size > maxSize) {
        setError('File size exceeds 30MB limit.');
        return;
      }
      
      setSelectedFile(file);
      setError(null);
      handleSubmit(file); // Automatically submit the form
    }
  };

  const handleSubmit = (file?: File) => {
    if (file) {
        onSongUpload(file);
    } else {
        setError('Please select a file first.');
    }
  };

  return (
      <div className="w-full bg-white rounded-lg shadow-md p-4 mb-4">
          <h2 className="text-lg font-semibold text-gray-800 mb-2">Upload a Worship Song</h2>
          
          <form onSubmit={handleSubmit}>
              <div 
                  className={`border-2 border-dashed rounded-lg p-4 text-center ${
                      isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 hover:border-indigo-400'
                  } transition-colors cursor-pointer`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
              >
                  <input 
                      type="file" 
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      className="hidden"
                      accept="audio/*"
                  />
                  
                  <svg className="w-8 h-8 mx-auto text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"></path>
                  </svg>
                  
                  {selectedFile ? (
                      <div>
                          <p className="text-indigo-600 font-medium mb-1 text-sm">{selectedFile.name}</p>
                          <p className="text-xs text-gray-500">
                              {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                          </p>
                      </div>
                  ) : (
                      <div>
                          <p className="text-gray-700 font-medium mb-1 text-sm">Drag and drop your audio file here</p>
                          <p className="text-xs text-gray-500">or click to browse</p>
                      </div>
                  )}
                  {error && (
                      <div className="mt-2 text-xs text-red-600 font-medium">
                          {error}
                      </div>
                  )}
              </div>
          </form>
      </div>
  );
} 