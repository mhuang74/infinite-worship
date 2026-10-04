'use client';

import React, { useRef } from 'react';

const APP_DESCRIPTION = 'Infinite Worship uses song and audio characteristics to detect smooth transition points for endless remixing. Currently limited to within a song. The ultimate goal is to smoothly transition between songs!';

// §7 brand mark: gold-gradient squircle + geometric cross, glowing. The
// gradient/glow live here (CSS); src/app/icon.svg carries the same art for
// the favicon.
const Logo: React.FC = () => (
  <div className="logo-squircle" aria-hidden="true">
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="M13.2 3.2h-2.4v6.4H4.4v2.4h6.4v8.8h2.4V12h6.4V9.6h-6.4V3.2z" fill="#3A2800" />
    </svg>
  </div>
);

const Header: React.FC = () => {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <header className="flex items-center justify-center gap-3 sm:justify-start sm:gap-4">
      <Logo />
      <div className="text-left">
        <h1 className="type-headline">Infinite Worship</h1>
        <p className="mt-0.5 text-[13px] text-on-surface-variant">
          A seamless, endless remix of your favorite worship songs
        </p>
      </div>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="ml-1 grid h-9 w-9 flex-none place-items-center rounded-full text-on-surface-variant transition-colors duration-200 hover:bg-on-surface/10 hover:text-on-surface"
        aria-label="About Infinite Worship"
        title="About Infinite Worship"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 15.5a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zM12 6c-1.93 0-3.5 1.57-3.5 3.5h2c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5c0 .9-1.02 1.36-1.7 1.9-.83.66-1.3 1.35-1.3 2.6h2c0-.9.47-1.36 1.15-1.86.83-.61 1.85-1.32 1.85-3.14 0-1.93-1.57-3.5-3.5-3.5z" />
        </svg>
      </button>

      {/* MD3 dialog (§5.1) — native <dialog>: Escape dismisses, backdrop
          click handled below. */}
      <dialog
        ref={dialogRef}
        className="info-dialog"
        aria-label="About Infinite Worship"
        onClick={(e) => {
          // Outside-click dismiss: clicks on the backdrop target the <dialog>
          // element itself; clicks inside target its children.
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        <h2 className="type-card-title mb-3">About Infinite Worship</h2>
        <p className="text-sm leading-relaxed text-on-surface-variant">{APP_DESCRIPTION}</p>
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="h-10 rounded-full bg-brand-gold px-6 text-sm font-semibold text-on-gold transition-opacity duration-200 hover:opacity-90"
          >
            Close
          </button>
        </div>
      </dialog>
    </header>
  );
};

export default Header;
