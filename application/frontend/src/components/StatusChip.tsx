'use client';

import React from 'react';
import type { SongStatus } from '@/lib/types';

// §5.3 status chips: Ready gold tonal, Processing primaryContainer pair,
// Failed errorContainer pair. Pending reads as inert metadata.
// Non-interactive status text — no button semantics (§8).
const CHIP_CLASSES: Record<SongStatus, string> = {
  ready: 'chip chip-ready',
  processing: 'chip bg-primary-container text-on-primary-container',
  failed: 'chip bg-error-container text-on-error-container',
  pending: 'chip bg-surface-container-high text-on-surface-variant',
};
const CHIP_LABELS: Record<SongStatus, string> = {
  ready: 'Ready',
  processing: 'Processing',
  failed: 'Failed',
  pending: 'Pending',
};

const StatusChip: React.FC<{ status: SongStatus }> = ({ status }) => (
  <span className={CHIP_CLASSES[status] ?? CHIP_CLASSES.pending}>
    {CHIP_LABELS[status] ?? status}
  </span>
);

export default StatusChip;
