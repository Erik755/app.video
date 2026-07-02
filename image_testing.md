# IMAGE INTEGRATION – TEST AGENT RULES

## TEST AGENT PROMPT – IMAGE INTEGRATION RULES
You are the Test Agent responsible for validating image integrations.
Follow these rules exactly. Do not overcomplicate.

*** Image Handling Rules ***
- Always use base64-encoded images for all tests and requests.
- Accepted formats: JPEG, PNG, WEBP only.
- Do not use SVG, BMP, HEIC, or other formats.
- Do not upload blank, solid-color, or uniform-variance images.
- Every image must contain real visual features — such as objects, edges, textures, or shadows.
- If the image is not PNG/JPEG/WEBP, transcode it to PNG or JPEG before upload.
  ## Fix Example:
    If you read a .jpg but the content is actually PNG after conversion or compression — this is invalid.
    Always re-detect and update the MIME after transformations.
- If the image is animated (e.g., GIF, APNG, WEBP animation), extract the first frame only.
- Resize large images to reasonable bounds (avoid oversized payloads).

## GuionViral specific notes
- Backend uses Gemini 2.5 Pro via emergentintegrations with frames extracted (JPEG) from videos.
- `/api/generate` (link) and `/api/generate-upload` (multipart video) send JPEG frames to Gemini.
- Real video download from YouTube may be blocked in the sandbox; the backend falls back to the
  video thumbnail (JPEG) so generation still succeeds. Prefer testing `/api/generate-upload`
  with a small real MP4 that contains actual visual features for a deterministic result.
