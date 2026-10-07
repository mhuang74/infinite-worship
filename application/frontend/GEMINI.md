# Infinite Worship — Frontend + BFF

Next.js App Router single-page app on Vercel: the UI in `src/app/page.tsx` owns all state; `src/app/api/` routes are the BFF (uploads presign, songs list/search, finalize → SQS); `src/lib/` holds `audio.ts` (Web Audio `AudioEngine`), `player.ts` (direct R2 blob + Analysis JSON + LRC lyrics loading), `upload.ts` (client-side song_id + presign-then-PUT), `r2.ts` presigning, `db.ts` Neon pool, `types.ts` shared types.

The analysis pipeline lives in `worker/` (Python Lambda, SQS-triggered); infra is Terraform under `infra/`. See root `README.md`, `AGENTS.md`, and `docs/adr/`.

## Conventions

- TypeScript strict; path alias `@/*` → `src/*`; camelCase.
- React function components, `'use client'`, all state via hooks in `page.tsx`, Tailwind utility classes inline, `useCallback`/`useRef` for engine refs.
- Errors: try/catch/finally with `console.error` + user-facing error state; BFF routes return JSON `{error}` with 4xx/5xx.
- Async: async/await + `fetch` (axios is legacy); audio scheduling via 100 ms-lookahead loops on the Web Audio clock; status polling via `setInterval`.
- No state library, no test framework; QA is `npm run lint` + `npx tsc --noEmit` plus exercising the dev server.
