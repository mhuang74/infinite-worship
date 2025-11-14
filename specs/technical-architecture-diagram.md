# YouTube URL Input - Technical Architecture Diagrams

**Document Version:** 1.0
**Date:** 2025-11-14

---

## System Architecture Overview

```
┌────────────────────────────────────────────────────────────────────┐
│                            User Interface                           │
│                         (Next.js Frontend)                          │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                      Page.tsx (Main)                          │ │
│  │                                                                │ │
│  │  ┌─────────────────────────────────────────────────────────┐ │ │
│  │  │               FileUpload Component                       │ │ │
│  │  │                                                           │ │ │
│  │  │  ┌──────────────────┐     ┌──────────────────────────┐  │ │ │
│  │  │  │  Tab 1:          │     │  Tab 2:                  │  │ │ │
│  │  │  │  File Upload     │ <=> │  YouTube URL Input       │  │ │ │
│  │  │  │  (Existing)      │     │  (NEW)                   │  │ │ │
│  │  │  └──────────────────┘     └──────────────────────────┘  │ │ │
│  │  │                                      │                   │ │ │
│  │  │                                      v                   │ │ │
│  │  │                         ┌──────────────────────┐        │ │ │
│  │  │                         │  YouTubeUrlTab.tsx   │        │ │ │
│  │  │                         │  - URL Input         │        │ │ │
│  │  │                         │  - Validation        │        │ │ │
│  │  │                         │  - Preview Display   │        │ │ │
│  │  │                         │  - Extract Button    │        │ │ │
│  │  │                         └──────────────────────┘        │ │ │
│  │  │                                      │                   │ │ │
│  │  │                                      v                   │ │ │
│  │  │                         ┌──────────────────────┐        │ │ │
│  │  │                         │  YouTubePreview.tsx  │        │ │ │
│  │  │                         │  - Thumbnail         │        │ │ │
│  │  │                         │  - Title             │        │ │ │
│  │  │                         │  - Duration          │        │ │ │
│  │  │                         └──────────────────────┘        │ │ │
│  │  │                                      │                   │ │ │
│  │  │                                      v                   │ │ │
│  │  │                         ┌──────────────────────┐        │ │ │
│  │  │                         │ ExtractionProgress   │        │ │ │
│  │  │                         │  - Progress Bar      │        │ │ │
│  │  │                         │  - Status Messages   │        │ │ │
│  │  │                         │  - Cancel Button     │        │ │ │
│  │  │                         └──────────────────────┘        │ │ │
│  │  └─────────────────────────────────────────────────────────┘ │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTP/REST API
                                    │
                                    v
┌────────────────────────────────────────────────────────────────────┐
│                         Backend (Flask)                             │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                       app.py (Main)                           │ │
│  │                                                                │ │
│  │  Existing Endpoints:                                          │ │
│  │  • POST /upload          - File upload                        │ │
│  │  • GET /segments/<id>    - Get beat data                      │ │
│  │  • GET /uploads/<id>     - Stream audio                       │ │
│  │  • GET /songs            - List all songs                     │ │
│  │                                                                │ │
│  │  NEW Endpoints:                                               │ │
│  │  • POST /youtube-info    - Get video metadata (preview)      │ │
│  │  • POST /extract-youtube - Extract & analyze YouTube audio   │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │              youtube_extractor.py (NEW)                       │ │
│  │                                                                │ │
│  │  class YouTubeExtractor:                                      │ │
│  │    • validate_url(url) -> video_id                            │ │
│  │    • get_video_info(url) -> metadata                          │ │
│  │    • extract_audio(url) -> file_path                          │ │
│  │    • _find_existing_file(video_id) -> file_path               │ │
│  │    • _cleanup_temp_files(video_id)                            │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                    │                               │
│                                    │ subprocess call               │
│                                    v                               │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                    yt-dlp (External)                          │ │
│  │  - Download best audio stream                                 │ │
│  │  - Convert to MP3 (via ffmpeg)                                │ │
│  │  - Save to temp directory                                     │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                rate_limiter.py (NEW)                          │ │
│  │                                                                │ │
│  │  class RateLimiter:                                           │ │
│  │    • is_allowed(ip) -> bool                                   │ │
│  │    • get_retry_after(ip) -> seconds                           │ │
│  │    • cleanup()  # Remove stale entries                        │ │
│  │                                                                │ │
│  │  Storage: In-memory dict {ip: [timestamps]}                   │ │
│  │  Algorithm: Token bucket                                      │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │              Remixatron.py (Existing)                         │ │
│  │                                                                │ │
│  │  class InfiniteJukebox:                                       │ │
│  │    • Load audio with librosa                                  │ │
│  │    • Detect beats (Madmom or librosa)                         │ │
│  │    • Compute chromagram (CQT)                                 │ │
│  │    • Compute MFCC                                             │ │
│  │    • Build similarity matrices                                │ │
│  │    • Laplacian segmentation                                   │ │
│  │    • Cluster beats                                            │ │
│  │    • Find jump candidates                                     │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │              song_mapper.py (Enhanced)                        │ │
│  │                                                                │ │
│  │  SQLite Database: songs.db                                    │ │
│  │                                                                │ │
│  │  Table: songs                                                 │ │
│  │    - song_id (PK)                                             │ │
│  │    - original_filename                                        │ │
│  │    - file_path                                                │ │
│  │    - duration, tempo, sample_rate                             │ │
│  │    - beats, clusters, jump_points                             │ │
│  │    - youtube_video_id (NEW)                                   │ │
│  │    - youtube_title (NEW)                                      │ │
│  │    - youtube_uploader (NEW)                                   │ │
│  │    - youtube_thumbnail (NEW)                                  │ │
│  │    - source: 'upload' | 'youtube' (NEW)                       │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTP request
                                    v
┌────────────────────────────────────────────────────────────────────┐
│                       External Services                             │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                      YouTube CDN                              │ │
│  │  - Audio stream delivery                                      │ │
│  │  - Video metadata API                                         │ │
│  │  - Thumbnail images                                           │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow Diagram

### Scenario 1: YouTube URL Extraction (First Time)

```
User                Frontend              Backend               yt-dlp              YouTube
  │                    │                     │                     │                   │
  │ 1. Paste URL       │                     │                     │                   │
  ├───────────────────>│                     │                     │                   │
  │                    │                     │                     │                   │
  │                    │ 2. Validate URL     │                     │                   │
  │                    │     (client-side)   │                     │                   │
  │                    │                     │                     │                   │
  │                    │ 3. POST             │                     │                   │
  │                    │    /youtube-info    │                     │                   │
  │                    ├────────────────────>│                     │                   │
  │                    │                     │ 4. Extract video_id │                   │
  │                    │                     │    (validate URL)   │                   │
  │                    │                     │                     │                   │
  │                    │                     │ 5. Get metadata     │                   │
  │                    │                     ├────────────────────>│ 6. Fetch info    │
  │                    │                     │                     ├──────────────────>│
  │                    │                     │                     │ 7. Return data   │
  │                    │                     │                     │<──────────────────┤
  │                    │                     │                     │                   │
  │                    │ 8. Return           │<────────────────────┤                   │
  │                    │    video info       │                     │                   │
  │                    │<────────────────────┤                     │                   │
  │                    │                     │                     │                   │
  │ 9. Display preview │                     │                     │                   │
  │<───────────────────┤                     │                     │                   │
  │   (title, thumb,   │                     │                     │                   │
  │    duration)       │                     │                     │                   │
  │                    │                     │                     │                   │
  │ 10. Click          │                     │                     │                   │
  │     "Extract"      │                     │                     │                   │
  ├───────────────────>│                     │                     │                   │
  │                    │                     │                     │                   │
  │                    │ 11. POST            │                     │                   │
  │                    │    /extract-youtube │                     │                   │
  │                    ├────────────────────>│                     │                   │
  │                    │                     │ 12. Rate limit      │                   │
  │                    │                     │     check           │                   │
  │                    │                     │     ✓ Allowed       │                   │
  │                    │                     │                     │                   │
  │                    │                     │ 13. Check cache     │                   │
  │                    │                     │     ✗ Not found     │                   │
  │                    │                     │                     │                   │
  │                    │                     │ 14. Extract audio   │                   │
  │                    │                     ├────────────────────>│ 15. Download     │
  │                    │                     │                     ├──────────────────>│
  │                    │                     │                     │ 16. Stream audio │
  │                    │                     │                     │<──────────────────┤
  │ 17. Progress       │                     │                     │  (10-30 sec)     │
  │     updates        │<─ ─ ─ ─ ─ ─ ─ ─ ─ ─│                     │                   │
  │<───────────────────┤   (polling or       │                     │                   │
  │ "Downloading..."   │    websocket)       │                     │                   │
  │                    │                     │                     │                   │
  │                    │                     │                     │ 17. Convert to   │
  │                    │                     │                     │     MP3 (ffmpeg) │
  │                    │                     │                     │  (5-10 sec)      │
  │                    │                     │                     │                   │
  │                    │                     │ 18. Save to uploads/│                   │
  │                    │                     │<────────────────────┤                   │
  │                    │                     │     yt_{id}.mp3     │                   │
  │                    │                     │                     │                   │
  │                    │                     │ 19. Analyze audio   │                   │
  │                    │                     │     (Remixatron)    │                   │
  │                    │                     │  - Beat detection   │                   │
  │                    │                     │  - Clustering       │                   │
  │                    │                     │  - Jump candidates  │                   │
  │                    │                     │  (30-120 sec)       │                   │
  │ "Analyzing..."     │<─ ─ ─ ─ ─ ─ ─ ─ ─ ─│                     │                   │
  │<───────────────────┤                     │                     │                   │
  │                    │                     │                     │                   │
  │                    │                     │ 20. Save to database│                   │
  │                    │                     │     (song_mapper)   │                   │
  │                    │                     │                     │                   │
  │                    │                     │ 21. Cache results   │                   │
  │                    │                     │     (.npy, .pkl.gz) │                   │
  │                    │                     │                     │                   │
  │                    │ 22. Return segments │                     │                   │
  │                    │<────────────────────┤                     │                   │
  │                    │     & metadata      │                     │                   │
  │                    │                     │                     │                   │
  │ 23. Load audio     │                     │                     │                   │
  │     & start        │                     │                     │                   │
  │     playback       │                     │                     │                   │
  │<───────────────────┤                     │                     │                   │
  │                    │                     │                     │                   │
  ▼                    ▼                     ▼                     ▼                   ▼

Total time: 45-150 seconds
```

### Scenario 2: YouTube URL Extraction (Cached)

```
User                Frontend              Backend               Cache
  │                    │                     │                     │
  │ 1. Paste URL       │                     │                     │
  ├───────────────────>│                     │                     │
  │                    │                     │                     │
  │                    │ 2. POST             │                     │
  │                    │    /extract-youtube │                     │
  │                    ├────────────────────>│                     │
  │                    │                     │                     │
  │                    │                     │ 3. Check cache      │
  │                    │                     │    by video_id      │
  │                    │                     ├────────────────────>│
  │                    │                     │                     │
  │                    │                     │ 4. Cache HIT!       │
  │                    │                     │    - yt_{id}.mp3    │
  │                    │                     │    - _beats.npy     │
  │                    │                     │    - _jukebox.pkl   │
  │                    │                     │<────────────────────┤
  │                    │                     │                     │
  │                    │                     │ 5. Load from cache  │
  │                    │                     │    (instant)        │
  │                    │                     │                     │
  │                    │ 6. Return segments  │                     │
  │                    │<────────────────────┤                     │
  │                    │                     │                     │
  │ 7. Start playback  │                     │                     │
  │<───────────────────┤                     │                     │
  │                    │                     │                     │
  ▼                    ▼                     ▼                     ▼

Total time: 2-5 seconds
```

### Scenario 3: Rate Limit Exceeded

```
User                Frontend              Backend              RateLimiter
  │                    │                     │                     │
  │ 1. Paste URL       │                     │                     │
  ├───────────────────>│                     │                     │
  │                    │                     │                     │
  │                    │ 2. POST             │                     │
  │                    │    /extract-youtube │                     │
  │                    ├────────────────────>│                     │
  │                    │                     │                     │
  │                    │                     │ 3. Check rate limit │
  │                    │                     ├────────────────────>│
  │                    │                     │    for IP           │
  │                    │                     │                     │
  │                    │                     │ 4. BLOCKED          │
  │                    │                     │    (10/hour used)   │
  │                    │                     │<────────────────────┤
  │                    │                     │                     │
  │                    │ 5. HTTP 429         │                     │
  │                    │    "Rate limit      │                     │
  │                    │     exceeded"       │                     │
  │                    │<────────────────────┤                     │
  │                    │    retry_after: 3600│                     │
  │                    │                     │                     │
  │ 6. Error message   │                     │                     │
  │    "Too many       │                     │                     │
  │     requests.      │                     │                     │
  │     Try again in   │                     │                     │
  │     60 minutes"    │                     │                     │
  │<───────────────────┤                     │                     │
  │                    │                     │                     │
  ▼                    ▼                     ▼                     ▼
```

---

## Component Interaction Diagram

### Frontend Components

```
┌────────────────────────────────────────────────────────────┐
│                        page.tsx                             │
│                      (Main Page)                            │
│                                                              │
│  State:                                                      │
│    - songData: Song metadata                                │
│    - audioFile: Audio file object                           │
│    - activeTab: 'library' | 'search' | 'upload'             │
│                                                              │
│  Methods:                                                    │
│    - handleUploadSuccess(data)                              │
│    - setupAudioEngine(audioFile, segments)                  │
│    - refreshLibrary()                                        │
└────────────────────┬───────────────────────────────────────┘
                     │
                     │ renders
                     ▼
┌────────────────────────────────────────────────────────────┐
│                   FileUpload.tsx                            │
│                                                              │
│  State:                                                      │
│    - activeTab: 'file' | 'youtube'                          │
│    - isUploading: boolean                                   │
│    - error: string | null                                   │
│                                                              │
│  Methods:                                                    │
│    - handleFileUpload(file)  [Existing]                     │
│    - handleYouTubeExtract(url)  [NEW]                       │
│    - onSuccess(data) -> parent.handleUploadSuccess()        │
└────────────────────┬───────────────────────────────────────┘
                     │
                     │ renders (conditional)
                     │
        ┌────────────┴─────────────┐
        │                          │
        ▼                          ▼
┌──────────────────┐      ┌───────────────────┐
│  FileUploadTab   │      │  YouTubeUrlTab    │
│   (Existing)     │      │     (NEW)         │
│                  │      │                   │
│  - File input    │      │  State:           │
│  - Upload button │      │    - url: string  │
│                  │      │    - videoInfo    │
│                  │      │    - isExtracting │
│                  │      │    - progress     │
│                  │      │                   │
│                  │      │  Methods:         │
│                  │      │    - validateUrl()│
│                  │      │    - fetchInfo()  │
│                  │      │    - extract()    │
└──────────────────┘      └─────────┬─────────┘
                                    │
                                    │ renders
                                    ▼
                          ┌──────────────────────┐
                          │  YouTubePreview.tsx  │
                          │                      │
                          │  Props:              │
                          │    - videoInfo       │
                          │                      │
                          │  Displays:           │
                          │    - Thumbnail       │
                          │    - Title           │
                          │    - Uploader        │
                          │    - Duration        │
                          │    - Extract button  │
                          └──────────────────────┘
                                    │
                                    │ when extracting
                                    ▼
                          ┌──────────────────────────┐
                          │ ExtractionProgress.tsx   │
                          │                          │
                          │  Props:                  │
                          │    - status: string      │
                          │    - percent: number     │
                          │                          │
                          │  Displays:               │
                          │    - Progress bar        │
                          │    - Status message      │
                          │    - Cancel button       │
                          └──────────────────────────┘
```

### Backend Components

```
┌────────────────────────────────────────────────────────────┐
│                         app.py                              │
│                      (Flask App)                            │
│                                                              │
│  Endpoints:                                                  │
│    POST /youtube-info → get_youtube_info()                  │
│    POST /extract-youtube → extract_youtube()                │
│                                                              │
│  Dependencies:                                               │
│    - YouTubeExtractor                                        │
│    - RateLimiter                                             │
│    - InfiniteJukebox (Remixatron)                           │
│    - song_mapper                                             │
└────────────────────┬───────────────────────────────────────┘
                     │
                     │ uses
                     │
        ┌────────────┴─────────────┬──────────────────┐
        │                          │                  │
        ▼                          ▼                  ▼
┌──────────────────┐      ┌────────────────┐  ┌─────────────────┐
│ YouTubeExtractor │      │  RateLimiter   │  │  InfiniteJukebox│
│                  │      │                │  │   (Existing)    │
│  Methods:        │      │  Methods:      │  │                 │
│   validate_url() │      │   is_allowed() │  │  Methods:       │
│   get_video_info│      │   retry_after()│  │   __init__()    │
│   extract_audio()│      │   cleanup()    │  │   analyze()     │
│                  │      │                │  │   get_beats()   │
│  Uses:           │      │  Storage:      │  │                 │
│   - yt-dlp       │      │   Dict in      │  │  Uses:          │
│   - ffmpeg       │      │   memory       │  │   - librosa     │
│   - subprocess   │      │                │  │   - madmom      │
└──────────────────┘      └────────────────┘  │   - numpy       │
                                               │   - scipy       │
                                               └─────────────────┘
```

---

## Storage Architecture

### File System Structure

```
infinite-worship/
├── application/
│   ├── backend/
│   │   ├── uploads/                    # Persistent storage
│   │   │   ├── songs.db                # SQLite database
│   │   │   ├── {song_id}.mp3           # Uploaded files
│   │   │   ├── yt_{video_id}.mp3       # YouTube extracted (NEW)
│   │   │   ├── {song_id}_beats.npy     # Beat cache
│   │   │   ├── {song_id}_jukebox.pkl.gz # Analysis cache
│   │   │   └── yt_metadata_{video_id}.json  # Video metadata cache (NEW)
│   │   │
│   │   ├── temp/                       # Temporary storage (NEW)
│   │   │   ├── yt_{video_id}.webm      # Downloaded before conversion
│   │   │   ├── yt_{video_id}.m4a       # Downloaded before conversion
│   │   │   └── [cleaned up after extraction]
│   │   │
│   │   ├── app.py                      # Flask app (enhanced)
│   │   ├── Remixatron.py               # Audio analysis (existing)
│   │   ├── song_mapper.py              # Database (enhanced)
│   │   ├── youtube_extractor.py        # NEW module
│   │   └── rate_limiter.py             # NEW module
│   │
│   └── frontend/
│       └── src/
│           ├── components/
│           │   ├── FileUpload.tsx      # Enhanced with tabs
│           │   ├── YouTubeUrlTab.tsx   # NEW component
│           │   ├── YouTubePreview.tsx  # NEW component
│           │   └── ExtractionProgress.tsx  # NEW component
│           └── lib/
│               └── api.ts              # API client (enhanced)
│
└── specs/                              # NEW directory
    ├── youtube-url-input-feature.md    # This document
    ├── implementation-roadmap.md       # Implementation plan
    └── technical-architecture-diagram.md  # Architecture diagrams
```

### Cache Management

```
┌─────────────────────────────────────────────────────────────┐
│                     Cache Hierarchy                          │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Level 1: Extraction Cache                                   │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ yt_{video_id}.mp3                                        ││
│  │ - Keyed by YouTube video ID                              ││
│  │ - Prevents re-downloading same video                     ││
│  │ - TTL: Indefinite (until manual cleanup)                 ││
│  │ - Size: ~3-10 MB per file                                ││
│  └─────────────────────────────────────────────────────────┘│
│                         │                                     │
│                         │ if exists, skip extraction          │
│                         │                                     │
│  Level 2: Metadata Cache                                     │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ yt_metadata_{video_id}.json                              ││
│  │ - Video title, duration, thumbnail                       ││
│  │ - Speeds up preview display                              ││
│  │ - TTL: 7 days                                            ││
│  │ - Size: < 1 KB per file                                  ││
│  └─────────────────────────────────────────────────────────┘│
│                         │                                     │
│                         │ if exists, skip metadata fetch      │
│                         │                                     │
│  Level 3: Beat Cache                                         │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ {song_id}_beats.npy                                      ││
│  │ - Beat timestamps from Madmom                            ││
│  │ - Most expensive operation (30-120s)                     ││
│  │ - TTL: Indefinite                                        ││
│  │ - Size: ~10-50 KB per file                               ││
│  └─────────────────────────────────────────────────────────┘│
│                         │                                     │
│                         │ if exists, skip beat detection      │
│                         │                                     │
│  Level 4: Analysis Cache                                     │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ {song_id}_jukebox.pkl.gz                                 ││
│  │ - Complete InfiniteJukebox object                        ││
│  │ - All segments, clusters, jump candidates                ││
│  │ - TTL: Indefinite                                        ││
│  │ - Size: ~100-500 KB per file                             ││
│  └─────────────────────────────────────────────────────────┘│
│                         │                                     │
│                         │ if exists, return immediately       │
│                         │                                     │
└─────────────────────────────────────────────────────────────┘

Cache Hit Scenarios:
1. All cache miss: 45-150 seconds (full extraction + analysis)
2. L1 hit (extraction): 35-125 seconds (skip download)
3. L3 hit (beats): 5-15 seconds (skip beat detection)
4. L4 hit (analysis): 1-3 seconds (instant response)
```

---

## Security Architecture

### Security Layers

```
┌─────────────────────────────────────────────────────────────┐
│                    Security Layers                           │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Layer 1: Input Validation                                   │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Frontend:                                                 ││
│  │  - Regex validation of YouTube URL format                ││
│  │  - Client-side URL parsing                               ││
│  │                                                           ││
│  │ Backend:                                                  ││
│  │  - Whitelist YouTube domains only                        ││
│  │  - Reject non-YouTube URLs                               ││
│  │  - Validate video ID format (11 characters, [A-Za-z0-9_-])││
│  │  - Sanitize video metadata (bleach)                      ││
│  └─────────────────────────────────────────────────────────┘│
│                                                               │
│  Layer 2: Rate Limiting                                      │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Per IP: 10 requests / hour                               ││
│  │ Global: 100 requests / hour                              ││
│  │ Burst: 3 immediate requests                              ││
│  │                                                           ││
│  │ Implementation:                                           ││
│  │  - Token bucket algorithm                                ││
│  │  - In-memory storage (or Redis for distributed)          ││
│  │  - HTTP 429 response when exceeded                       ││
│  └─────────────────────────────────────────────────────────┘│
│                                                               │
│  Layer 3: Resource Limits                                    │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ - Max video duration: 30 minutes                         ││
│  │ - Max file size: 50 MB                                   ││
│  │ - Extraction timeout: 60 seconds                         ││
│  │ - Max concurrent extractions: 3                          ││
│  │ - Subprocess timeout (yt-dlp): 60 seconds                ││
│  └─────────────────────────────────────────────────────────┘│
│                                                               │
│  Layer 4: SSRF Prevention                                    │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ - Whitelist: Only youtube.com, youtu.be, m.youtube.com  ││
│  │ - Reject: localhost, 127.0.0.1, 0.0.0.0, internal IPs   ││
│  │ - Reject: file://, ftp://, etc.                          ││
│  │ - yt-dlp runs in subprocess with limited permissions     ││
│  └─────────────────────────────────────────────────────────┘│
│                                                               │
│  Layer 5: File System Security                               │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ - Restrict yt-dlp output to temp/ directory only         ││
│  │ - Validate file paths before access                      ││
│  │ - Use absolute paths, no user input in paths             ││
│  │ - Clean up temp files immediately after processing       ││
│  │ - Set proper file permissions (600 for audio files)      ││
│  └─────────────────────────────────────────────────────────┘│
│                                                               │
│  Layer 6: Logging & Monitoring                               │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ - Log all extraction requests (IP, URL, timestamp)       ││
│  │ - Log failures and errors                                ││
│  │ - Monitor for abuse patterns                             ││
│  │ - Alert on high error rates                              ││
│  │ - Anonymize logs after 7 days (GDPR)                     ││
│  └─────────────────────────────────────────────────────────┘│
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Deployment Architecture

### Production Deployment

```
┌─────────────────────────────────────────────────────────────┐
│                      Internet                                │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ HTTPS (443)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   Reverse Proxy (nginx)                      │
│                                                               │
│  - SSL/TLS termination                                       │
│  - Rate limiting (additional layer)                          │
│  - Static file serving (frontend)                            │
│  - Proxy to backend API                                      │
│  - Request logging                                           │
└────────────────────────┬────────────────────────────────────┘
                         │
         ┌───────────────┴───────────────┐
         │                               │
         ▼                               ▼
┌─────────────────────┐         ┌────────────────────────────┐
│   Frontend Server   │         │     Backend Server         │
│    (Next.js)        │         │      (Flask)               │
│                     │         │                            │
│  - Static files     │         │  - API endpoints           │
│  - Server-side      │         │  - YouTube extraction      │
│    rendering        │         │  - Audio analysis          │
│  - Port 3000        │         │  - Port 5001               │
└─────────────────────┘         └────────────┬───────────────┘
                                             │
                         ┌───────────────────┴───────────────┐
                         │                                   │
                         ▼                                   ▼
                ┌─────────────────┐              ┌───────────────────┐
                │  File Storage   │              │ External Services │
                │                 │              │                   │
                │ uploads/        │              │ - YouTube CDN     │
                │ ├─ songs.db     │              │ - yt-dlp updates  │
                │ ├─ *.mp3        │              └───────────────────┘
                │ ├─ *.npy        │
                │ └─ *.pkl.gz     │
                │                 │
                │ temp/           │
                │ └─ (cleaned)    │
                └─────────────────┘
```

### Docker Deployment (Optional)

```yaml
# docker-compose.yml

version: '3.8'

services:
  frontend:
    build: ./application/frontend
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_BASE_URL=http://backend:5001

  backend:
    build: ./application/backend
    ports:
      - "5001:5001"
    volumes:
      - ./uploads:/app/uploads
      - ./temp:/app/temp
    environment:
      - YOUTUBE_EXTRACTION_ENABLED=true
      - YOUTUBE_MAX_DURATION=1800
      - YOUTUBE_RATE_LIMIT=10

  nginx:
    image: nginx:latest
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - frontend
      - backend
```

---

## Monitoring & Observability

### Metrics Dashboard

```
┌─────────────────────────────────────────────────────────────┐
│            YouTube Extraction Metrics Dashboard              │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Extraction Success Rate                                     │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Success: ████████████████████░░ 85%                      ││
│  │ Failed:  ████░░░░░░░░░░░░░░░░░ 15%                      ││
│  └─────────────────────────────────────────────────────────┘│
│                                                               │
│  Average Extraction Time                                     │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ [Line chart showing trend]                               ││
│  │ Current: 42s | Target: <60s | P95: 78s                   ││
│  └─────────────────────────────────────────────────────────┘│
│                                                               │
│  Cache Hit Rate                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Extraction: ████████░░░░░░░░░░ 45%                      ││
│  │ Beat:       ██████████████░░░░ 72%                      ││
│  │ Analysis:   ████████████████░░ 85%                      ││
│  └─────────────────────────────────────────────────────────┘│
│                                                               │
│  Rate Limiting                                               │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Blocked requests: 23 (2.3%)                              ││
│  │ Top IPs: 192.168.1.100 (5), 10.0.0.50 (4)                ││
│  └─────────────────────────────────────────────────────────┘│
│                                                               │
│  Errors (Last 24h)                                           │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Video not found: 12                                      ││
│  │ Age restricted: 8                                        ││
│  │ Timeout: 5                                               ││
│  │ Network error: 3                                         ││
│  └─────────────────────────────────────────────────────────┘│
│                                                               │
│  Storage Usage                                               │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ uploads/: ████████░░░░░░░░░░░ 4.2 GB / 10 GB            ││
│  │ temp/:    ░░░░░░░░░░░░░░░░░░░ 0.1 GB                     ││
│  └─────────────────────────────────────────────────────────┘│
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

This technical architecture provides a comprehensive visual representation of how all components interact to enable YouTube URL input functionality in the Infinite Worship application.
