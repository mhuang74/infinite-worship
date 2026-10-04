'use client';

import React from 'react';
import { formatClock } from '@/lib/format';
import type { Beat } from '@/lib/types';

interface SongMetadataProps {
  fileName?: string | null;
  durationSec?: number | null;
  beatsCount?: number | null;
  totalJumpPoints?: number | null;
  currentBeat?: Beat | null;
  isPlaying?: boolean;
  totalPlayingTimeSec?: number | null;
  totalJumps?: number | null;
}

const MetaRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-center justify-between gap-3 border-b border-outline-variant/45 py-2.5 last:border-b-0">
    <span className="text-xs tracking-[0.02em] text-on-surface-variant">{label}</span>
    <span className="flex items-center gap-1.5 text-right text-[13px] font-medium text-on-surface">{value}</span>
  </div>
);

const SongMetadata: React.FC<SongMetadataProps> = ({
  fileName,
  durationSec,
  beatsCount,
  totalJumpPoints,
  currentBeat,
  isPlaying,
  totalPlayingTimeSec,
  totalJumps,
}) => {
  return (
    <section className="rounded-[20px] border border-outline-variant/45 bg-surface-container p-5 hero:px-6">
      <header className="mb-3">
        <h2 className="type-card-title">Track Info</h2>
        <p className="mt-0.5 text-xs text-on-surface-variant">Live from the remix engine</p>
      </header>
      <div>
        <MetaRow label="Title" value={fileName || 'Untitled'} />
        <MetaRow label="Duration" value={formatClock(durationSec)} />
        <MetaRow label="Beats" value={beatsCount ?? '--'} />
        <MetaRow label="Total Jump Points" value={totalJumpPoints ?? '--'} />
        <MetaRow
          label="Current Beat"
          value={
            currentBeat
              ? (
                <span className="text-gold-foreground">
                  #{currentBeat.id} &middot; Cluster {currentBeat.cluster}
                </span>
              )
              : '--'
          }
        />
        <MetaRow label="Total Jumps" value={totalJumps ?? '--'} />
        <MetaRow label="Total Playing Time" value={formatClock(totalPlayingTimeSec)} />
        <MetaRow
          label="Status"
          value={
            <>
              {isPlaying && <span className="live-dot" style={{ width: 7, height: 7 }} aria-hidden="true" />}
              <span className={isPlaying ? '' : 'text-on-surface-variant'}>
                {isPlaying ? 'Remixing' : 'Paused'}
              </span>
            </>
          }
        />
      </div>
    </section>
  );
};

export default SongMetadata;
