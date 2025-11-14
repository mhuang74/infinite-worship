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
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


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
            'nocheckcertificate': True,  # Skip SSL verification (for sandboxed environments)
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
                logger.error(f"Failed to fetch video info: {str(e)}")
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
            logger.info(f"Using cached file for video {video_id}")
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
            'nocheckcertificate': True,  # Skip SSL verification (for sandboxed environments)
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
                logger.info(f"Extracting audio from {url}")
                info = ydl.extract_info(url, download=True)

                # Move from temp to output directory
                temp_file = os.path.join(self.temp_dir, f'yt_{video_id}.{self.AUDIO_FORMAT}')
                final_file = os.path.join(self.output_dir, f'yt_{video_id}.{self.AUDIO_FORMAT}')

                if os.path.exists(temp_file):
                    os.rename(temp_file, final_file)
                    logger.info(f"Audio extracted successfully: {final_file}")
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
                logger.error(f"Extraction failed: {str(e)}")
                raise Exception(f"Extraction failed: {str(e)}")

    def _find_existing_file(self, video_id: str) -> Optional[str]:
        """Check if audio file already exists for this video ID."""
        expected_file = os.path.join(self.output_dir, f'yt_{video_id}.{self.AUDIO_FORMAT}')
        if os.path.exists(expected_file):
            return expected_file
        return None

    def _cleanup_temp_files(self, video_id: str):
        """Remove temporary files for a video ID."""
        import glob
        patterns = [
            os.path.join(self.temp_dir, f'yt_{video_id}.*'),
            os.path.join(self.temp_dir, f'{video_id}.*'),
        ]

        for pattern in patterns:
            for file in glob.glob(pattern):
                try:
                    os.remove(file)
                    logger.info(f"Cleaned up temp file: {file}")
                except Exception as e:
                    logger.warning(f"Failed to cleanup {file}: {str(e)}")
