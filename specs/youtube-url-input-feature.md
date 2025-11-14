# YouTube URL Input Feature - Design Specification

**Document Version:** 1.0
**Date:** 2025-11-14
**Status:** Draft

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current System Analysis](#current-system-analysis)
3. [Feature Requirements](#feature-requirements)
4. [Technical Design](#technical-design)
5. [UI/UX Design](#uiux-design)
6. [Backend Architecture](#backend-architecture)
7. [Security & Legal Considerations](#security--legal-considerations)
8. [Implementation Plan](#implementation-plan)
9. [Testing Strategy](#testing-strategy)
10. [Risks and Mitigations](#risks-and-mitigations)
11. [Future Enhancements](#future-enhancements)

---

## Executive Summary

### Goal
Enable users to analyze songs from YouTube by simply pasting a YouTube URL, eliminating the need to manually download and upload audio files.

### Value Proposition
- **Improved UX**: Reduce friction from 3 steps (download, save, upload) to 1 step (paste URL)
- **Faster Access**: Users can analyze songs in ~30 seconds instead of 2-3 minutes
- **Mobile Friendly**: Easier on mobile devices where file management is cumbersome
- **Discovery**: Users can immediately analyze songs they discover on YouTube

### Key Challenges
- YouTube audio extraction (legal and technical)
- Rate limiting and quota management
- Error handling for unavailable/restricted videos
- Server resource management for extraction process

---

## Current System Analysis

### Current Upload Flow

```
User selects file → FileUpload.tsx creates FormData → POST /upload
    ↓
Backend receives file → Save to disk → Generate song_id (base64 + SHA256)
    ↓
Check cache → Remixatron analysis (beats, clusters, jumps)
    ↓
Save to SQLite → Cache results → Return segments JSON
```

**Key Files:**
- Frontend: `application/frontend/src/components/FileUpload.tsx`
- Backend: `application/backend/app.py` (POST /upload endpoint, line 56)
- Analysis: `application/backend/Remixatron.py` (InfiniteJukebox class)
- Storage: `application/backend/song_mapper.py` (SQLite operations)

### Current Limitations
1. Users must have audio files locally
2. Requires knowledge of YouTube-to-MP3 tools
3. Mobile users face difficulty with file management
4. Friction in the discovery-to-analysis flow

---

## Feature Requirements

### Functional Requirements

#### FR1: YouTube URL Input
- **FR1.1**: Accept YouTube video URLs in standard formats:
  - `https://www.youtube.com/watch?v=VIDEO_ID`
  - `https://youtu.be/VIDEO_ID`
  - `https://m.youtube.com/watch?v=VIDEO_ID`
  - Support URLs with timestamps: `?t=123` (ignored during extraction)
  - Support playlist URLs: extract single video only
- **FR1.2**: Validate URL format before submission
- **FR1.3**: Extract video metadata (title, duration, thumbnail)
- **FR1.4**: Show preview information before confirming extraction

#### FR2: Audio Extraction
- **FR2.1**: Download audio from YouTube video
- **FR2.2**: Convert to supported format (MP3, preferably 128-256 kbps)
- **FR2.3**: Handle videos up to 30 minutes (configurable limit)
- **FR2.4**: Use existing cache if video was previously extracted

#### FR3: Progress Feedback
- **FR3.1**: Show extraction progress (downloading, converting, analyzing)
- **FR3.2**: Display estimated time remaining
- **FR3.3**: Allow cancellation during extraction
- **FR3.4**: Show clear error messages for failures

#### FR4: Existing File Upload Support
- **FR4.1**: Maintain existing file upload functionality
- **FR4.2**: Provide clear UI to choose between URL or file upload
- **FR4.3**: Support both methods interchangeably

### Non-Functional Requirements

#### NFR1: Performance
- Total time from URL submission to playback ready: < 90 seconds
- Extraction timeout: 60 seconds max
- Concurrent extractions: Limit to 3 simultaneous requests

#### NFR2: Reliability
- Graceful degradation if YouTube extraction fails
- Automatic retry with exponential backoff (1 retry)
- Clear error messages for all failure scenarios

#### NFR3: Security
- Rate limiting: 10 extractions per IP per hour
- URL validation to prevent SSRF attacks
- File size limits: 50MB max download
- Sanitize video metadata before storage

#### NFR4: Legal Compliance
- Display terms of use notice
- Log extraction requests for audit
- Respect YouTube's Terms of Service
- Only allow audio extraction (no video)
- Personal use disclaimer

#### NFR5: Maintainability
- Use well-maintained extraction library
- Implement circuit breaker pattern
- Comprehensive logging
- Health check for extraction service

---

## Technical Design

### Technology Stack

#### Option A: yt-dlp (Recommended)
**Pros:**
- Actively maintained fork of youtube-dl
- Robust error handling
- Supports 1000+ sites (not just YouTube)
- Python library with CLI
- Excellent format selection
- Regular updates to bypass restrictions

**Cons:**
- Large dependency (~3MB)
- External process execution
- Potential for breaking changes

**Installation:**
```bash
pip install yt-dlp
```

#### Option B: pytube
**Pros:**
- Pure Python implementation
- Smaller footprint
- Simpler API

**Cons:**
- Frequently breaks with YouTube changes
- Less actively maintained
- Limited format options
- No support for non-YouTube sites

**Decision: Use yt-dlp** due to superior reliability and maintenance.

### Architecture Components

```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend                             │
├─────────────────────────────────────────────────────────────┤
│  FileUpload.tsx (Enhanced)                                   │
│  ├─ File Upload Tab (existing)                               │
│  └─ YouTube URL Tab (new)                                    │
│      ├─ URL Input Field                                      │
│      ├─ Video Preview Component                              │
│      └─ Extract Button                                       │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ POST /extract-youtube
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      Backend (Flask)                         │
├─────────────────────────────────────────────────────────────┤
│  New Endpoint: POST /extract-youtube                         │
│  ├─ Validate URL                                             │
│  ├─ Check cache (by video ID)                                │
│  ├─ Rate limit check                                         │
│  └─ Queue extraction job                                     │
│                                                               │
│  New Module: youtube_extractor.py                            │
│  ├─ extract_audio(url) → file_path                           │
│  ├─ get_video_info(url) → metadata                           │
│  ├─ validate_url(url) → video_id                             │
│  └─ cleanup_temp_files()                                     │
│                                                               │
│  Enhanced: app.py                                            │
│  └─ Reuse existing upload analysis flow                     │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ yt-dlp extraction
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    External Services                         │
├─────────────────────────────────────────────────────────────┤
│  YouTube CDN                                                 │
│  └─ Audio stream download                                   │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

```
1. User pastes URL → Frontend validates format
                   ↓
2. POST /extract-youtube { url, user_ip }
                   ↓
3. Backend validates URL → Extract video_id
                   ↓
4. Check cache: uploads/{video_id}_*.mp3 exists?
   YES → Skip to step 8
   NO → Continue to step 5
                   ↓
5. Check rate limit (10/hour per IP)
                   ↓
6. yt-dlp extracts audio:
   - Download best audio stream
   - Convert to MP3 (128kbps)
   - Save to temp directory
                   ↓
7. Move to uploads/ with song_id = video_id + hash
                   ↓
8. Reuse existing analysis pipeline:
   - Check beat cache
   - Run Remixatron if needed
   - Save to database
   - Cache results
                   ↓
9. Return segments JSON to frontend
                   ↓
10. Frontend loads audio and starts playback
```

### Caching Strategy

**Cache Key**: YouTube video ID (11 characters)

**Cache Layers:**
1. **Extraction Cache**: Store downloaded MP3 by video ID
   - Location: `uploads/yt_{video_id}.mp3`
   - TTL: Indefinite (until manual cleanup)
   - Check: If file exists, skip extraction

2. **Analysis Cache**: Existing Remixatron caches
   - Beat cache: `{file_path}_beats.npy`
   - Jukebox cache: `{file_path}_jukebox.pkl.gz`

3. **Metadata Cache**: Video info (title, duration, thumbnail)
   - Location: `uploads/yt_metadata_{video_id}.json`
   - TTL: 7 days
   - Reduces API calls to YouTube

**Cache Invalidation:**
- Manual cleanup script for old files (>30 days)
- LRU eviction if storage exceeds 10GB

### Rate Limiting

**Strategy**: Token Bucket Algorithm

**Limits:**
- Per IP: 10 extractions per hour
- Global: 100 extractions per hour (to protect server resources)
- Burst allowance: 3 immediate requests, then throttle

**Implementation:**
```python
# Use Flask-Limiter
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

limiter = Limiter(
    app,
    key_func=get_remote_address,
    default_limits=["100 per hour"],
    storage_uri="memory://"
)

@app.route('/extract-youtube', methods=['POST'])
@limiter.limit("10 per hour")
def extract_youtube():
    # ...
```

**Error Response:**
```json
{
  "error": "Rate limit exceeded",
  "message": "You can extract 10 videos per hour. Try again in 45 minutes.",
  "retry_after": 2700
}
```

---

## UI/UX Design

### Component Updates

#### FileUpload.tsx Enhancement

**Current Structure:**
```tsx
<div className="file-upload">
  <input type="file" />
  <button>Upload Song</button>
</div>
```

**New Structure:**
```tsx
<div className="song-input-container">
  <Tabs>
    <Tab label="Upload File">
      <FileUploadTab />  {/* Existing component */}
    </Tab>

    <Tab label="YouTube URL">
      <YouTubeUrlTab />  {/* New component */}
    </Tab>
  </Tabs>
</div>
```

#### New Component: YouTubeUrlTab.tsx

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  Paste YouTube URL                                       │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌─────────────────────────────────────────────────┐   │
│  │ https://www.youtube.com/watch?v=...              │   │
│  └─────────────────────────────────────────────────┘   │
│                                          [Paste] [Clear] │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐│
│  │ 🎵 Video Preview                                     ││
│  │ ┌────────┐                                           ││
│  │ │ [img]  │  Song Title Here                         ││
│  │ │ thumb  │  Duration: 3:45                           ││
│  │ └────────┘  Artist Name                              ││
│  │                                                       ││
│  │              [Extract & Analyze]                     ││
│  └─────────────────────────────────────────────────────┘│
│                                                           │
│  Progress:                                               │
│  [████████░░░░░░░░] 60%                                  │
│  Downloading audio from YouTube...                       │
└─────────────────────────────────────────────────────────┘
```

**States:**
1. **Empty**: Just input field and buttons
2. **URL Entered**: Show video preview after validation
3. **Extracting**: Progress bar with status messages
4. **Success**: Same as file upload success (transition to playback)
5. **Error**: Clear error message with retry option

**Progress Messages:**
```
1. "Validating URL..." (1-2s)
2. "Fetching video information..." (2-3s)
3. "Downloading audio from YouTube..." (10-30s)
4. "Converting to audio format..." (5-10s)
5. "Analyzing beats and musical structure..." (30-120s)
6. "Ready to play!" (transition)
```

### Mobile Considerations

**Responsive Design:**
- Stack tabs vertically on mobile
- Full-width input field
- Larger tap targets (44px minimum)
- Simplified preview card

**Paste Detection:**
```tsx
// Auto-detect clipboard paste
const handlePaste = async (e: ClipboardEvent) => {
  const text = e.clipboardData?.getData('text');
  if (text && isYouTubeUrl(text)) {
    setUrl(text);
    // Auto-fetch preview
  }
};
```

### Error Messages

**User-Friendly Errors:**
```typescript
const ERROR_MESSAGES = {
  INVALID_URL: "Please enter a valid YouTube URL",
  VIDEO_NOT_FOUND: "This video doesn't exist or is private",
  VIDEO_TOO_LONG: "Video must be under 30 minutes",
  AGE_RESTRICTED: "Cannot extract age-restricted videos",
  COPYRIGHT_BLOCKED: "This video is not available in your region",
  RATE_LIMIT: "Too many requests. Please try again in {time}",
  EXTRACTION_FAILED: "Failed to extract audio. Please try uploading the file instead",
  NETWORK_ERROR: "Connection error. Please check your internet",
  SERVER_ERROR: "Server is busy. Please try again later"
};
```

---

## Backend Architecture

### New Files

#### 1. `youtube_extractor.py`

```python
"""
YouTube audio extraction service using yt-dlp.
Handles URL validation, metadata fetching, and audio download.
"""

import yt_dlp
import re
import os
from typing import Optional, Dict, Tuple
from datetime import datetime
import hashlib

class YouTubeExtractor:
    """Handles YouTube video audio extraction."""

    # Configuration
    MAX_DURATION = 1800  # 30 minutes in seconds
    MAX_FILESIZE = 50 * 1024 * 1024  # 50MB
    AUDIO_FORMAT = 'mp3'
    AUDIO_QUALITY = '128'  # kbps

    # YouTube URL patterns
    URL_PATTERNS = [
        r'(?:https?://)?(?:www\.)?youtube\.com/watch\?v=([a-zA-Z0-9_-]{11})',
        r'(?:https?://)?(?:www\.)?youtu\.be/([a-zA-Z0-9_-]{11})',
        r'(?:https?://)?(?:m\.)?youtube\.com/watch\?v=([a-zA-Z0-9_-]{11})',
    ]

    def __init__(self, output_dir: str, temp_dir: str):
        """
        Initialize extractor.

        Args:
            output_dir: Directory for final audio files
            temp_dir: Directory for temporary downloads
        """
        self.output_dir = output_dir
        self.temp_dir = temp_dir

        # Create directories if they don't exist
        os.makedirs(output_dir, exist_ok=True)
        os.makedirs(temp_dir, exist_ok=True)

    def validate_url(self, url: str) -> Optional[str]:
        """
        Validate YouTube URL and extract video ID.

        Args:
            url: YouTube URL to validate

        Returns:
            Video ID if valid, None otherwise
        """
        for pattern in self.URL_PATTERNS:
            match = re.search(pattern, url)
            if match:
                return match.group(1)
        return None

    def get_video_info(self, url: str) -> Dict:
        """
        Fetch video metadata without downloading.

        Args:
            url: YouTube URL

        Returns:
            Dict with title, duration, thumbnail, uploader

        Raises:
            Exception: If video info cannot be fetched
        """
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'extract_flat': False,
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            try:
                info = ydl.extract_info(url, download=False)

                # Check duration limit
                duration = info.get('duration', 0)
                if duration > self.MAX_DURATION:
                    raise ValueError(f"Video too long: {duration}s (max {self.MAX_DURATION}s)")

                return {
                    'video_id': info.get('id'),
                    'title': info.get('title', 'Unknown'),
                    'duration': duration,
                    'thumbnail': info.get('thumbnail'),
                    'uploader': info.get('uploader', 'Unknown'),
                    'upload_date': info.get('upload_date'),
                }
            except Exception as e:
                raise Exception(f"Failed to fetch video info: {str(e)}")

    def extract_audio(self, url: str, progress_callback=None) -> Tuple[str, Dict]:
        """
        Download and extract audio from YouTube video.

        Args:
            url: YouTube URL
            progress_callback: Optional callback for progress updates

        Returns:
            Tuple of (file_path, video_info)

        Raises:
            Exception: If extraction fails
        """
        video_id = self.validate_url(url)
        if not video_id:
            raise ValueError("Invalid YouTube URL")

        # Check if already extracted
        existing_file = self._find_existing_file(video_id)
        if existing_file:
            info = self.get_video_info(url)
            return existing_file, info

        # yt-dlp options
        output_template = os.path.join(self.temp_dir, f'yt_{video_id}.%(ext)s')

        ydl_opts = {
            'format': 'bestaudio/best',
            'outtmpl': output_template,
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': self.AUDIO_FORMAT,
                'preferredquality': self.AUDIO_QUALITY,
            }],
            'quiet': False,
            'no_warnings': False,
            'max_filesize': self.MAX_FILESIZE,
            'socket_timeout': 30,
            'retries': 2,
        }

        # Add progress hook if callback provided
        if progress_callback:
            def progress_hook(d):
                if d['status'] == 'downloading':
                    progress_callback({
                        'status': 'downloading',
                        'percent': d.get('_percent_str', '0%'),
                        'speed': d.get('_speed_str', ''),
                        'eta': d.get('_eta_str', ''),
                    })
                elif d['status'] == 'finished':
                    progress_callback({
                        'status': 'converting',
                        'percent': '100%',
                    })

            ydl_opts['progress_hooks'] = [progress_hook]

        # Download and extract
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            try:
                info = ydl.extract_info(url, download=True)

                # Move from temp to output directory
                temp_file = os.path.join(self.temp_dir, f'yt_{video_id}.{self.AUDIO_FORMAT}')
                final_file = os.path.join(self.output_dir, f'yt_{video_id}.{self.AUDIO_FORMAT}')

                if os.path.exists(temp_file):
                    os.rename(temp_file, final_file)
                else:
                    raise FileNotFoundError(f"Expected file not found: {temp_file}")

                video_info = {
                    'video_id': video_id,
                    'title': info.get('title', 'Unknown'),
                    'duration': info.get('duration', 0),
                    'thumbnail': info.get('thumbnail'),
                    'uploader': info.get('uploader', 'Unknown'),
                }

                return final_file, video_info

            except Exception as e:
                # Cleanup on failure
                self._cleanup_temp_files(video_id)
                raise Exception(f"Extraction failed: {str(e)}")

    def _find_existing_file(self, video_id: str) -> Optional[str]:
        """Check if audio file already exists for this video ID."""
        expected_file = os.path.join(self.output_dir, f'yt_{video_id}.{self.AUDIO_FORMAT}')
        if os.path.exists(expected_file):
            return expected_file
        return None

    def _cleanup_temp_files(self, video_id: str):
        """Remove temporary files for a video ID."""
        patterns = [
            os.path.join(self.temp_dir, f'yt_{video_id}.*'),
            os.path.join(self.temp_dir, f'{video_id}.*'),
        ]

        for pattern in patterns:
            import glob
            for file in glob.glob(pattern):
                try:
                    os.remove(file)
                except Exception:
                    pass
```

#### 2. `rate_limiter.py`

```python
"""
Rate limiting for YouTube extraction requests.
"""

from flask import request
from datetime import datetime, timedelta
from typing import Dict, Tuple
import threading

class RateLimiter:
    """
    Token bucket rate limiter.
    Tracks requests per IP address.
    """

    def __init__(self, max_requests: int = 10, window_seconds: int = 3600):
        """
        Initialize rate limiter.

        Args:
            max_requests: Maximum requests allowed per window
            window_seconds: Time window in seconds (default 1 hour)
        """
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests: Dict[str, list] = {}  # IP -> [timestamps]
        self.lock = threading.Lock()

    def is_allowed(self, ip: str) -> Tuple[bool, int]:
        """
        Check if request from IP is allowed.

        Args:
            ip: IP address

        Returns:
            Tuple of (allowed: bool, remaining: int)
        """
        with self.lock:
            now = datetime.now()
            cutoff = now - timedelta(seconds=self.window_seconds)

            # Get request history for this IP
            if ip not in self.requests:
                self.requests[ip] = []

            # Remove old requests outside the window
            self.requests[ip] = [
                ts for ts in self.requests[ip]
                if ts > cutoff
            ]

            # Check limit
            current_count = len(self.requests[ip])

            if current_count >= self.max_requests:
                return False, 0

            # Record this request
            self.requests[ip].append(now)
            remaining = self.max_requests - (current_count + 1)

            return True, remaining

    def get_retry_after(self, ip: str) -> int:
        """
        Get seconds until next request is allowed.

        Args:
            ip: IP address

        Returns:
            Seconds until retry (0 if allowed now)
        """
        with self.lock:
            if ip not in self.requests or not self.requests[ip]:
                return 0

            # Oldest request will expire first
            oldest = min(self.requests[ip])
            retry_time = oldest + timedelta(seconds=self.window_seconds)
            now = datetime.now()

            if retry_time > now:
                return int((retry_time - now).total_seconds())
            return 0

    def cleanup(self):
        """Remove stale IP entries (housekeeping)."""
        with self.lock:
            now = datetime.now()
            cutoff = now - timedelta(seconds=self.window_seconds * 2)

            ips_to_remove = []
            for ip, timestamps in self.requests.items():
                # Remove old timestamps
                timestamps = [ts for ts in timestamps if ts > cutoff]
                if not timestamps:
                    ips_to_remove.append(ip)
                else:
                    self.requests[ip] = timestamps

            for ip in ips_to_remove:
                del self.requests[ip]
```

### Modified Files

#### `app.py` - New Endpoint

```python
from youtube_extractor import YouTubeExtractor
from rate_limiter import RateLimiter
from flask import jsonify, request
import logging

# Initialize extractor and rate limiter
extractor = YouTubeExtractor(
    output_dir='uploads',
    temp_dir='temp'
)
rate_limiter = RateLimiter(max_requests=10, window_seconds=3600)

@app.route('/extract-youtube', methods=['POST'])
def extract_youtube():
    """
    Extract audio from YouTube URL and process it.

    Request JSON:
        {
            "url": "https://youtube.com/watch?v=..."
        }

    Returns:
        Same format as /upload endpoint (segments, metadata)
    """
    try:
        # Get request data
        data = request.get_json()
        url = data.get('url', '').strip()

        if not url:
            return jsonify({'error': 'URL is required'}), 400

        # Validate URL format
        video_id = extractor.validate_url(url)
        if not video_id:
            return jsonify({'error': 'Invalid YouTube URL'}), 400

        # Rate limiting
        client_ip = request.remote_addr
        allowed, remaining = rate_limiter.is_allowed(client_ip)

        if not allowed:
            retry_after = rate_limiter.get_retry_after(client_ip)
            return jsonify({
                'error': 'Rate limit exceeded',
                'message': f'Please try again in {retry_after // 60} minutes',
                'retry_after': retry_after
            }), 429

        # Log request
        logging.info(f"YouTube extraction request: {url} from {client_ip}")

        # Extract audio
        try:
            file_path, video_info = extractor.extract_audio(url)
            logging.info(f"Extracted: {file_path}")
        except Exception as e:
            logging.error(f"Extraction failed: {str(e)}")
            return jsonify({
                'error': 'Extraction failed',
                'message': str(e)
            }), 500

        # Generate song_id (use video_id + file hash for consistency)
        with open(file_path, 'rb') as f:
            content_hash = hashlib.sha256(f.read()).hexdigest()[:16]

        song_id = f"yt_{video_id}_{content_hash}"

        # Check if already analyzed
        cached_data = load_cached_analysis(song_id)
        if cached_data:
            logging.info(f"Using cached analysis for {song_id}")
            return jsonify(cached_data), 200

        # Process audio (reuse existing pipeline)
        try:
            # Create InfiniteJukebox instance
            jukebox = InfiniteJukebox(file_path, start_beat=1)

            # Convert beats to segments format
            segments = format_segments(jukebox)

            # Save to database
            save_song_metadata(
                song_id=song_id,
                original_filename=video_info['title'],
                file_path=file_path,
                duration=jukebox.duration,
                tempo=jukebox.tempo,
                beats=len(jukebox.beats),
                clusters=len(set(b['cluster'] for b in jukebox.beats)),
                youtube_video_id=video_id,
                youtube_metadata=video_info
            )

            # Cache results
            cache_analysis(song_id, {
                'song_id': song_id,
                'filename': video_info['title'],
                'segments': segments,
                'duration': jukebox.duration,
                'tempo': jukebox.tempo,
                'sample_rate': jukebox.sample_rate,
                'youtube_metadata': video_info
            })

            # Return response
            return jsonify({
                'song_id': song_id,
                'filename': video_info['title'],
                'segments': segments,
                'duration': jukebox.duration,
                'tempo': jukebox.tempo,
                'sample_rate': jukebox.sample_rate,
                'youtube_metadata': video_info
            }), 200

        except Exception as e:
            logging.error(f"Analysis failed: {str(e)}")
            return jsonify({
                'error': 'Analysis failed',
                'message': str(e)
            }), 500

    except Exception as e:
        logging.error(f"Unexpected error: {str(e)}")
        return jsonify({
            'error': 'Server error',
            'message': 'An unexpected error occurred'
        }), 500


@app.route('/youtube-info', methods=['POST'])
def get_youtube_info():
    """
    Get YouTube video metadata without downloading.
    Used for preview before extraction.

    Request JSON:
        {
            "url": "https://youtube.com/watch?v=..."
        }

    Returns:
        {
            "video_id": "...",
            "title": "...",
            "duration": 225,
            "thumbnail": "https://...",
            "uploader": "..."
        }
    """
    try:
        data = request.get_json()
        url = data.get('url', '').strip()

        if not url:
            return jsonify({'error': 'URL is required'}), 400

        # Validate URL
        video_id = extractor.validate_url(url)
        if not video_id:
            return jsonify({'error': 'Invalid YouTube URL'}), 400

        # Get video info
        try:
            info = extractor.get_video_info(url)
            return jsonify(info), 200
        except Exception as e:
            return jsonify({
                'error': 'Failed to fetch video info',
                'message': str(e)
            }), 400

    except Exception as e:
        return jsonify({
            'error': 'Server error',
            'message': str(e)
        }), 500
```

#### Database Schema Update

Add YouTube-specific fields to `song_mapper.py`:

```python
def create_songs_table():
    """Create songs table with YouTube support."""
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS songs (
            song_id TEXT PRIMARY KEY,
            original_filename TEXT NOT NULL,
            encoded_filename TEXT NOT NULL,
            file_path TEXT NOT NULL,
            duration REAL,
            tempo REAL,
            sample_rate INTEGER,
            beats INTEGER,
            clusters INTEGER,
            jump_points INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

            -- YouTube-specific fields
            youtube_video_id TEXT,
            youtube_title TEXT,
            youtube_uploader TEXT,
            youtube_thumbnail TEXT,
            youtube_upload_date TEXT,

            source TEXT DEFAULT 'upload'  -- 'upload' or 'youtube'
        )
    ''')
```

### Dependencies Update

Add to `requirements.txt`:

```
# Existing dependencies
Flask==2.3.3
librosa==0.10.1
madmom
numpy==1.24.3
scipy==1.11.3
scikit-learn

# New dependencies
yt-dlp==2023.12.30
Flask-Limiter==3.5.0
```

---

## Security & Legal Considerations

### Security Measures

#### 1. Input Validation
```python
# Prevent SSRF attacks
ALLOWED_DOMAINS = ['youtube.com', 'youtu.be', 'm.youtube.com']

def validate_url_security(url: str) -> bool:
    """Ensure URL only points to YouTube domains."""
    from urllib.parse import urlparse
    parsed = urlparse(url)
    return parsed.netloc in ALLOWED_DOMAINS
```

#### 2. File Size Limits
- Maximum download: 50MB
- Maximum duration: 30 minutes
- Timeout: 60 seconds for download

#### 3. Sandboxing
- Run yt-dlp in subprocess with timeout
- Limit CPU and memory usage
- Restrict file system access to temp directory

#### 4. Sanitization
```python
# Sanitize video metadata before storage
import bleach

def sanitize_metadata(metadata: dict) -> dict:
    """Remove potentially malicious content from metadata."""
    return {
        'title': bleach.clean(metadata['title'], strip=True),
        'uploader': bleach.clean(metadata['uploader'], strip=True),
        # Only allow HTTPS thumbnails
        'thumbnail': metadata['thumbnail'] if metadata['thumbnail'].startswith('https://') else None
    }
```

#### 5. Rate Limiting
- Per IP: 10 requests/hour
- Global: 100 requests/hour
- DDoS protection via reverse proxy (nginx)

### Legal Considerations

#### YouTube Terms of Service

**Relevant Clauses:**
- Section 4B: "You shall not download any Content unless you see a 'download' or similar link displayed by YouTube"
- However: Personal, non-commercial use is generally tolerated
- Gray area: Many similar services exist (youtube-dl, yt-dlp)

**Mitigation Strategy:**
1. **Terms of Use Disclaimer:**
```
By using YouTube URL extraction, you agree:
- To use extracted audio for personal, non-commercial purposes only
- That you have rights to access the content
- To comply with YouTube's Terms of Service
- That this service is for educational/research purposes
```

2. **User Responsibility:**
   - Place burden on user to ensure legal compliance
   - Log all extraction requests for audit trail
   - Implement "Report Abuse" mechanism

3. **Compliance Features:**
   - Honor age restrictions (don't extract age-restricted videos)
   - Respect geo-blocking (don't attempt to bypass)
   - No video download (audio only)
   - No DRM circumvention

#### Copyright Considerations

**Risk Level:** Medium

**Mitigations:**
- Audio is processed in-memory and can be deleted after analysis
- No redistribution of content
- No monetization of extracted content
- Educational/research purpose (music analysis)

**Legal Precedent:**
- youtube-dl was temporarily taken down from GitHub (2020) but restored after review
- yt-dlp continues to operate openly
- Focus on tool misuse, not tool existence

**Recommendation:**
- Consult with legal counsel before production deployment
- Consider limiting to Creative Commons or public domain content
- Implement DMCA takedown process
- Geographic restriction if needed

### Privacy Considerations

**Data Collection:**
- Log IP addresses for rate limiting (anonymize after 7 days)
- Log video IDs for cache management
- Do NOT log user account information
- Do NOT share data with third parties

**GDPR Compliance:**
- Provide data deletion mechanism
- Allow users to request their data
- Clear privacy policy
- Cookie consent if using analytics

---

## Implementation Plan

### Phase 1: Backend Foundation (Week 1)

**Tasks:**
1. Set up development environment
   - Install yt-dlp and dependencies
   - Create temp and uploads directories
   - Configure logging

2. Implement `youtube_extractor.py`
   - URL validation
   - Video info fetching
   - Audio extraction
   - Cache management

3. Implement `rate_limiter.py`
   - Token bucket algorithm
   - IP tracking
   - Cleanup routine

4. Create `/extract-youtube` endpoint
   - Request validation
   - Rate limiting integration
   - Error handling
   - Response formatting

5. Create `/youtube-info` endpoint
   - Metadata preview
   - Duration validation
   - Error messages

6. Database schema update
   - Add YouTube fields
   - Migration script
   - Update song_mapper.py

**Deliverables:**
- Working backend API
- Unit tests for extractor
- API documentation

**Testing:**
```bash
# Test video info
curl -X POST http://localhost:5001/youtube-info \
  -H "Content-Type: application/json" \
  -d '{"url": "https://youtube.com/watch?v=dQw4w9WgXcQ"}'

# Test extraction
curl -X POST http://localhost:5001/extract-youtube \
  -H "Content-Type: application/json" \
  -d '{"url": "https://youtube.com/watch?v=dQw4w9WgXcQ"}'
```

### Phase 2: Frontend UI (Week 2)

**Tasks:**
1. Create `YouTubeUrlTab.tsx`
   - URL input field
   - Validation feedback
   - Paste detection
   - Clear button

2. Create `YouTubePreview.tsx`
   - Video metadata display
   - Thumbnail display
   - Duration formatting
   - Extract button

3. Update `FileUpload.tsx`
   - Add tab navigation
   - Integrate YouTube tab
   - Shared progress component
   - Error display

4. Implement progress tracking
   - WebSocket or polling for progress
   - Progress bar component
   - Status messages
   - Cancel functionality

5. Add API integration
   - `/youtube-info` call
   - `/extract-youtube` call
   - Error handling
   - Success callback

**Deliverables:**
- Complete UI components
- Integration tests
- Mobile-responsive design

**Testing:**
- Manual testing on various devices
- Test error scenarios
- Test cancellation
- Test rate limiting UI

### Phase 3: Integration & Testing (Week 3)

**Tasks:**
1. End-to-end testing
   - Happy path: URL → extraction → playback
   - Error scenarios
   - Rate limiting
   - Cache hits

2. Performance optimization
   - Lazy loading components
   - Progress polling optimization
   - Cache strategy tuning

3. Security review
   - Input validation audit
   - Rate limiting stress test
   - SSRF prevention test
   - File system access audit

4. Documentation
   - User guide
   - API documentation
   - Deployment guide
   - Troubleshooting guide

**Deliverables:**
- Test report
- Performance benchmarks
- Security audit report
- Complete documentation

### Phase 4: Deployment & Monitoring (Week 4)

**Tasks:**
1. Production deployment
   - Environment configuration
   - Reverse proxy setup (nginx)
   - SSL/TLS configuration
   - Firewall rules

2. Monitoring setup
   - Error logging (Sentry or similar)
   - Performance monitoring
   - Rate limit metrics
   - Disk usage alerts

3. Legal compliance
   - Terms of service update
   - Privacy policy update
   - DMCA process
   - User education

4. Soft launch
   - Beta testing with limited users
   - Gather feedback
   - Monitor error rates
   - Tune rate limits

**Deliverables:**
- Production-ready deployment
- Monitoring dashboard
- Legal documentation
- Launch plan

### Rollout Strategy

**Option A: Feature Flag**
```python
# config.py
YOUTUBE_EXTRACTION_ENABLED = os.getenv('ENABLE_YOUTUBE_EXTRACTION', 'false').lower() == 'true'

# app.py
if not YOUTUBE_EXTRACTION_ENABLED:
    @app.route('/extract-youtube', methods=['POST'])
    def extract_youtube_disabled():
        return jsonify({'error': 'Feature not available'}), 503
```

**Option B: Gradual Rollout**
1. Week 1-2: Internal testing only
2. Week 3: Beta users (10% of traffic)
3. Week 4: Limited release (50% of traffic)
4. Week 5+: Full release (100% of traffic)

**Rollback Plan:**
- Feature flag can disable instantly
- Database changes are backward compatible
- Frontend falls back to file upload
- Communicate to users via banner

---

## Testing Strategy

### Unit Tests

#### Backend Tests (`test_youtube_extractor.py`)

```python
import unittest
from youtube_extractor import YouTubeExtractor

class TestYouTubeExtractor(unittest.TestCase):

    def setUp(self):
        self.extractor = YouTubeExtractor('test_output', 'test_temp')

    def test_validate_url_standard(self):
        """Test standard YouTube URL validation."""
        url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
        video_id = self.extractor.validate_url(url)
        self.assertEqual(video_id, 'dQw4w9WgXcQ')

    def test_validate_url_short(self):
        """Test short YouTube URL validation."""
        url = 'https://youtu.be/dQw4w9WgXcQ'
        video_id = self.extractor.validate_url(url)
        self.assertEqual(video_id, 'dQw4w9WgXcQ')

    def test_validate_url_mobile(self):
        """Test mobile YouTube URL validation."""
        url = 'https://m.youtube.com/watch?v=dQw4w9WgXcQ'
        video_id = self.extractor.validate_url(url)
        self.assertEqual(video_id, 'dQw4w9WgXcQ')

    def test_validate_url_invalid(self):
        """Test invalid URL rejection."""
        url = 'https://vimeo.com/12345'
        video_id = self.extractor.validate_url(url)
        self.assertIsNone(video_id)

    def test_get_video_info(self):
        """Test video metadata fetching."""
        # Use a known stable video
        url = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'  # Me at the zoo
        info = self.extractor.get_video_info(url)

        self.assertIn('video_id', info)
        self.assertIn('title', info)
        self.assertIn('duration', info)
        self.assertGreater(info['duration'], 0)

    def test_video_too_long(self):
        """Test rejection of videos exceeding duration limit."""
        # Mock a long video (would need to mock yt-dlp response)
        pass

    def test_extract_audio_caching(self):
        """Test that extraction uses cache on second request."""
        url = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'

        # First extraction
        file_path1, info1 = self.extractor.extract_audio(url)

        # Second extraction (should use cache)
        file_path2, info2 = self.extractor.extract_audio(url)

        self.assertEqual(file_path1, file_path2)
```

#### Rate Limiter Tests (`test_rate_limiter.py`)

```python
import unittest
from rate_limiter import RateLimiter
import time

class TestRateLimiter(unittest.TestCase):

    def test_allows_within_limit(self):
        """Test that requests within limit are allowed."""
        limiter = RateLimiter(max_requests=5, window_seconds=10)

        for i in range(5):
            allowed, remaining = limiter.is_allowed('192.168.1.1')
            self.assertTrue(allowed)
            self.assertEqual(remaining, 4 - i)

    def test_blocks_over_limit(self):
        """Test that requests over limit are blocked."""
        limiter = RateLimiter(max_requests=5, window_seconds=10)

        # Use up all requests
        for i in range(5):
            limiter.is_allowed('192.168.1.1')

        # Next request should be blocked
        allowed, remaining = limiter.is_allowed('192.168.1.1')
        self.assertFalse(allowed)
        self.assertEqual(remaining, 0)

    def test_different_ips_independent(self):
        """Test that different IPs have independent limits."""
        limiter = RateLimiter(max_requests=2, window_seconds=10)

        # IP 1 uses its limit
        limiter.is_allowed('192.168.1.1')
        limiter.is_allowed('192.168.1.1')

        # IP 2 should still be allowed
        allowed, remaining = limiter.is_allowed('192.168.1.2')
        self.assertTrue(allowed)

    def test_window_expiration(self):
        """Test that limits reset after window expires."""
        limiter = RateLimiter(max_requests=2, window_seconds=1)

        # Use up limit
        limiter.is_allowed('192.168.1.1')
        limiter.is_allowed('192.168.1.1')

        # Should be blocked
        allowed, _ = limiter.is_allowed('192.168.1.1')
        self.assertFalse(allowed)

        # Wait for window to expire
        time.sleep(1.1)

        # Should be allowed again
        allowed, _ = limiter.is_allowed('192.168.1.1')
        self.assertTrue(allowed)
```

### Integration Tests

#### API Endpoint Tests (`test_api.py`)

```python
import unittest
from app import app
import json

class TestExtractYouTubeAPI(unittest.TestCase):

    def setUp(self):
        self.app = app.test_client()
        self.app.testing = True

    def test_extract_youtube_success(self):
        """Test successful YouTube extraction."""
        response = self.app.post('/extract-youtube',
            data=json.dumps({'url': 'https://youtube.com/watch?v=jNQXAC9IVRw'}),
            content_type='application/json'
        )

        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIn('song_id', data)
        self.assertIn('segments', data)

    def test_extract_youtube_invalid_url(self):
        """Test extraction with invalid URL."""
        response = self.app.post('/extract-youtube',
            data=json.dumps({'url': 'https://vimeo.com/12345'}),
            content_type='application/json'
        )

        self.assertEqual(response.status_code, 400)
        data = json.loads(response.data)
        self.assertIn('error', data)

    def test_youtube_info_success(self):
        """Test video info endpoint."""
        response = self.app.post('/youtube-info',
            data=json.dumps({'url': 'https://youtube.com/watch?v=jNQXAC9IVRw'}),
            content_type='application/json'
        )

        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIn('title', data)
        self.assertIn('duration', data)

    def test_rate_limiting(self):
        """Test that rate limiting is enforced."""
        # Make requests until rate limited
        for i in range(11):  # Limit is 10
            response = self.app.post('/extract-youtube',
                data=json.dumps({'url': 'https://youtube.com/watch?v=test'}),
                content_type='application/json'
            )

        # 11th request should be rate limited
        self.assertEqual(response.status_code, 429)
```

### Frontend Tests

#### Component Tests (`YouTubeUrlTab.test.tsx`)

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import YouTubeUrlTab from './YouTubeUrlTab';

describe('YouTubeUrlTab', () => {

  test('renders URL input field', () => {
    render(<YouTubeUrlTab />);
    const input = screen.getByPlaceholderText(/paste youtube url/i);
    expect(input).toBeInTheDocument();
  });

  test('validates URL format', () => {
    render(<YouTubeUrlTab />);
    const input = screen.getByPlaceholderText(/paste youtube url/i);

    // Invalid URL
    fireEvent.change(input, { target: { value: 'not a url' } });
    expect(screen.getByText(/invalid youtube url/i)).toBeInTheDocument();

    // Valid URL
    fireEvent.change(input, {
      target: { value: 'https://youtube.com/watch?v=dQw4w9WgXcQ' }
    });
    expect(screen.queryByText(/invalid youtube url/i)).not.toBeInTheDocument();
  });

  test('fetches video preview on valid URL', async () => {
    render(<YouTubeUrlTab />);
    const input = screen.getByPlaceholderText(/paste youtube url/i);

    fireEvent.change(input, {
      target: { value: 'https://youtube.com/watch?v=dQw4w9WgXcQ' }
    });

    await waitFor(() => {
      expect(screen.getByText(/Rick Astley/i)).toBeInTheDocument();
    });
  });

  test('shows progress during extraction', async () => {
    render(<YouTubeUrlTab />);
    const input = screen.getByPlaceholderText(/paste youtube url/i);
    const button = screen.getByText(/extract/i);

    fireEvent.change(input, {
      target: { value: 'https://youtube.com/watch?v=dQw4w9WgXcQ' }
    });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });
  });
});
```

### Performance Tests

**Load Testing with Artillery:**

```yaml
# artillery-config.yml
config:
  target: 'http://localhost:5001'
  phases:
    - duration: 60
      arrivalRate: 5  # 5 requests per second
      name: "Warm up"
    - duration: 120
      arrivalRate: 10
      name: "Sustained load"
    - duration: 60
      arrivalRate: 20
      name: "Peak load"

scenarios:
  - name: "Extract YouTube video"
    flow:
      - post:
          url: "/extract-youtube"
          json:
            url: "https://youtube.com/watch?v=jNQXAC9IVRw"
          expect:
            - statusCode: 200
            - contentType: json
            - hasProperty: song_id
```

**Run:**
```bash
artillery run artillery-config.yml
```

### Security Tests

**SSRF Prevention Test:**
```python
def test_ssrf_prevention():
    """Test that SSRF attacks are prevented."""
    malicious_urls = [
        'https://internal.server/admin',
        'http://localhost:22',
        'http://169.254.169.254/latest/meta-data',  # AWS metadata
        'file:///etc/passwd',
    ]

    for url in malicious_urls:
        response = app.test_client().post('/extract-youtube',
            data=json.dumps({'url': url}),
            content_type='application/json'
        )
        assert response.status_code == 400
        assert 'Invalid YouTube URL' in response.data.decode()
```

---

## Risks and Mitigations

### Technical Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| yt-dlp breaks due to YouTube changes | High | Medium | - Monitor yt-dlp GitHub for issues<br>- Have fallback to file upload<br>- Show clear error message<br>- Update yt-dlp regularly |
| Server resource exhaustion | High | Medium | - Limit concurrent extractions (3 max)<br>- Queue system for overflow<br>- Timeout after 60s<br>- Monitor CPU/memory usage |
| Storage fills up | Medium | High | - Implement LRU eviction<br>- Set max storage limit (10GB)<br>- Cleanup script for old files<br>- Monitor disk usage |
| Rate limiting too restrictive | Low | Medium | - Start conservative, tune based on metrics<br>- Different limits for authenticated users<br>- Clear communication to users |
| Slow extraction times | Medium | High | - Set realistic expectations in UI<br>- Show detailed progress<br>- Implement timeout<br>- Cache aggressively |

### Legal Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| YouTube ToS violation complaint | High | Low | - Terms of use disclaimer<br>- User responsibility clause<br>- Cease & desist response plan<br>- Feature flag for quick disable |
| Copyright infringement claims | High | Low | - DMCA process<br>- No content redistribution<br>- Audit logs<br>- Legal counsel review |
| User uploads copyrighted content | Medium | Medium | - Educational use disclaimer<br>- No monetization<br>- User responsibility<br>- Report abuse mechanism |

### Business Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Feature abuse (spam, mining) | Medium | Medium | - Strong rate limiting<br>- IP blocking<br>- CAPTCHA for high volume<br>- Monitor anomalies |
| Negative user feedback | Low | Low | - Beta testing first<br>- Clear communication<br>- Fallback to file upload<br>- Gather feedback early |
| Maintenance burden | Medium | High | - Automated monitoring<br>- Good documentation<br>- Error alerting<br>- Regular dependency updates |

### Contingency Plans

**If YouTube blocks yt-dlp:**
1. Switch to alternative extractor (pytube, youtube-dl)
2. Partner with legal extraction service (API)
3. Disable feature temporarily
4. Focus on file upload only

**If legal issues arise:**
1. Disable feature via feature flag
2. Consult legal counsel
3. Communicate to users
4. Implement required changes or remove feature

**If performance is poor:**
1. Add queue system (Celery + Redis)
2. Increase server resources
3. Implement lazy loading
4. Reduce rate limits

---

## Future Enhancements

### Phase 2 Features

1. **Multiple URL Support**
   - Batch extraction (5 URLs at once)
   - Playlist support (extract all videos)
   - Progress for multiple extractions

2. **Advanced Caching**
   - Redis cache for metadata
   - CDN for popular songs
   - Predictive pre-caching

3. **User Accounts**
   - Save extraction history
   - Personal library
   - Higher rate limits for registered users
   - Favorites and collections

4. **Social Features**
   - Share analyzed songs
   - Public library of analyzed songs
   - Collaborative playlists
   - Comments and ratings

5. **Audio Quality Options**
   - Let users choose bitrate (128/192/256 kbps)
   - Lossless option (FLAC)
   - Balance quality vs. analysis time

6. **Other Platforms**
   - SoundCloud support
   - Spotify preview clips
   - Bandcamp
   - Direct URL to audio file

7. **Mobile App**
   - Native iOS/Android apps
   - Share from YouTube app
   - Offline analysis
   - Background processing

8. **Premium Features**
   - No rate limits
   - Priority queue
   - Longer duration support (60 min)
   - Batch processing
   - API access

### Analytics

**Metrics to Track:**
- Extraction success rate
- Average extraction time
- Cache hit rate
- Error rate by type
- Most popular videos
- User retention
- Daily active extractors

**Dashboard:**
- Real-time extraction count
- Server resource usage
- Rate limit hits
- Storage usage
- Error logs
- User feedback

---

## Appendix

### A. API Reference

#### POST /extract-youtube

Extract audio from YouTube URL and analyze.

**Request:**
```json
{
  "url": "https://youtube.com/watch?v=VIDEO_ID"
}
```

**Response (200 OK):**
```json
{
  "song_id": "yt_VIDEO_ID_hash",
  "filename": "Video Title",
  "segments": [
    {
      "id": 0,
      "start": 0.0,
      "duration": 0.5,
      "cluster": 1,
      "segment": 0,
      "jump_candidates": [5, 10, 15]
    }
  ],
  "duration": 225.5,
  "tempo": 120.0,
  "sample_rate": 44100,
  "youtube_metadata": {
    "video_id": "VIDEO_ID",
    "title": "Video Title",
    "uploader": "Channel Name",
    "thumbnail": "https://..."
  }
}
```

**Errors:**
- `400`: Invalid URL
- `429`: Rate limit exceeded
- `500`: Extraction or analysis failed

#### POST /youtube-info

Get video metadata without extracting.

**Request:**
```json
{
  "url": "https://youtube.com/watch?v=VIDEO_ID"
}
```

**Response (200 OK):**
```json
{
  "video_id": "VIDEO_ID",
  "title": "Video Title",
  "duration": 225,
  "thumbnail": "https://...",
  "uploader": "Channel Name"
}
```

### B. Configuration

**Environment Variables:**

```bash
# Backend (.env)
YOUTUBE_EXTRACTION_ENABLED=true
YOUTUBE_MAX_DURATION=1800  # 30 minutes
YOUTUBE_MAX_FILESIZE=52428800  # 50MB
YOUTUBE_RATE_LIMIT=10  # per hour per IP
YOUTUBE_CACHE_DIR=uploads
YOUTUBE_TEMP_DIR=temp
```

**Frontend (.env.local):**

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:5001
NEXT_PUBLIC_YOUTUBE_ENABLED=true
```

### C. Deployment Checklist

- [ ] Install yt-dlp and ffmpeg
- [ ] Create temp and cache directories
- [ ] Configure rate limiting
- [ ] Set up logging
- [ ] Configure reverse proxy (nginx)
- [ ] Enable SSL/TLS
- [ ] Set up monitoring (Sentry, etc.)
- [ ] Configure backup strategy
- [ ] Update terms of service
- [ ] Test all endpoints
- [ ] Load testing
- [ ] Security audit
- [ ] Legal review
- [ ] Documentation complete
- [ ] Rollback plan ready

### D. Troubleshooting

**Issue: yt-dlp extraction fails**
- Check yt-dlp version: `yt-dlp --version`
- Update: `pip install -U yt-dlp`
- Check ffmpeg: `ffmpeg -version`
- Review logs: `tail -f logs/extraction.log`

**Issue: Rate limiting too strict**
- Adjust `YOUTUBE_RATE_LIMIT` env variable
- Restart backend: `systemctl restart infinite-worship-backend`
- Clear rate limit cache: `redis-cli FLUSHDB` (if using Redis)

**Issue: Slow extraction**
- Check network speed
- Monitor CPU usage: `top`
- Check concurrent extractions: `ps aux | grep yt-dlp`
- Reduce quality: Set `AUDIO_QUALITY=96`

**Issue: Storage filling up**
- Run cleanup script: `python scripts/cleanup_old_files.py`
- Check disk usage: `df -h`
- Adjust LRU eviction threshold

---

## Conclusion

This specification provides a comprehensive blueprint for implementing YouTube URL input functionality in Infinite Worship. The design balances user experience, technical feasibility, security, and legal considerations.

**Key Success Factors:**
1. Reliable extraction using yt-dlp
2. Clear user feedback during processing
3. Robust error handling
4. Conservative rate limiting
5. Legal compliance and disclaimers
6. Gradual rollout with monitoring

**Next Steps:**
1. Review and approve this specification
2. Set up development environment
3. Begin Phase 1 implementation
4. Iterate based on testing feedback

**Questions for Stakeholders:**
1. Acceptable risk level for legal concerns?
2. Budget for legal counsel review?
3. Preferred rollout strategy (feature flag vs. gradual)?
4. Target launch date?
5. Post-launch support plan?

---

**Document History:**

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-11-14 | Claude | Initial draft |

---

**Approval:**

- [ ] Product Owner
- [ ] Technical Lead
- [ ] Legal Counsel
- [ ] Security Team

**Approved for Implementation:** _______________
**Signature:** _______________
**Date:** _______________
