"""Infinite Jukebox audio analysis pipeline.

Ports the live analysis code from exploration/remixatron/Remixatron.py as a
proper installable package (see docs/adr/0003-repo-layout-and-teardown.md),
replacing the sys.path hack application/backend/app.py used to import it.
"""

from jukebox.remixatron import InfiniteJukebox

__all__ = ["InfiniteJukebox"]
