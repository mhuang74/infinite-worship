"""Handler/reaper unit tests via the injected r2/connect seams (#62).

Covers the hash-keyed Analysis write path: the analysis object key derives
from the content hash embedded in either song_id shape (upload and import),
not from the song_id itself; the reaper's pending-row delete touches only
media/<song_id> and never an analysis key (shared hash-keyed analyses must
survive reaping a pending sibling).

Stdlib unittest + injected fakes only, per repo convention (no mocks beyond
unittest.mock patching heavy IO/DSP seams).
"""

import unittest
import unittest.mock as mock

import handler
import reaper


class _FakeCursor:
    """Records SQL + params; a test can stage fetchall rows."""

    def __init__(self):
        self.executed = []  # (single-spaced SQL, params)
        self._fetchall = []

    def execute(self, sql, params=None):
        self.executed.append((" ".join(sql.split()), params))

    def stage_fetchall(self, rows):
        self._fetchall = rows

    def fetchall(self):
        return self._fetchall

    def fetchone(self):
        return self._fetchall[0] if self._fetchall else None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class _FakeConn:
    def __init__(self):
        self.cursor_obj = _FakeCursor()
        self.commits = 0

    def cursor(self):
        return self.cursor_obj

    def commit(self):
        self.commits += 1

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class _FakeR2:
    def __init__(self):
        self.put_objects = []
        self.deleted = []
        self.head_results = {}
        self.downloaded = []

    def head_object(self, Bucket, Key):
        return self.head_results.setdefault(
            Key, {"ContentType": "audio/mpeg", "ContentLength": 1024}
        )

    def download_file(self, Bucket, Key, Filename):
        self.downloaded.append(Key)

    def put_object(self, Bucket, Key, Body, ContentType):
        self.put_objects.append(
            {"Bucket": Bucket, "Key": Key, "Body": Body, "ContentType": ContentType}
        )

    def delete_objects(self, Bucket, Delete):
        self.deleted.append([o["Key"] for o in Delete["Objects"]])


class _FakeJukebox:
    """Stand-in for InfiniteJukebox: attribute surface _analyze reads."""

    duration = 42.0
    tempo = 120.0
    clusters = 3
    beats = []


_SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"


class TestContentHashFromSongId(unittest.TestCase):
    def test_upload_shape_takes_last_underscore_segment(self):
        # A urlsafe-b64 filename half can itself contain underscores (b64's
        # 62nd/63rd chars map to - and _); the LAST underscore splits the hash.
        song_id = f"a_b_c_{_SHA}"
        self.assertEqual(handler._content_hash_from_song_id(song_id), _SHA)

    def test_import_shape(self):
        self.assertEqual(handler._content_hash_from_song_id("imp_" + "ab" * 32), "ab" * 32)

    def test_rejects_non_hex_suffix(self):
        with self.assertRaises(handler.AnalysisError):
            handler._content_hash_from_song_id("imp_z" * 12 + "!")

    def test_rejects_short_suffix(self):
        with self.assertRaises(handler.AnalysisError):
            handler._content_hash_from_song_id("imp_deadbeef")


class TestAnalysisKeyIsHashKeyed(unittest.TestCase):
    """_analyze PUTs analysis/<content_hash>.json for both song_id shapes."""

    def _run_analyze(self, song_id):
        r2 = _FakeR2()
        conn = _FakeConn()
        with mock.patch("jukebox.InfiniteJukebox", return_value=_FakeJukebox()), \
             mock.patch.object(handler, "_to_analysis_json", return_value={"beats": []}), \
             mock.patch.object(handler, "MEDIA_BASE_URL", "https://media.invalid"):
            handler._analyze(r2, conn, song_id, f"media/{song_id}")
        return r2, conn

    def test_upload_shape_writes_hash_key(self):
        song_id = f"ZmlsZS5tcDM_{_SHA}"
        r2, conn = self._run_analyze(song_id)

        self.assertEqual(len(r2.put_objects), 1)
        self.assertEqual(r2.put_objects[0]["Key"], f"analysis/{_SHA}.json")

        update = [e for e in conn.cursor_obj.executed if "UPDATE songs" in e[0]][0]
        self.assertIn(f"analysis/{_SHA}.json", update[1][2])  # analysis_url param

    def test_import_shape_writes_hash_key(self):
        sha = "ff" * 32
        song_id = f"imp_{sha}"
        r2, _ = self._run_analyze(song_id)
        self.assertEqual(r2.put_objects[0]["Key"], f"analysis/{sha}.json")

    def test_update_sets_audio_url_from_destination_media_key(self):
        # audio_url stays media/<song_id> — the row's own playable audio —
        # even though the analysis key is now the shared hash key.
        song_id = f"imp_{_SHA}"
        r2, conn = self._run_analyze(song_id)
        update = [e for e in conn.cursor_obj.executed if "UPDATE songs" in e[0]][0]
        self.assertEqual(update[1][1], f"https://media.invalid/media/{song_id}")
        self.assertIn(f"media/{song_id}", update[1][1])


class TestConnectSeam(unittest.TestCase):
    """process_record must honor the injected connect() (not psycopg.connect
    directly) — the documented test seam. Regression: the original code bound
    `connect` then ignored it, so injected fakes never saw queries."""

    def test_process_record_uses_injected_connect(self):
        song_id = f"imp_{_SHA}"
        conn = _FakeConn()
        # 'ready' hits the idempotent-redrive guard: the seam is proven (the
        # status SELECT ran through the fake) without touching the DSP.
        conn.cursor_obj.stage_fetchall([("ready",)])
        r2 = _FakeR2()
        with mock.patch.dict("os.environ", {"DATABASE_URL": "postgresql://unused"}):
            status = handler.process_record(
                {"body": f'{{"song_id": "{song_id}", "audio_key": "media/{song_id}"}}',
                 "messageId": "m-1"},
                r2=r2,
                connect=lambda: conn,
            )
        # The fake conn was consulted (status SELECT ran through it) and no
        # real psycopg connection was attempted.
        self.assertTrue(any("SELECT status" in sql for sql, _ in conn.cursor_obj.executed))
        self.assertEqual(status, "ready")


class TestReaperNeverDeletesAnalysis(unittest.TestCase):
    """The reaper deletes exactly media/<song_id> for pending rows — no
    analysis key, ever (hash-keyed analyses are shared across Songs)."""

    def _reap(self, pending_rows):
        conn = _FakeConn()
        r2 = _FakeR2()
        conn.cursor_obj.stage_fetchall(pending_rows)
        reaper.reap(connect=lambda: conn, r2=r2)
        return r2

    def test_import_pending_row_deletes_only_media(self):
        song_id = f"imp_{_SHA}"
        r2 = self._reap([(song_id, f"https://media.example.com/media/{song_id}")])
        self.assertEqual(r2.deleted, [[f"media/{song_id}"]])

    def test_upload_pending_row_deletes_only_media(self):
        song_id = f"ab_c_{_SHA}"
        r2 = self._reap([(song_id, None)])  # audio_url NULL → fallback key
        self.assertEqual(r2.deleted, [[f"media/{song_id}"]])

    def test_no_analysis_key_for_any_row(self):
        sha2 = "cd" * 32
        r2 = self._reap(
            [
                (f"imp_{_SHA}", None),
                (f"up_{sha2}", f"https://media.example.com/media/imp_{sha2}"),
            ]
        )
        for batch in r2.deleted:
            for key in batch:
                self.assertFalse(key.startswith("analysis/"))


if __name__ == "__main__":
    unittest.main()