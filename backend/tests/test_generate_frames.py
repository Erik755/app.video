"""
GuionViral iteration 5 tests — /api/generate-frames endpoint (device-side frames).

Budget-aware: exactly ONE call that hits Gemini (the success case).
Rest are cheap checks (validation errors + light regression).
"""
import os
import base64
import subprocess
import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
)
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL / EXPO_BACKEND_URL must be set"
BASE_URL = BASE_URL.rstrip("/")

SAMPLE_MP4 = "/tmp/sample_frames.mp4"
FRAMES_DIR = "/tmp/sample_frames"


@pytest.fixture(scope="session")
def sample_frames_b64():
    """Build a small testsrc mp4 and extract 3 JPEG frames as base64 strings."""
    import imageio_ffmpeg
    ff = imageio_ffmpeg.get_ffmpeg_exe()

    if not os.path.exists(SAMPLE_MP4) or os.path.getsize(SAMPLE_MP4) == 0:
        subprocess.run(
            [ff, "-y", "-f", "lavfi", "-i",
             "testsrc=size=640x360:rate=10:duration=6",
             "-pix_fmt", "yuv420p", SAMPLE_MP4],
            capture_output=True, timeout=60, check=True,
        )

    os.makedirs(FRAMES_DIR, exist_ok=True)
    pattern = os.path.join(FRAMES_DIR, "f_%03d.jpg")
    subprocess.run(
        [ff, "-y", "-i", SAMPLE_MP4,
         "-vf", "fps=1/2,scale=640:-1", "-frames:v", "3",
         "-q:v", "4", pattern],
        capture_output=True, timeout=60, check=True,
    )

    frames_b64 = []
    for i in range(1, 4):
        p = os.path.join(FRAMES_DIR, f"f_{i:03d}.jpg")
        assert os.path.exists(p) and os.path.getsize(p) > 0, f"missing frame {p}"
        with open(p, "rb") as fh:
            frames_b64.append(base64.b64encode(fh.read()).decode("utf-8"))
    assert len(frames_b64) == 3
    return frames_b64


@pytest.fixture
def api():
    return requests.Session()


# ---------- /api/generate-frames — success (ONE Gemini call) ----------
class TestGenerateFramesSuccess:
    def test_generate_from_device_frames(self, api, sample_frames_b64):
        payload = {
            "frames": sample_frames_b64,
            "duration_seconds": 6,
            "tone": "viral",
            "style": "energetico y directo",
            "description": "TEST_video generado con testsrc",
            "title": "TEST_frames_success",
        }
        r = api.post(
            f"{BASE_URL}/api/generate-frames", json=payload, timeout=180,
        )
        assert r.status_code == 200, r.text
        item = r.json()

        # Structure & values
        assert item["source_type"] == "upload"
        assert item["source_url"] is None
        assert item["source_title"] == "TEST_frames_success"
        assert item["tone"] == "viral"
        assert item["style"] == "energetico y directo"
        assert item["frames_used"] == len(sample_frames_b64) == 3
        assert item["used_fallback"] is False

        # Script must be non-empty and reasonably long
        script = item["script_generado"]
        assert isinstance(script, str) and len(script.strip()) > 30

        # Thumbnail must be a data URI (JPEG)
        thumb = item["thumbnail"]
        assert thumb and thumb.startswith("data:image/jpeg;base64,")
        assert len(thumb) > 200  # non-trivial

        # No mongo _id leak
        assert "_id" not in item

        # Verify persistence via GET /api/history/{id}
        gid = item["id"]
        g = api.get(f"{BASE_URL}/api/history/{gid}", timeout=30)
        assert g.status_code == 200
        got = g.json()
        assert got["id"] == gid
        assert got["source_type"] == "upload"
        assert got["frames_used"] == 3
        assert "_id" not in got

        pytest.frames_item_id = gid


# ---------- /api/generate-frames — validation errors (no Gemini) ----------
class TestGenerateFramesValidation:
    def test_empty_frames_list_returns_400(self, api):
        r = api.post(
            f"{BASE_URL}/api/generate-frames",
            json={"frames": [], "tone": "viral"},
            timeout=30,
        )
        assert r.status_code == 400, r.text
        assert "fotogramas" in r.text.lower() or "frames" in r.text.lower()

    def test_invalid_base64_frames_returns_400(self, api):
        r = api.post(
            f"{BASE_URL}/api/generate-frames",
            json={"frames": ["@@@", "###"], "tone": "viral"},
            timeout=30,
        )
        assert r.status_code == 400, r.text


# ---------- Light regression (no Gemini) ----------
class TestLightRegression:
    def test_root_ok(self, api):
        r = api.get(f"{BASE_URL}/api/", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "online" in data.get("message", "").lower()

    def test_history_list_no_id_leak(self, api):
        r = api.get(f"{BASE_URL}/api/history", timeout=30)
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        for it in items[:10]:
            assert "_id" not in it
            assert "id" in it
            assert "script_generado" in it

    def test_files_tts_and_download(self, api):
        # Cheap OpenAI TTS call, saves to store, then verifies download.
        payload = {"text": "TEST prueba corta de audio.", "voice": "nova"}
        r = api.post(f"{BASE_URL}/api/files/tts", json=payload, timeout=60)
        assert r.status_code == 200, r.text
        media = r.json()
        assert media.get("kind") == "audio"
        assert media.get("content_type") == "audio/mpeg"
        assert media.get("size", 0) > 500
        assert media.get("url", "").startswith("/api/files/")
        assert "_id" not in media

        # Download it
        file_id = media["id"]
        d = api.get(f"{BASE_URL}/api/files/{file_id}", timeout=60)
        assert d.status_code == 200
        cd = d.headers.get("Content-Disposition", "")
        assert "attachment" in cd.lower()
        assert media["filename"] in cd
        assert d.headers.get("Content-Type", "").startswith("audio/mpeg")
        body = d.content
        # MP3 signature
        assert body[:3] == b"ID3" or body[0] == 0xFF
        assert len(body) == media["size"]

        # Cleanup
        api.delete(f"{BASE_URL}/api/files/{file_id}", timeout=15)


# ---------- Session cleanup ----------
@pytest.fixture(scope="session", autouse=True)
def cleanup_test_items():
    yield
    try:
        r = requests.get(f"{BASE_URL}/api/history", timeout=30)
        if r.ok:
            for it in r.json():
                title = (it.get("source_title") or "") + (it.get("script_generado") or "")
                if "TEST_" in title:
                    requests.delete(f"{BASE_URL}/api/history/{it['id']}", timeout=15)
    except Exception:
        pass
