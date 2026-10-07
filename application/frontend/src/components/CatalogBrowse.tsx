'use client';

import { useState, useEffect, useCallback } from 'react';
import type React from 'react';
import api from '@/lib/api';
import { formatClock } from '@/lib/format';
import { SOW_CATALOG_BPM_BAND } from '@/lib/catalogBand';
import type { Song } from '@/lib/types';

/**
 * The SOW Song Catalog browse surface (#53 resolution: dedicated Catalog tab,
 * Variant A). Grid of curated cards (artist/duration/BPM/key + first-LRC-line
 * preview), a 60–100 BPM curation filter chip with an All escape, a
 * title/artist search box above the grid, and the "N hidden by the BPM
 * filter" notice with a Show-all reset.
 *
 * Per-song state is joined client-side against the IW library (#52's
 * already-processed badge): an IW Song with `sow_recording_id` equal to the
 * card's content_hash is that catalog song's IW state — Import CTA →
 * in-place Analyzing chip (the gold loading-bar is page-level, under the tab
 * bar) → Play / failed chip with reason.
 */

const BPM_BAND_MIN = SOW_CATALOG_BPM_BAND.min;
const BPM_BAND_MAX = SOW_CATALOG_BPM_BAND.max;

export interface CatalogSong {
  song_id: string;
  title: string;
  title_pinyin: string | null;
  composer: string | null;
  lyricist: string | null;
  album_name: string | null;
  musical_key: string | null;
  content_hash: string;
  hash_prefix: string;
  tempo_bpm: number | null;
  duration_seconds: number | null;
  imported_at: string | null;
  lyrics_preview: string | null;
}

interface CatalogBrowseProps {
  /** The IW library — the already-imported state source. */
  songs: Song[];
  /** Selected Song in the player, if it belongs to the catalog. */
  selectedSongId: string | null;
  /** True while a Song is loading into the player (gold loading-bar). */
  loadingSong: boolean;
  onPlayImported: (song: Song) => void;
  onImport: (catalogSong: CatalogSong) => void;
  /** Content hash whose import request is in flight (CTA shows the wait). */
  importingHash?: string | null;
}

/** IW-side display state of a catalog song, joined from the library. */
type ImportedState =
  | { kind: 'none' }
  | { kind: 'pending' | 'processing' }
  | { kind: 'ready'; song: Song }
  | { kind: 'failed'; song: Song };

const importedStateFor = (contentHash: string, songs: Song[]): ImportedState => {
  const iw = songs.find((s) => s.sow_recording_id === contentHash);
  if (!iw) return { kind: 'none' };
  if (iw.status === 'ready') return { kind: 'ready', song: iw };
  if (iw.status === 'failed') return { kind: 'failed', song: iw };
  return { kind: 'pending' };
};

const inBand = (s: CatalogSong) =>
  s.tempo_bpm !== null && s.tempo_bpm >= BPM_BAND_MIN && s.tempo_bpm <= BPM_BAND_MAX;

/** Artist line: composer is the SOW "artist" slot; lyricist is secondary. */
const artistOf = (s: CatalogSong): string => s.composer ?? s.lyricist ?? s.title_pinyin ?? 'Unknown artist';

const CatalogBrowse: React.FC<CatalogBrowseProps> = ({
  songs,
  selectedSongId,
  loadingSong,
  onPlayImported,
  onImport,
  importingHash,
}) => {
  const [catalog, setCatalog] = useState<CatalogSong[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'band' | 'all'>('band');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setError(null);
        const response = await api.get('/api/catalog');
        if (cancelled) return;
        setCatalog(response.data.songs ?? []);
      } catch (err) {
        console.error('Error fetching catalog:', err);
        if (!cancelled) setError('Failed to load the catalog. Please try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const q = query.trim().toLowerCase();
  const matchesQuery = useCallback(
    (s: CatalogSong) =>
      !q ||
      s.title.toLowerCase().includes(q) ||
      (s.composer ?? '').toLowerCase().includes(q) ||
      (s.lyricist ?? '').toLowerCase().includes(q) ||
      (s.title_pinyin ?? '').toLowerCase().includes(q),
    [q],
  );

  const visible = catalog.filter((s) => matchesQuery(s) && (filter === 'all' || inBand(s)));
  // Query matches the BPM chip excludes must be counted, not silently
  // swallowed — an empty grid reads as "not in the catalog" otherwise (#53
  // amendment 2). Only surfaced when a query is active.
  const queryMatches = q ? catalog.filter(matchesQuery) : [];
  const hiddenByFilter =
    q && filter === 'band' ? queryMatches.filter((s) => !inBand(s)).length : 0;

  const showInitialLoading = loading && catalog.length === 0;
  const showEnabled = !loading;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-2">
        <div className="text-[13px] font-semibold uppercase tracking-[0.04em] text-on-surface-variant">
          Catalog · {visible.length} songs
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFilter('band')}
            className={`chip ${filter === 'band' ? 'chip-ready' : 'bg-surface-container-high text-on-surface-variant'}`}
          >
            {BPM_BAND_MIN}–{BPM_BAND_MAX} BPM
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

      {showEnabled && (
        <div className="px-3 pb-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search catalog (title, artist)…"
            className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3.5 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/70 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-gold-foreground"
          />
        </div>
      )}

      {showEnabled && hiddenByFilter > 0 && (
        <p className="px-3 pb-2 text-xs text-on-surface-variant">
          {hiddenByFilter} {hiddenByFilter === 1 ? 'song' : 'songs'} hidden by the BPM filter.{' '}
          <button
            type="button"
            onClick={() => setFilter('all')}
            className="text-gold-foreground underline decoration-2 underline-offset-4"
          >
            Show all
          </button>
        </p>
      )}

      {showInitialLoading && <p className="px-3 py-2 text-sm text-on-surface-variant">Loading catalog…</p>}

      {error && (
        <div className="banner-error mx-3 mt-2" role="alert">
          {error}
        </div>
      )}

      {showEnabled && !error && catalog.length === 0 && (
        <p className="px-3 py-2 text-sm text-on-surface-variant">The catalog is empty right now.</p>
      )}

      {showEnabled && catalog.length > 0 && visible.length === 0 && q.length > 0 && hiddenByFilter === 0 && (
        <p className="px-3 pb-2 text-sm text-on-surface-variant">No catalog songs match &quot;{query.trim()}&quot;.</p>
      )}

      {showEnabled && visible.length > 0 && (
        <div className="grid max-h-[420px] grid-cols-1 gap-2 overflow-y-auto p-1 sm:grid-cols-2">
          {visible.map((song) => {
            const open = openId === song.content_hash;
            const state = importedStateFor(song.content_hash, songs);
            const isCurrent = state.kind === 'ready' && state.song.song_id === selectedSongId;
            return (
              <div
                key={song.content_hash}
                className={`rounded-[16px] border border-outline-variant/45 bg-surface-container-lowest p-3 transition-colors duration-150`}
              >
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : song.content_hash)}
                  aria-expanded={open}
                  className="flex w-full items-start justify-between gap-3 text-left"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[14.5px] font-medium text-on-surface">{song.title}</div>
                    <div className="mt-0.5 truncate text-xs text-on-surface-variant">
                      {artistOf(song)} · {formatClock(song.duration_seconds)}
                      {song.tempo_bpm !== null && ` · ${Math.round(song.tempo_bpm)} BPM`}
                      {song.musical_key && ` · ${song.musical_key}`}
                    </div>
                  </div>
                  {state.kind !== 'none' && (
                    <span className="chip shrink-0 bg-surface-container-high text-on-surface-variant">In IW</span>
                  )}
                </button>

                {open && (
                  <div className="mt-3 border-t border-outline-variant/30 pt-3">
                    {state.kind === 'none' && (
                      <div className="flex items-center justify-between gap-3">
                        <p className="min-w-0 text-xs text-on-surface-variant">
                          {song.lyrics_preview ?? 'No synced lyrics preview available.'}
                        </p>
                        <button
                          type="button"
                          onClick={() => onImport(song)}
                          disabled={importingHash === song.content_hash}
                          className="chip chip-ready shrink-0"
                        >
                          {importingHash === song.content_hash ? (
                            <span className="flex items-center gap-2">
                              <span className="h-3 w-3 animate-spin rounded-full border-2 border-on-surface-variant/30 border-t-on-surface-variant" />
                              Importing…
                            </span>
                          ) : (
                            'Import'
                          )}
                        </button>
                      </div>
                    )}
                    {(state.kind === 'pending' || state.kind === 'processing') && (
                      <div className="flex h-5 items-center gap-2.5 text-xs text-on-surface-variant">
                        <div className="h-3 w-3 animate-spin rounded-full border-2 border-on-surface-variant/30 border-t-on-surface-variant" />
                        Analyzing — this space becomes the play button
                      </div>
                    )}
                    {state.kind === 'ready' && (
                      <button
                        type="button"
                        onClick={() => onPlayImported(state.song)}
                        className={`chip chip-ready ${isCurrent ? 'opacity-70' : ''}`}
                      >
                        {isCurrent ? 'Loaded — play from the controls above' : 'Play endless remix'}
                      </button>
                    )}
                    {state.kind === 'failed' && (
                      <div className="text-xs text-error">
                        Analysis failed{state.song.failure_reason ? `: ${state.song.failure_reason}` : '.'}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* In-place wait treatment (#53): the gold loading-bar under the
          section, driven by the same song-load state as the library tab. */}
      {loadingSong && <div className="loading-bar mx-3 mt-3" />}
    </div>
  );
};

export default CatalogBrowse;