'use client';

import React from 'react';

interface SongMetadataProps {
  fileName?: string | null;
  durationSec?: number | null;
  beatsCount?: number | null;
  totalJumpPoints?: number | null;
  currentBeat?: any | null;
  isPlaying?: boolean;
}

const formatTime = (seconds?: number | null) => {
  if (seconds == null || !isFinite(seconds)) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const MetaRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-center justify-between py-2 border-b border-white/10 last:border-b-0">
    <span className="engraved-label">{label}</span>
    <span className="text-white font-medium">{value}</span>
  </div>
);

const SongMetadata: React.FC<SongMetadataProps> = ({
  fileName,
  durationSec,
  beatsCount,
  totalJumpPoints,
  currentBeat,
  isPlaying,
}) => {
  return (
    <section className="cdpanel-inner p-4 sm:p-6">
      <header className="mb-4">
        <h2 className="text-lg font-semibold text-gold-400">Track Info</h2>
        <p className="text-xs text-white/70">Song Details and Playback Status</p>
      </header>
      <div className="space-y-1">
        <MetaRow label="Title" value={fileName || 'Untitled'} />
        <MetaRow label="Duration" value={formatTime(durationSec)} />
        <MetaRow label="Beats" value={beatsCount ?? '--'} />
        <MetaRow label="Total Jump Points" value={totalJumpPoints ?? '--'} />
        <MetaRow
          label="Current Beat"
          value={
            currentBeat
              ? (
                <span className="text-gold-400">
                  #{currentBeat.id} • Cluster {currentBeat.cluster}
                </span>
              )
              : '--'
          }
        />
        <MetaRow
          label="Status"
          value={
            <span className={isPlaying ? 'text-emerald-400' : 'text-white/70'}>
              {isPlaying ? 'Playing' : 'Paused'}
            </span>
          }
        />
      </div>
    </section>
  );
};

export default SongMetadata;