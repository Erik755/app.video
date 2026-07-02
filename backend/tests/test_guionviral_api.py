"""
GuionViral backend tests
Covers: health, save-text, generate-upload (multipart mp4), generate (link),
history listing (no _id leak), and history item deletion.
"""
import os
import subprocess
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get(
    "EXPO_BACKEND_URL"
) or "https://viral-content-maker-26.preview.emergentagent.com"
BASE_URL = BASE_URL.rstrip("/")

SAMPLE_MP4 = "/tmp/sample.mp4"


@pytest.fixture(scope="session", autouse=True)
def ensure_sample_mp4():
    if not os.path.exists(SAMPLE_MP4) or os.path.getsize(SAMPLE_MP4) == 0:
        subprocess.run(
            ["ffmpeg", "-y", "-f", "lavfi", "-i",
             "testsrc=size=640x360:rate=10:duration=3",
             "-pix_fmt", "yuv420p", SAMPLE_MP4],
            capture_output=True, timeout=60, check=True,
        )
    yield


@pytest.fixture
def api():
    s = requests.Session()
    return s


# ---------------- Health ----------------
def test_root_returns_online(api):
    r = api.get(f"{BASE_URL}/api/", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert "message" in data
    assert "online" in data["message"].lower()


# ---------------- save-text ----------------
class TestSaveText:
    def test_save_text_success(self, api):
        payload = {"text": "TEST_texto de prueba para GuionViral"}
        r = api.post(f"{BASE_URL}/api/save-text", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        item = r.json()
        assert item["source_type"] == "text"
        assert item["script_generado"] == payload["text"]
        assert "id" in item and item["id"]
        assert "_id" not in item
        pytest.saved_text_id = item["id"]

    def test_save_text_empty_rejected(self, api):
        r = api.post(f"{BASE_URL}/api/save-text", json={"text": "   "}, timeout=15)
        assert r.status_code == 400


# ---------------- generate-upload ----------------
class TestGenerateUpload:
    def test_upload_mp4_returns_script(self, api):
        with open(SAMPLE_MP4, "rb") as fh:
            files = {"file": ("sample.mp4", fh, "video/mp4")}
            data = {
                "tone": "viral",
                "style": "divertido y juvenil",
                "description": "TEST_video de prueba",
                "title": "TEST_sample",
            }
            r = api.post(
                f"{BASE_URL}/api/generate-upload",
                files=files, data=data, timeout=180,
            )
        assert r.status_code == 200, r.text
        item = r.json()
        assert item["source_type"] == "upload"
        assert item["script_generado"] and len(item["script_generado"]) > 20
        assert item["frames_used"] >= 1
        assert item["thumbnail"] and item["thumbnail"].startswith("data:image/")
        assert "_id" not in item
        pytest.upload_id = item["id"]


# ---------------- generate (link) ----------------
class TestGenerateLink:
    def test_generate_link_youtube(self, api):
        # Network to YouTube may be blocked in sandbox; treat as env limitation.
        payload = {
            "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "tone": "viral",
        }
        r = api.post(f"{BASE_URL}/api/generate", json=payload, timeout=180)
        if r.status_code == 502:
            pytest.skip(f"Sandbox blocked link fetch: {r.text[:200]}")
        assert r.status_code == 200, r.text
        item = r.json()
        assert item["source_type"] == "link"
        assert item["script_generado"]
        assert "_id" not in item

    def test_generate_link_empty_url(self, api):
        r = api.post(f"{BASE_URL}/api/generate", json={"url": ""}, timeout=15)
        assert r.status_code == 400


# ---------------- history ----------------
class TestHistory:
    def test_history_list_no_id_leak_and_ordered(self, api):
        r = api.get(f"{BASE_URL}/api/history", timeout=30)
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        assert len(items) >= 1
        for it in items:
            assert "_id" not in it
            assert "id" in it and "script_generado" in it
        # newest first
        dates = [it["created_at"] for it in items]
        assert dates == sorted(dates, reverse=True)

    def test_delete_history_item(self, api):
        # Create a throwaway item then delete it
        r = api.post(
            f"{BASE_URL}/api/save-text",
            json={"text": "TEST_delete_me"}, timeout=15,
        )
        assert r.status_code == 200
        item_id = r.json()["id"]

        d = api.delete(f"{BASE_URL}/api/history/{item_id}", timeout=15)
        assert d.status_code == 200
        assert d.json().get("deleted") is True

        # verify gone
        g = api.get(f"{BASE_URL}/api/history/{item_id}", timeout=15)
        assert g.status_code == 404

    def test_delete_history_item_not_found(self, api):
        r = api.delete(f"{BASE_URL}/api/history/nonexistent-id-xyz", timeout=15)
        assert r.status_code == 404


@pytest.fixture(scope="session", autouse=True)
def cleanup_test_items():
    yield
    # best-effort cleanup: delete items with TEST_ prefix in title/text
    try:
        r = requests.get(f"{BASE_URL}/api/history", timeout=30)
        if r.ok:
            for it in r.json():
                title = (it.get("source_title") or "") + (it.get("script_generado") or "")
                if "TEST_" in title:
                    requests.delete(f"{BASE_URL}/api/history/{it['id']}", timeout=15)
    except Exception:
        pass
