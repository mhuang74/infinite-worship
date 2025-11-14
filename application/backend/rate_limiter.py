"""
Rate limiting for YouTube extraction requests.
Implements token bucket algorithm to prevent abuse.
"""

from datetime import datetime, timedelta
from typing import Dict, Tuple
import threading
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


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
                logger.warning(f"Rate limit exceeded for IP: {ip}")
                return False, 0

            # Record this request
            self.requests[ip].append(now)
            remaining = self.max_requests - (current_count + 1)

            logger.info(f"Request allowed for IP {ip}. Remaining: {remaining}")
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
                logger.info(f"Cleaned up rate limit data for IP: {ip}")
