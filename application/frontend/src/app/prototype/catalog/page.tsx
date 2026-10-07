'use client';

// PROTOTYPE — throwaway (wayfinder ticket #53, map #48). Not production.
// Question: how does a user find and pick a curated SOW song in IW?
// Three structurally different variants, switchable via ?variant= on
// /prototype/catalog: A (Catalog tab page), B (merged library + origin
// filter), C (search-first). Read-only: mock data + canned status
// transitions; Import = picks the song and demos the per-state treatment.
// Trivial to run: `cd application/frontend && npm run dev`, then open
// http://localhost:3000/prototype/catalog

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { formatClock } from '@/lib/format';
import { CATALOG_SEED } from '@/lib/catalogSeed';
import type { CatalogSong } from '@/lib/catalogSeed';

const VARIANTS = [
  { key: 'A', name: 'Catalog tab page' },
  { key: 'B', name: 'Merged library + filter' },
  { key: 'C', name: 'Search-first' },
] as const;

type VariantKey = (typeof VARIANTS)[number]['key'];

function VariantA({ songs, onImport, pending }: VariantProps) {
  // Dedicated catalog surface: dense grid of richer cards — the browse
  // destination, not a list afterthought. Filter chip = the BPM curation.
  const [filter, setFilter] = useState<'all' | '60-100'>('60-100');
  const [openId, setOpenId] = useState<string | null>(null);
  const visible = songs.filter((s) => (filter === 'all' ? true : s.tempo_bpm !== null && s.tempo_bpm >= 60 && s.tempo_bpm <= 100));

  return (
    <div>
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-2">
        <div className="text-[13px] font-semibold uppercase tracking-[0.04em] text-on-surface-variant">
          Catalog · {visible.length} songs
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFilter('60-100')}
            className={`chip ${filter === '60-100' ? 'chip-ready' : 'bg-surface-container-high text-on-surface-variant'}`}
          >
            60–100 BPM
          </button>
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`chip ${filter === 'all' ? 'chip-ready' : 'bg-surface-container-high text-on-surface-variant'}`}
          >
            All
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 p-1 sm:grid-cols-2">
        {visible.map((song) => {
          const open = openId === song.song_id;
          const importState = song.imported_status;
          return (
            <div
              key={song.song_id}
              className={`rounded-[16px] border p-3 transition-colors duration-150 ${
                importState === 'selected' ? 'border-primary/60 bg-primary/[0.14]' : 'border-outline-variant/45 bg-surface-container-lowest'
              }`}
            >
              <button
                type="button"
                onClick={() => setOpenId(open ? null : song.song_id)}
                className="flex w-full items-start justify-between gap-3 text-left"
              >
                <div className="min-w-0">
                  <div className="truncate text-[14.5px] font-medium text-on-surface">{song.title}</div>
                  <div className="mt-0.5 truncate text-xs text-on-surface-variant">
                    {song.artist} · {formatClock(song.duration_seconds)}
                    {song.tempo_bpm !== null && ` · ${Math.round(song.tempo_bpm)} BPM`}
                    {song.musical_key && ` · ${song.musical_key}`}
                  </div>
                </div>
                {importState === 'selected' && <span className="chip bg-surface-container-high text-on-surface-variant">In IW</span>}
              </button>

              {open && (
                <div className="mt-3 border-t border-outline-variant/30 pt-3">
                  {importState === null && (
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-on-surface-variant">
                        {song.lyrics_preview ?? 'No synced lyrics preview available.'}
                      </p>
                      <button
                        type="button"
                        onClick={() => onImport(song.song_id)}
                        disabled={pending}
                        className="chip chip-ready disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Import
                      </button>
                    </div>
                  )}
                  {importState === 'selected' && (
                    <div className="flex h-5 items-center gap-2.5 text-xs text-on-surface-variant">
                      <div className="h-3 w-3 animate-spin rounded-full border-2 border-on-surface-variant/30 border-t-on-surface-variant" />
                      Analyzing — this space becomes the play button
                    </div>
                  )}
                  {importState === 'ready' && (
                    <button
                      type="button"
                      onClick={() => onImport(song.song_id)}
                      className="chip chip-ready"
                    >
                      Play endless remix
                    </button>
                  )}
                  {importState === 'failed' && (
                    <div className="text-xs text-error">Analysis failed: {song.failure_reason}</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VariantB({ songs, onImport, pending }: VariantProps) {
  // No new surface: catalog rows merge into the familiar compact library
  // list (same shape as SongLibrary rows) with an origin badge, pushed to
  // the top so "already in IW" answers dedupe at a glance.
  const rows = [...songs].sort((a, b) => (a.imported_status ? 0 : 1) - (b.imported_status ? 0 : 1));
  return (
    <div>
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-2">
        <div className="text-[13px] font-semibold uppercase tracking-[0.04em] text-on-surface-variant">
          Library · catalog picks inline
        </div>
        <button type="button" className="chip bg-surface-container-high text-on-surface-variant" onClick={() => {}}>
          Filter: All
        </button>
      </div>
      <div className="mt-1 max-h-[420px] space-y-1 overflow-y-auto p-1">
        {rows.map((song) => {
          const importState = song.imported_status;
          const selected = importState === 'selected';
          return (
            <button
              type="button"
              key={song.song_id}
              onClick={() => onImport(song.song_id)}
              disabled={importState !== null && importState !== 'ready'}
              aria-current={selected ? 'true' : undefined}
              className={`flex w-full items-center justify-between gap-4 rounded-[14px] px-3 py-3 text-left transition-colors duration-150 ${
                selected ? 'bg-primary/[0.14]' : 'hover:bg-on-surface/[0.06]'
              } disabled:cursor-not-allowed`}
            >
              <div className="min-w-0">
                <div className="truncate text-[14.5px] font-medium text-on-surface">{song.title}</div>
                <div className="mt-0.5 truncate text-xs text-on-surface-variant">
                  {formatClock(song.duration_seconds)}
                  {song.tempo_bpm !== null && ` · ${Math.round(song.tempo_bpm)} BPM`}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {importState === null && <span className="chip bg-surface-container-high text-on-surface-variant">Catalog</span>}
                {importState === 'selected' && (
                  <span className="chip bg-primary-container text-on-primary-container">
                    <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-on-primary-container" />
                    Analyzing
                  </span>
                )}
                {importState === 'ready' && <span className="chip chip-ready">Ready · Play</span>}
                {importState === 'failed' && (
                  <span className="chip bg-error-container text-on-error-container">Failed</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      {pending && <div className="loading-bar mx-3 mt-3" />}
    </div>
  );
}

function VariantC({ songs, onImport, pending }: VariantProps) {
  // Search-first: zero browsing chrome until you type; results are grouped
  // into IW (ready, playable) and Catalog (import CTA) — the answer to
  // "same song in both places" is the grouping itself.
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const results = songs.filter(
    (s) => q === '' || s.title.toLowerCase().includes(q) || (s.artist ?? '').toLowerCase().includes(q)
  );
  const iw = results.filter((s) => s.imported_status === 'ready' || s.imported_status === 'failed');
  const catalog = results.filter((s) => s.imported_status === null || s.imported_status === 'selected');

  return (
    <div>
      <div className="relative px-3 pb-2 pt-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search worship songs…"
          className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3.5 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/70 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-gold-foreground"
        />
      </div>

      {iw.length > 0 && (
        <Group title={`In Infinite Worship (${iw.length})`}>
          {iw.map((song) => (
            <button
              type="button"
              key={song.song_id}
              onClick={() => onImport(song.song_id)}
              className="flex w-full items-center justify-between gap-4 rounded-[14px] px-3 py-3 text-left transition-colors duration-150 hover:bg-on-surface/[0.06]"
            >
              <div className="min-w-0">
                <div className="truncate text-[14.5px] font-medium text-on-surface">{song.title}</div>
                <div className="mt-0.5 truncate text-xs text-on-surface-variant">
                  {song.imported_status === 'failed' ? `Failed: ${song.failure_reason}` : 'Ready to play'}
                </div>
              </div>
              {song.imported_status === 'ready' && <span className="chip chip-ready">Play</span>}
              {song.imported_status === 'failed' && <span className="chip bg-error-container text-on-error-container">Failed</span>}
            </button>
          ))}
        </Group>
      )}

      {catalog.length > 0 && (
        <Group title={`Catalog (${catalog.length})`}>
          {catalog.map((song) => (
            <button
              type="button"
              key={song.song_id}
              onClick={() => onImport(song.song_id)}
              disabled={song.imported_status === 'selected'}
              className="flex w-full items-center justify-between gap-4 rounded-[14px] px-3 py-3 text-left transition-colors duration-150 hover:bg-on-surface/[0.06] disabled:cursor-not-allowed"
            >
              <div className="min-w-0">
                <div className="truncate text-[14.5px] font-medium text-on-surface">{song.title}</div>
                <div className="mt-0.5 truncate text-xs text-on-surface-variant">
                  {song.artist} · {formatClock(song.duration_seconds)}
                  {song.tempo_bpm !== null && ` · ${Math.round(song.tempo_bpm)} BPM`}
                </div>
              </div>
              {song.imported_status === null && (
                <span className="chip bg-surface-container-high text-on-surface-variant">Import</span>
              )}
              {song.imported_status === 'selected' && (
                <span className="chip bg-primary-container text-on-primary-container">Analyzing…</span>
              )}
            </button>
          ))}
        </Group>
      )}

      {results.length === 0 && (
        <p className="px-3 py-2 text-sm text-on-surface-variant">No songs match &quot;{query}&quot;.</p>
      )}
      {pending && <div className="loading-bar mx-3 mt-3" />}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-2">
      <div className="px-3 pb-1 pt-2 text-[13px] font-semibold uppercase tracking-[0.04em] text-on-surface-variant">{title}</div>
      <div className="space-y-1 p-1">{children}</div>
    </div>
  );
}

interface VariantProps {
  songs: CatalogSong[];
  onImport: (songId: string) => void;
  pending: boolean;
}

function CatalogPrototypePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const variant = (searchParams.get('variant') ?? 'A') as VariantKey;

  // Mock song state, seeded from a SOW-like shape (#50 display cols + #52
  // imported_status). Import walks a song through selected → ready (never
  // leaves the list — polling happens in place, as #53 asks).
  const [songs, setSongs] = useState<CatalogSong[]>(CATALOG_SEED);
  const [pending, setPending] = useState(false);

  const cycle = useCallback(
    (dir: 1 | -1) => {
      const i = VARIANTS.findIndex((v) => v.key === variant);
      const next = VARIANTS[(i + dir + VARIANTS.length) % VARIANTS.length].key;
      router.replace(`/prototype/catalog?variant=${next}`);
    },
    [variant, router]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      if (e.key === 'ArrowLeft') cycle(-1);
      if (e.key === 'ArrowRight') cycle(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cycle]);

  const handleImport = (songId: string) => {
    const song = songs.find((s) => s.song_id === songId);
    if (!song || song.imported_status === 'selected') return;
    if (song.imported_status === 'ready') {
      // In the real app this selects + plays. Prototype: surface the state.
      setSongs((prev) => prev.map((s) => (s.song_id === songId ? { ...s, imported_status: 'ready' } : s)));
      return;
    }
    setSongs((prev) => prev.map((s) => (s.song_id === songId ? { ...s, imported_status: 'selected' } : s)));
    setPending(true);
    // Canned analysis completion: ~5s of "pending" polling, then ready.
    window.setTimeout(() => {
      setSongs((prev) =>
        prev.map((s) =>
          s.song_id === songId && s.imported_status === 'selected'
            ? {
                ...s,
                imported_status: song.song_id === 'sow_4' ? 'failed' : 'ready',
                failure_reason: song.song_id === 'sow_4' ? 'Demo failure: analysis pipeline error' : undefined,
              }
            : s
        )
      );
    }, 5000);
  };

  const current = VARIANTS.find((v) => v.key === variant) ?? VARIANTS[0];

  return (
    <main className="min-h-screen w-full px-4 py-8">
      <div className="relative mx-auto w-full max-w-[1080px] space-y-6">
        <div className="rounded-[20px] border border-outline-variant/45 bg-surface-container-low p-3">
          {variant === 'A' && <VariantA songs={songs} onImport={handleImport} pending={pending} />}
          {variant === 'B' && <VariantB songs={songs} onImport={handleImport} pending={pending} />}
          {variant === 'C' && <VariantC songs={songs} onImport={handleImport} pending={pending} />}
        </div>
      </div>

      {process.env.NODE_ENV !== 'production' && (
        <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-surface-container-highest px-4 py-2.5 shadow-[0_4px_16px_rgba(0,0,0,0.4)]">
          <button type="button" onClick={() => cycle(-1)} aria-label="Previous variant" className="text-on-surface-variant hover:text-on-surface">
            ←
          </button>
          <span className="text-xs font-semibold text-on-surface">
            {current.key} · {current.name}
          </span>
          <button type="button" onClick={() => cycle(1)} aria-label="Next variant" className="text-on-surface-variant hover:text-on-surface">
            →
          </button>
        </div>
      )}
    </main>
  );
}

export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <CatalogPrototypePage />
    </React.Suspense>
  );
}
