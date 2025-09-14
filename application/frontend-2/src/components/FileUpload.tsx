'use client';

import React, { useState, useCallback, useRef } from 'react';
import axios from 'axios';

interface FileUploadProps {
  onUploadSuccess: (data: any) => void;
  onUploadError: (message: string) => void;
}

const FileUpload: React.FC<FileUploadProps> = ({ onUploadSuccess, onUploadError }) => {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      setFile(event.target.files[0]);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
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
          errorMessage = `Error: ${error.response.status} - ${error.response.data?.error || error.response.statusText}`;
        } else if (error.request) {
          errorMessage = 'Network Error: The server is not responding. Is the backend running?';
        } else {
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

  const openFileDialog = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="space-y-4">
      {/* Tape/CD Input Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        
        {/* File Drop Zone - Styled as Tape Deck */}
        <div
          className={`
            relative border-3 border-dashed rounded-vintage p-6 transition-all duration-200
            ${dragActive
              ? 'border-church-gold-400 bg-church-gold-50'
              : 'border-vintage-silver-400 bg-vintage-silver-100'
            }
            ${file ? 'border-church-navy-500 bg-church-navy-50' : ''}
            hover:border-church-gold-400 hover:bg-church-gold-50 cursor-pointer
            shadow-vintage-inset
          `}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={openFileDialog}
        >
          {/* Tape Deck Visual Elements */}
          <div className="flex items-center justify-center mb-4">
            <div className="relative">
              {/* Tape Reels */}
              <div className="flex space-x-8">
                <div className={`w-16 h-16 rounded-full border-4 border-vintage-silver-600 bg-vintage-silver-800 relative shadow-vintage-inset ${isUploading ? 'animate-tape-roll' : ''}`}>
                  <div className="absolute inset-2 rounded-full bg-vintage-silver-700"></div>
                  <div className="absolute inset-4 rounded-full bg-vintage-silver-600"></div>
                </div>
                <div className={`w-16 h-16 rounded-full border-4 border-vintage-silver-600 bg-vintage-silver-800 relative shadow-vintage-inset ${isUploading ? 'animate-tape-roll' : ''}`}>
                  <div className="absolute inset-2 rounded-full bg-vintage-silver-700"></div>
                  <div className="absolute inset-4 rounded-full bg-vintage-silver-600"></div>
                </div>
              </div>
              
              {/* Tape between reels */}
              <div className="absolute top-1/2 left-8 right-8 h-2 bg-vintage-bronze-600 transform -translate-y-1/2 rounded-sm shadow-vintage-inset"></div>
            </div>
          </div>

          <div className="text-center">
            {file ? (
              <div className="space-y-2">
                <div className="flex items-center justify-center">
                  <svg className="w-6 h-6 text-church-gold-500 mr-2" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                  </svg>
                  <span className="text-church-navy-700 font-vintage text-sm font-medium">{file.name}</span>
                </div>
                <p className="text-vintage-label text-vintage-silver-600 uppercase tracking-wider">
                  Audio File Loaded
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <svg className="w-8 h-8 text-vintage-silver-600 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-vintage-display text-vintage-silver-700 font-vintage font-medium">
                  Insert Audio File
                </p>
                <p className="text-vintage-label text-vintage-silver-600 uppercase tracking-wider">
                  Drop file or click to browse
                </p>
              </div>
            )}
          </div>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileChange}
            className="hidden"
            accept="audio/*"
          />
        </div>

        {/* Control Panel */}
        <div className="bg-vintage-metal rounded-vintage p-6 border-2 border-vintage-silver-300 shadow-vintage-inset">
          <div className="space-y-4">
            
            {/* Status Lights */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="flex items-center space-x-1">
                  <div className={`w-3 h-3 rounded-full ${file ? 'bg-green-500' : 'bg-gray-400'} shadow-lg`}></div>
                  <span className="text-vintage-label font-vintage text-vintage-silver-700 uppercase">FILE</span>
                </div>
                <div className="flex items-center space-x-1">
                  <div className={`w-3 h-3 rounded-full ${isUploading ? 'bg-church-gold-400 animate-pulse' : 'bg-gray-400'} shadow-lg`}></div>
                  <span className="text-vintage-label font-vintage text-vintage-silver-700 uppercase">PROC</span>
                </div>
              </div>
              
              {/* File Format Display */}
              {file && (
                <div className="bg-black px-3 py-1 rounded-sm">
                  <span className="text-church-gold-400 text-xs font-vintage font-mono">
                    {file.name.split('.').pop()?.toUpperCase() || 'AUDIO'}
                  </span>
                </div>
              )}
            </div>

            {/* File Info Display */}
            {file && (
              <div className="bg-church-navy-900 rounded-sm p-3 shadow-vintage-inset">
                <div className="text-church-gold-400 text-xs font-vintage space-y-1">
                  <div>NAME: {file.name.length > 20 ? file.name.substring(0, 20) + '...' : file.name}</div>
                  <div>SIZE: {(file.size / 1024 / 1024).toFixed(2)} MB</div>
                  <div>TYPE: {file.type}</div>
                </div>
              </div>
            )}

            {/* Upload Progress Display */}
            {isUploading && (
              <div className="bg-church-navy-900 rounded-sm p-3 shadow-vintage-inset">
                <div className="text-church-gold-400 text-xs font-vintage mb-2">PROCESSING AUDIO...</div>
                <div className="w-full bg-vintage-silver-700 rounded-full h-2">
                  <div className="bg-church-gold-400 h-2 rounded-full animate-pulse" style={{ width: '100%' }}></div>
                </div>
              </div>
            )}

            {/* Transport Button */}
            <button
              onClick={handleUpload}
              disabled={!file || isUploading}
              className={`
                w-full py-3 px-6 rounded-vintage font-vintage text-sm font-bold uppercase tracking-wider
                transition-all duration-200 shadow-vintage-button
                ${!file || isUploading
                  ? 'bg-vintage-silver-400 text-vintage-silver-600 cursor-not-allowed'
                  : 'bg-church-gradient text-white hover:shadow-vintage-outset active:shadow-vintage-inset'
                }
                ${isUploading ? 'animate-pulse' : ''}
              `}
            >
              {isUploading ? (
                <div className="flex items-center justify-center space-x-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Processing</span>
                </div>
              ) : (
                'Load Audio'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FileUpload;
