# YouTube URL Input Feature - Testing Guide

**Version:** 1.0
**Date:** 2025-11-14
**Implementation Status:** ✅ Complete

---

## Overview

This guide provides instructions for testing the YouTube URL input feature in both development and production environments.

---

## Prerequisites

### Backend Requirements

1. **Python 3.8+** with pip
2. **yt-dlp** - YouTube download library
   ```bash
   pip install yt-dlp
   ```

3. **ffmpeg** - Audio/video processing (required by yt-dlp)
   ```bash
   # Ubuntu/Debian
   sudo apt-get install ffmpeg

   # macOS
   brew install ffmpeg

   # Windows
   # Download from https://ffmpeg.org/download.html
   ```

4. **Python dependencies**
   ```bash
   cd application/backend
   pip install -r requirements.txt
   ```

### Frontend Requirements

1. **Node.js 18+** and npm
2. **Next.js dependencies**
   ```bash
   cd application/frontend
   npm install
   ```

### Network Requirements

- **Internet access** to YouTube CDN
- **No corporate proxy** that blocks YouTube (or proxy configured for yt-dlp)
- **No SSL certificate issues** (common in Docker/sandboxed environments)

---

## Quick Start

### 1. Start Backend Server

```bash
cd application/backend
python app.py
```

Server should start on `http://localhost:5001`

### 2. Start Frontend Server

```bash
cd application/frontend
npm run dev
```

Frontend should start on `http://localhost:3000`

### 3. Access the Application

Open browser to `http://localhost:3000`

---

## Testing Scenarios

### Test 1: Basic URL Validation

**Objective:** Verify that URL validation works correctly.

**Steps:**
1. Navigate to "Upload New Song" tab
2. Click "YouTube URL" tab
3. Enter invalid URLs and verify error messages:
   - `http://example.com` → "Please enter a valid YouTube URL"
   - `not a url` → "Please enter a valid YouTube URL"
   - Empty string → No error (validation only on input)

**Expected Result:** Validation error appears immediately below input field.

---

### Test 2: Video Preview

**Objective:** Verify that video metadata is fetched and displayed.

**Test URL:** `https://youtu.be/0JjM9JBIjmg?si=wHZ5djwoLBA2hwva`

**Steps:**
1. Click "YouTube URL" tab
2. Paste the test URL
3. Click "Paste" button or click "Preview Video"
4. Wait for preview to load (~2-5 seconds)

**Expected Result:**
- Thumbnail image displays
- Video title appears
- Uploader name shown
- Duration formatted as MM:SS
- "Extract & Analyze" button appears

**API Call:**
```bash
curl -X POST http://localhost:5001/youtube-info \
  -H "Content-Type: application/json" \
  -d '{"url": "https://youtu.be/0JjM9JBIjmg?si=wHZ5djwoLBA2hwva"}'
```

**Expected Response:**
```json
{
  "video_id": "0JjM9JBIjmg",
  "title": "...",
  "duration": 123,
  "thumbnail": "https://...",
  "uploader": "..."
}
```

---

### Test 3: Full Extraction & Analysis

**Objective:** Complete end-to-end test of YouTube URL to playback.

**Test URL:** Use a short music video (2-4 minutes recommended for faster testing)

**Steps:**
1. Enter YouTube URL
2. Wait for preview to load
3. Click "Extract & Analyze" button
4. Observe progress messages:
   - "Validating URL..."
   - "Fetching video information..."
   - "Downloading audio from YouTube..."
   - "Analyzing beats and musical structure..."
5. Wait for analysis to complete (30 seconds to 2 minutes)

**Expected Result:**
- Progress bar animates
- Status messages update
- Song loads into player after completion
- Waveform visualization displays
- Beat segments are visible
- Song plays infinitely with jumps

**API Call:**
```bash
curl -X POST http://localhost:5001/extract-youtube \
  -H "Content-Type: application/json" \
  -d '{"url": "https://youtu.be/0JjM9JBIjmg?si=wHZ5djwoLBA2hwva"}'
```

**Expected Response:**
```json
{
  "song_id": "yt_0JjM9JBIjmg_...",
  "filename": "Video Title",
  "segments": [...],
  "duration": 123.45,
  "tempo": 120.0,
  "sample_rate": 44100,
  "youtube_metadata": {
    "video_id": "0JjM9JBIjmg",
    "title": "...",
    "uploader": "...",
    "thumbnail": "..."
  }
}
```

---

### Test 4: Cached Extraction

**Objective:** Verify that cached videos skip re-download.

**Steps:**
1. Extract a video (follow Test 3)
2. After completion, clear the page state
3. Enter the **same YouTube URL** again
4. Click "Extract & Analyze"

**Expected Result:**
- Extraction completes much faster (~5-10 seconds instead of 30-120 seconds)
- Console logs show "Using cached file for video {video_id}"
- Same playback quality as first extraction

**Cache Files Created:**
```
uploads/
├── yt_{video_id}.mp3           # Extracted audio (cached)
├── yt_{video_id}.mp3_beats.npy # Beat detection cache
└── yt_{video_id}.mp3_jukebox.pkl.gz  # Analysis cache
```

---

### Test 5: Rate Limiting

**Objective:** Verify that rate limiting prevents abuse.

**Steps:**
1. Extract 10 different YouTube videos rapidly
2. Attempt an 11th extraction

**Expected Result:**
- First 10 extractions succeed
- 11th extraction returns error:
  ```
  Rate limit exceeded. Please try again in X minutes.
  ```
- HTTP status: 429 (Too Many Requests)
- Error message displays in UI

**Test via API:**
```bash
# Run this script to test rate limiting
for i in {1..11}; do
  echo "Request $i:"
  curl -X POST http://localhost:5001/extract-youtube \
    -H "Content-Type: application/json" \
    -d '{"url": "https://youtu.be/VIDEO_ID_'$i'"}'
  echo -e "\n"
done
```

**Rate Limit Configuration:**
- Default: 10 requests per hour per IP
- Can be configured in `app.py`: `rate_limiter = RateLimiter(max_requests=10, window_seconds=3600)`

---

### Test 6: Error Handling

**Objective:** Verify graceful error handling for common failure scenarios.

#### 6.1 Invalid Video ID
```bash
curl -X POST http://localhost:5001/youtube-info \
  -H "Content-Type: application/json" \
  -d '{"url": "https://youtube.com/watch?v=INVALIDID"}'
```
**Expected:** Error message about video not found or unavailable

#### 6.2 Private/Deleted Video
Use a URL to a private or deleted video.

**Expected:** Error message "Failed to fetch video info" with details

#### 6.3 Network Error
Stop internet connection and attempt extraction.

**Expected:** "Network Error: Cannot reach the server."

#### 6.4 Video Too Long
Use a video > 30 minutes.

**Expected:** "Video too long: {duration}s (max 1800s)"

---

### Test 7: Tab Switching

**Objective:** Verify that both upload methods work independently.

**Steps:**
1. Click "Upload File" tab → Upload audio file → Verify playback
2. Click "YouTube URL" tab → Extract YouTube video → Verify playback
3. Switch back to "Upload File" tab → Upload different file → Verify playback
4. Switch to "YouTube URL" tab → Extract different video → Verify playback

**Expected Result:**
- Both upload methods work correctly
- No state interference between tabs
- Previous song is replaced when new song loads

---

### Test 8: Multiple URL Formats

**Objective:** Verify support for various YouTube URL formats.

**Test URLs:**
```
https://www.youtube.com/watch?v=0JjM9JBIjmg
https://youtu.be/0JjM9JBIjmg
https://m.youtube.com/watch?v=0JjM9JBIjmg
https://www.youtube.com/watch?v=0JjM9JBIjmg&t=30s
https://youtu.be/0JjM9JBIjmg?si=wHZ5djwoLBA2hwva
```

**Expected Result:**
- All URL formats successfully validate
- Video ID correctly extracted: `0JjM9JBIjmg`
- Metadata fetched for same video
- Timestamps (t=30s) ignored during extraction

---

## Database Verification

After extracting a YouTube video, verify database storage:

```bash
cd application/backend
sqlite3 uploads/songs.db

SELECT
  song_id,
  original_filename,
  youtube_video_id,
  youtube_title,
  youtube_uploader,
  source,
  duration,
  tempo,
  beats
FROM songs
WHERE source = 'youtube';
```

**Expected Result:**
```
song_id              | yt_0JjM9JBIjmg_abc123...
original_filename    | Video Title Here
youtube_video_id     | 0JjM9JBIjmg
youtube_title        | Video Title Here
youtube_uploader     | Channel Name
source               | youtube
duration             | 123.45
tempo                | 120.0
beats                | 245
```

---

## Troubleshooting

### Issue: SSL Certificate Verification Failed

**Symptoms:**
```
[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: self-signed certificate in certificate chain
```

**Cause:** Running in Docker or behind corporate proxy with SSL inspection

**Solution:** Already implemented in `youtube_extractor.py` with `nocheckcertificate: True`

If still failing, check proxy settings:
```bash
export HTTP_PROXY=http://proxy.example.com:8080
export HTTPS_PROXY=http://proxy.example.com:8080
```

---

### Issue: yt-dlp Extraction Failed

**Symptoms:**
```
ERROR: [youtube] Failed to extract any player response
```

**Cause:**
- YouTube API changes (yt-dlp needs update)
- Network restrictions
- Geo-blocking

**Solution:**
```bash
# Update yt-dlp to latest version
pip install --upgrade yt-dlp

# Verify yt-dlp works standalone
yt-dlp --version
yt-dlp -F https://youtube.com/watch?v=0JjM9JBIjmg
```

---

### Issue: Rate Limit Blocks Testing

**Symptoms:** Can't test after hitting rate limit

**Solution:**
```python
# Temporarily increase rate limit in app.py
rate_limiter = RateLimiter(max_requests=100, window_seconds=3600)

# OR reset rate limiter during development
# Add this endpoint temporarily:
@app.route('/reset-rate-limit', methods=['POST'])
def reset_rate_limit():
    global rate_limiter
    rate_limiter = RateLimiter(max_requests=10, window_seconds=3600)
    return jsonify({'message': 'Rate limiter reset'}), 200
```

---

### Issue: ffmpeg Not Found

**Symptoms:**
```
ERROR: ffmpeg not found. Please install ffmpeg
```

**Solution:**
```bash
# Verify ffmpeg installation
ffmpeg -version

# If not installed, install it:
# Ubuntu/Debian
sudo apt-get update && sudo apt-get install -y ffmpeg

# macOS
brew install ffmpeg

# Windows: Download from https://ffmpeg.org/download.html
```

---

### Issue: Frontend Can't Connect to Backend

**Symptoms:**
```
Network Error: The server is not responding.
```

**Solution:**
1. Verify backend is running: `curl http://localhost:5001/health`
2. Check `NEXT_PUBLIC_API_BASE_URL` in frontend `.env.local`
3. Ensure CORS is enabled in `app.py` (already configured)

---

## Performance Benchmarks

Expected performance on modern hardware:

| Operation | Time | Notes |
|-----------|------|-------|
| URL Validation | < 1ms | Regex-based, instant |
| Video Info Fetch | 2-5s | Network dependent |
| Audio Download | 10-30s | Depends on video length |
| Audio Conversion | 5-10s | ffmpeg processing |
| Beat Detection | 30-120s | Madmom analysis |
| **Total (First Time)** | **45-150s** | Full pipeline |
| **Total (Cached)** | **2-5s** | Cached extraction |

---

## Recommended Test Videos

| Duration | URL | Notes |
|----------|-----|-------|
| Short (< 2 min) | User provided | Quick testing |
| Medium (3-5 min) | Music videos | Typical use case |
| Long (> 10 min) | Podcasts | Stress test |
| Very Long (> 30 min) | Should fail | Max duration test |

---

## Success Criteria

The feature is working correctly if:

- ✅ All 8 test scenarios pass
- ✅ Both upload methods work independently
- ✅ Rate limiting prevents abuse
- ✅ Cached videos load quickly
- ✅ Error messages are clear and actionable
- ✅ Database correctly stores YouTube metadata
- ✅ Songs play infinitely with beat-synced jumps

---

## Known Limitations

1. **Sandboxed Environments:** May not work in Docker containers or restricted networks without proper SSL/proxy configuration
2. **YouTube Changes:** yt-dlp may break if YouTube makes significant API changes (requires yt-dlp update)
3. **Geo-restrictions:** Some videos may be unavailable in certain regions
4. **Age-restricted Videos:** Current implementation doesn't handle age-restricted content
5. **Copyright Detection:** Videos with copyright claims may fail extraction

---

## Next Steps

After successful testing:

1. **Production Deployment**
   - Configure rate limits for production traffic
   - Set up monitoring and alerting
   - Configure cleanup cron job for old cache files

2. **Optional Enhancements**
   - Implement progress polling via WebSocket
   - Add support for playlist URLs
   - Handle age-restricted videos
   - Add audio quality selection

3. **Documentation**
   - Update user-facing documentation
   - Create troubleshooting guide for users
   - Document legal considerations

---

## Support

For issues or questions:
- Review main specification: `specs/youtube-url-input-feature.md`
- Check implementation roadmap: `specs/implementation-roadmap.md`
- Review architecture: `specs/technical-architecture-diagram.md`

---

**Testing completed:** _______________
**Tested by:** _______________
**Environment:** Development / Staging / Production
**Result:** Pass / Fail
**Notes:** _______________
