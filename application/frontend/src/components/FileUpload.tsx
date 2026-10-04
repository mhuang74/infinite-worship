'use client';

import React, { useState, useCallback } from 'react';
import { uploadSong } from '@/lib/upload';
import type { UploadPhase } from '@/lib/upload';
import StatusChip from '@/components/StatusChip';

interface FileUploadProps {
  /** Called with the uploaded Song's id so the parent can poll its status. */
  onUploadSuccess: (songId: string) => void;
  onUploadError: (message: string) => void;
}

const PHASE_LABELS: Record<UploadPhase, string> = {
  presign: 'Preparing upload…',
  upload: 'Uploading to storage…',
  finalize: 'Starting analysis…',
};

const FileUpload: React.FC<FileUploadProps> = ({ onUploadSuccess, onUploadError }) => {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [phase, setPhase] = useState<UploadPhase | null>(null);
  const [queued, setQueued] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const chooseFile = (next: File | null) => {
    setFile(next);
    setQueued(false);
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
    setPhase('presign');
    onUploadError('');

    try {
      const ticket = await uploadSong(file, setPhase);
      // Report the uploaded Song id so the parent can poll its status through
      // pending → processing → ready | failed (issue #23).
      setQueued(true);
      onUploadSuccess(ticket.song_id);
    } catch (error) {
      console.error('Upload failed:', error);
      let errorMessage = 'An unexpected error occurred.';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      onUploadError(errorMessage);
    } finally {
      setIsUploading(false);
      setPhase(null);
    }
  }, [file, onUploadSuccess, onUploadError]);

  return (
    <div>
      {/* Outlined dashed drop zone (§5.3) */}
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          chooseFile(e.dataTransfer.files?.[0] ?? null);
        }}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors duration-200 ${
          dragOver
            ? 'border-gold-foreground bg-gold-foreground/[0.08]'
            : 'border-outline-variant hover:border-outline hover:bg-on-surface/[0.04]'
        }`}
      >
        <input
          type="file"
          className="sr-only"
          accept="audio/*"
          onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
        />
        <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="text-on-surface-variant">
          <path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z" />
        </svg>
        {file ? (
          <span className="text-sm font-medium text-on-surface">{file.name}</span>
        ) : (
          <span className="text-sm text-on-surface-variant">
            Drop an audio file here, or <span className="font-semibold text-gold-foreground">browse</span>
          </span>
        )}
      </label>

      <div className="mt-4 flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={handleUpload}
          disabled={!file || isUploading}
          className="h-10 rounded-full bg-brand-gold px-6 text-sm font-semibold text-on-gold transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isUploading ? 'Uploading…' : 'Upload Song'}
        </button>

        {/* MD3 linear progress through presign → PUT → finalize */}
        {isUploading && phase && (
          <div className="w-full max-w-sm">
            <div className="loading-bar" style={{ height: 4 }} role="progressbar" aria-label={PHASE_LABELS[phase]} />
            <p className="mt-2 text-center text-xs text-on-surface-variant">{PHASE_LABELS[phase]}</p>
          </div>
        )}

        {/* Terminal state after enqueue: chip matches the library's chips */}
        {queued && !isUploading && (
          <div className="flex items-center gap-2 text-xs text-on-surface-variant">
            <StatusChip status="pending" />
            Analysis queued — tracking in the library.
          </div>
        )}
      </div>
    </div>
  );
};

export default FileUpload;
