'use client';

// PROTOTYPE — throwaway. Not production.
// Question: what branding should Zen Mode's footer carry (fullscreen
// sessions should show whose player it is)? The REAL ZenMode component is
// rendered with fake beats so the footer is judged in true composition
// (ring painted by src/lib/zen/draw.ts, lyric-less, no audio).
// Three footer treatments, switchable via ?variant= on
// /prototype/zen-brand:
//   A — wordmark only, bottom-center (gold ∞ prefix + Fraunces wordmark)
//   B — icon + wordmark, bottom-center
//   C — wordmark pinned bottom-right (balances the top-right ✕/⏸ cluster)
// All variants: pointer-events-none, NOT tied to the ✕ auto-hide timer —
// branding persists through the 3s idle cycle.
// Trivial to run: `cd application/frontend && npm run dev`, then open
// http://localhost:3000/prototype/zen-brand

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ZenMode from '@/components/ZenMode';
import type { Beat } from '@/lib/types';

const VARIANTS = [
  { key: 'A', name: 'Wordmark only · bottom-center' },
  { key: 'B', name: 'Icon + wordmark · bottom-center' },
  { key: 'C', name: 'Wordmark · bottom-right corner' },
] as const;

type VariantKey = (typeof VARIANTS)[number]['key'];

/** ~24 synthetic beats: cluster cycles 0–5, plausible starts/durations. */
const FAKE_BEATS: Beat[] = Array.from({ length: 24 }, (_, i) => ({
  id: i,
  start: i * 0.5 + i * 0.02, // slight swing so beats are not perfectly uniform
  duration: 0.5,
  cluster: i % 6,
  segment: Math.floor(i / 6),
  jump_candidates: [i % 6, (i + 6) % 24, (i + 12) % 24].filter((c) => c !== i),
}));

/**
 * Shared footer baseline: muted, ≤16px, never brighter than
 * text-on-surface-variant; pointer-events-none so the overlay's
 * tap/double-tap handling owns the whole surface.
 */
const FOOTER_BASE =
  'pointer-events-none absolute z-[60] select-none text-on-surface-variant';

function FooterA() {
  return (
    <div className={`${FOOTER_BASE} inset-x-0 bottom-3 flex justify-center`}>
      <span className="type-card-title" style={{ fontSize: 15, opacity: 0.6 }}>
        <span className="text-gold-foreground" style={{ opacity: 0.75 }} aria-hidden="true">
          ∞&nbsp;
        </span>
        Infinite Worship
      </span>
    </div>
  );
}

function FooterB() {
  return (
    <div className={`${FOOTER_BASE} inset-x-0 bottom-3 flex items-center justify-center gap-1.5`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static local icon, no optimization needed (prototype) */}
      <img src="/icon.svg" width={20} height={20} alt="" aria-hidden="true" style={{ opacity: 0.55 }} />
      <span className="type-card-title" style={{ fontSize: 15, opacity: 0.6 }}>
        Infinite Worship
      </span>
    </div>
  );
}

function FooterC() {
  return (
    <div className={`${FOOTER_BASE} bottom-3 right-4`}>
      <span className="type-card-title" style={{ fontSize: 15, opacity: 0.6 }}>
        <span className="text-gold-foreground" style={{ opacity: 0.75 }} aria-hidden="true">
          ∞&nbsp;
        </span>
        Infinite Worship
      </span>
    </div>
  );
}

function ZenBrandPrototypePage() {
  const router = useRouter();
  const params = useSearchParams();
  const variant = (VARIANTS.find((v) => v.key === params.get('variant'))?.key ?? 'A') as VariantKey;
  // Default: playing composition (no paused overlay dimming everything —
  // the footer must be judged at its real contrast). ?paused=1 shows the
  // paused state instead.
  const paused = params.get('paused') === '1';

  const cycle = (dir: 1 | -1) => {
    const i = VARIANTS.findIndex((v) => v.key === variant);
    const next = VARIANTS[(i + dir + VARIANTS.length) % VARIANTS.length].key;
    router.replace(`/prototype/zen-brand?variant=${next}${paused ? '&paused=1' : ''}`);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') cycle(-1);
      if (e.key === 'ArrowRight') cycle(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const footer = useMemo(() => {
    if (variant === 'A') return <FooterA />;
    if (variant === 'B') return <FooterB />;
    return <FooterC />;
  }, [variant]);

  const current = VARIANTS.find((v) => v.key === variant) ?? VARIANTS[0];
  const switcher = process.env.NODE_ENV !== 'production' && (
    <div className="fixed bottom-14 left-4 z-[60] flex items-center gap-2 rounded-full bg-surface-container-highest/90 px-3 py-2 shadow-[0_4px_16px_rgba(0,0,0,0.4)]">
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
  );

  // The production cutover renders the footer INSIDE ZenMode's overlay div
  // (fixed z-50 stacking context) — so the prototype does the same: portal
  // the variant footer into the overlay after mount. Keeping it as a sibling
  // renders identically in a real browser but headless capture misses it
  // (compositor layer quirk), and inside-overlay is the true composition.
  const footerHostRef = useRef<HTMLDivElement | null>(null);
  const switcherHostRef = useRef<HTMLDivElement | null>(null);
  const [overlay, setOverlay] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setOverlay(document.querySelector<HTMLElement>('[role="dialog"]'));
  }, []);
  useEffect(() => {
    if (!overlay || !footerHostRef.current) return;
    const foot = footerHostRef.current;
    overlay.appendChild(foot);
    const sw = switcherHostRef.current;
    if (sw) overlay.appendChild(sw);
    return () => { foot.remove(); sw?.remove(); };
  }, [overlay, variant]);

  // The REAL ZenMode, mounted with fake data: ring renders from draw.ts,
  // playback never runs (no audio), callbacks are no-ops. isPlaying: true
  // keeps the paused overlay out of the contrast judgment (?paused=1 flips it).
  return (
    <>
      <ZenMode
        beats={FAKE_BEATS}
        currentBeat={FAKE_BEATS[0]}
        jumps={[]}
        jumpEpoch={0}
        beatPlayCounts={undefined}
        lyrics={null}
        isPlaying={!paused}
        onTogglePlayback={() => {}}
        onJumpToBeat={() => {}}
        onExit={() => {}}
      />
      {/* Portal host: the variant footer moves INTO the overlay on mount. */}
      <div ref={footerHostRef} data-variant={variant}>{footer}</div>
      <div ref={switcherHostRef}>{switcher}</div>
    </>
  );
}

export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <ZenBrandPrototypePage />
    </React.Suspense>
  );
}