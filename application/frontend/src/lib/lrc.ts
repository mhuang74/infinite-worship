/**
 * LRC parsing for playback sync (issue #60, facts from #51):
 *
 * - Canonical artifact is SOW's curated R2 `lyrics.lrc`, copied into IW's
 *   bucket at import (`media/<song_id>.lrc`, song.lyrics_url) and fetched
 *   client-side like audio/analysis (#55: post-import is SOW-free).
 * - LRC timestamps are on the ORIGINAL recording's timeline — the same bytes
 *   the worker analyzed — so a line maps to playback via the current beat's
 *   `start` (source position), never wall-clock (#51 checklist step 5).
 * - Gap Placeholder lines (SOW ADR-0008) are timestamped lines with empty
 *   text: KEPT and rendered blank so instrumental passages don't show stale
 *   lyrics. The renderer must handle their absence equally well (only
 *   youtube_transcript-sourced LRCs have them today).
 * - Metadata tags (`[ti:…]`, `[ar:…]`, `[offset:…]`, …) are ignored —
 *   including an `[offset:…]` time shift, which SOW's writer never emits.
 * - Validity bar (#51, mirroring SOW's own parser): ≥2 timestamped lines,
 *   else the LRC is unusable for sync and playback runs lyric-less.
 */

/** One timed lyric line. `text === ''` is a Gap Placeholder — render blank. */
export interface LyricLine {
  /** Seconds on the original recording's timeline. */
  time: number;
  text: string;
}

/** One `[mm:ss.xx]` or `[mm:ss.xxx]` timestamp tag, WITHOUT its brackets
 *  (stripped by the leading-tag splitter), in seconds. */
const TIME_RE = /^(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?$/;

/** Metadata tags SOW's writer may emit; never treated as lyric text. The
 *  tag arrives WITHOUT its brackets (stripped by the leading-tag splitter). */
const METADATA_TAG_RE = /^(ti|ar|al|by|offset|length|re|ve):.*$/i;

/**
 * Parse LRC text into sorted timed lines, or null when the content is not
 * usable for sync (fewer than two timestamped lines). Multi-timestamp lines
 * (`[00:01.00][00:04.00] text`) are expanded — each timestamp becomes its
 * own line. Unparseable non-empty lines are dropped, not fatal.
 */
export function parseLrc(text: string): LyricLine[] | null {
  const lines: LyricLine[] = [];
  for (const raw of text.split(/\r\n|\n|\r/)) {
    const trimmed = raw.trim();
    if (trimmed === '') continue;

    // Split leading timestamps off the line; whatever remains is the text.
    let rest = trimmed;
    const stamps: number[] = [];
    for (;;) {
      const match = /^\[([^\]]*)\](.*)$/.exec(rest);
      if (!match) break;
      const tag = match[1];
      const timeMatch = TIME_RE.exec(tag);
      if (timeMatch) {
        const minutes = Number(timeMatch[1]);
        const seconds = Number(timeMatch[2]);
        // 2 digits = centiseconds, 3 = milliseconds (SOW's writer emits 2).
        const fractionRaw = timeMatch[3];
        const fraction = fractionRaw === undefined ? 0 : Number(fractionRaw) / 10 ** fractionRaw.length;
        stamps.push(minutes * 60 + seconds + fraction);
        rest = match[2];
      } else if (METADATA_TAG_RE.test(tag)) {
        rest = match[2];
      } else {
        // Unknown bracketed tag: not a timestamp, not metadata — treat the
        // whole line as lyric text (SOW lyrics may contain bracketed words).
        break;
      }
    }

    if (stamps.length === 0) continue; // plain text / enhanced-word tags: drop
    const textContent = rest.trim();
    for (const time of stamps) lines.push({ time, text: textContent });
  }

  if (lines.length < 2) return null;
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

/**
 * The lyric line sounding at `sourceTime` (seconds on the original
 * recording's timeline), or null before the first line / with no lyrics.
 * The LAST line whose timestamp is ≤ sourceTime wins — an LRC line stays
 * on screen until the next one starts; gap placeholders (empty text) win
 * like any other line, blanking the display.
 */
export function lyricAt(lines: LyricLine[], sourceTime: number): LyricLine | null {
  if (lines.length === 0) return null;
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= sourceTime) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found === -1 ? null : lines[found];
}
