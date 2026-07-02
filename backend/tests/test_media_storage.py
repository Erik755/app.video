"""
Tests for the new File & media storage integration (MongoDB GridFS).
Endpoints covered: /api/files/tts, /api/files/upload, /api/files, /api/files/{id} (GET, DELETE).
"""
import io
import os
import struct
import zlib
import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
)
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL / EXPO_BACKEND_URL must be set"
BASE_URL = BASE_URL.rstrip("/")


@pytest.fixture
def api():
    return requests.Session()


def _minimal_jpeg_bytes() -> bytes:
    """
    Backend only inspects the MIME type (image/jpeg -> kind='image'). Provide
    non-trivial payload with the JPEG SOI/EOI markers so it looks like a JPEG.
    """
    return b"\xff\xd8\xff\xe0" + b"TEST_pixel_payload_" * 32 + b"\xff\xd9"


def _unused_original_jpeg() -> bytes:
    return bytes.fromhex(
        "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707"
        "07090908"
        "0a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c283728"
        "2c2f3132"
        "3536353423393d38333c2e343536ffdb0043010909090c0b0c180d0d183332332332"
        "3333333333333333333333333333333333333333333333333333333333333333"
        "33333333"
        "33333333333333333333ffc0001108000100010301220002110103110103ffc4001f"
        "00000105"
        "0101010101010000000000000000010203040506070809000affc4"
        "00b510000201030302040305050404000001"
        "7d01020300041105122131410613516107227114328191a1082342b1c11552d1f024"
        "33627282"
        "090a161718191a25262728292a3435363738393a434445464748494a535455565758"
        "595a6364656667686"
        "96a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a"
        "9aaab2b3b4b5b6b"
        "7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f"
        "3f4f5f6f7f8f9faffda"
        "0008010100003f00fbd0ffd9"
    )


class TestFilesUploadAndGet:
    def test_upload_jpeg_then_get_and_list(self, api):
        img = _minimal_jpeg_bytes()
        # Fallback in case the minimal hex above is malformed: send raw bytes anyway,
        # backend does not decode the image, it just stores it.
        files = {"file": ("TEST_pixel.jpg", io.BytesIO(img), "image/jpeg")}
        r = api.post(f"{BASE_URL}/api/files/upload", files=files, timeout=30)
        assert r.status_code == 200, r.text
        item = r.json()
        assert item["kind"] == "image"
        assert item["content_type"] == "image/jpeg"
        assert item["size"] == len(img)
        assert item["url"] == f"/api/files/{item['id']}"
        assert item["filename"] == "TEST_pixel.jpg"
        assert "_id" not in item
        pytest.uploaded_image_id = item["id"]

        # GET the file
        g = api.get(f"{BASE_URL}{item['url']}", timeout=30)
        assert g.status_code == 200
        assert g.headers.get("content-type", "").startswith("image/jpeg")
        assert "attachment" in (g.headers.get("content-disposition") or "").lower()
        assert len(g.content) == item["size"]

        # List should contain it, no _id, sorted desc
        lst = api.get(f"{BASE_URL}/api/files", timeout=30)
        assert lst.status_code == 200
        arr = lst.json()
        assert isinstance(arr, list) and any(x["id"] == item["id"] for x in arr)
        for x in arr:
            assert "_id" not in x
        dates = [x["created_at"] for x in arr]
        assert dates == sorted(dates, reverse=True)

    def test_upload_empty_rejected(self, api):
        files = {"file": ("empty.bin", io.BytesIO(b""), "application/octet-stream")}
        r = api.post(f"{BASE_URL}/api/files/upload", files=files, timeout=15)
        assert r.status_code == 400


class TestFilesTTS:
    def test_tts_to_storage_nova(self, api):
        payload = {"text": "TEST audio para el store de GuionViral.", "voice": "nova"}
        r = api.post(f"{BASE_URL}/api/files/tts", json=payload, timeout=60)
        assert r.status_code == 200, r.text
        item = r.json()
        assert item["kind"] == "audio"
        assert item["content_type"] == "audio/mpeg"
        assert item["size"] > 1000
        assert item["filename"].endswith(".mp3")
        assert item["url"] == f"/api/files/{item['id']}"
        assert "_id" not in item
        pytest.tts_media_id = item["id"]

        # Download it and verify bytes look like MP3 (ID3 header or MPEG frame sync 0xFF)
        g = api.get(f"{BASE_URL}{item['url']}", timeout=60)
        assert g.status_code == 200
        assert g.headers.get("content-type", "").startswith("audio/mpeg")
        assert "attachment" in (g.headers.get("content-disposition") or "").lower()
        assert len(g.content) == item["size"]
        assert g.content[:3] == b"ID3" or g.content[0] == 0xFF

    def test_tts_empty_rejected(self, api):
        r = api.post(f"{BASE_URL}/api/files/tts", json={"text": "  "}, timeout=15)
        assert r.status_code == 400

    def test_get_nonexistent_returns_404(self, api):
        r = api.get(f"{BASE_URL}/api/files/000000000000000000000000", timeout=15)
        assert r.status_code == 404


class TestFilesDelete:
    def test_delete_then_get_404(self, api):
        # Create a small file to delete
        files = {"file": ("TEST_todelete.txt", io.BytesIO(b"hello"), "text/plain")}
        r = api.post(f"{BASE_URL}/api/files/upload", files=files, timeout=15)
        assert r.status_code == 200
        fid = r.json()["id"]

        d = api.delete(f"{BASE_URL}/api/files/{fid}", timeout=15)
        assert d.status_code == 200
        body = d.json()
        assert body.get("deleted") is True
        assert body.get("id") == fid

        g = api.get(f"{BASE_URL}/api/files/{fid}", timeout=15)
        assert g.status_code == 404

    def test_delete_nonexistent_returns_404(self, api):
        r = api.delete(f"{BASE_URL}/api/files/does-not-exist-xyz", timeout=15)
        assert r.status_code == 404


@pytest.fixture(scope="session", autouse=True)
def cleanup_media():
    yield
    try:
        r = requests.get(f"{BASE_URL}/api/files", timeout=30)
        if r.ok:
            for it in r.json():
                if "TEST_" in it.get("filename", "") or it.get("filename", "").startswith("guionviral_"):
                    requests.delete(f"{BASE_URL}/api/files/{it['id']}", timeout=15)
    except Exception:
        pass
