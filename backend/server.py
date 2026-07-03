"""
GuionViral backend.

Pipeline (POST /api/generate para enlaces, POST /api/generate-upload para video de galería):
  1a. Enlace: yt-dlp obtiene metadatos y descarga el video en baja resolución.
  1b. Galería: se recibe el archivo de video subido por el usuario.
  2.  ffmpeg extrae fotogramas espaciados del video (respaldo: miniatura del enlace).
  3.  Los fotogramas + metadatos + (opcional) descripción y estilo del usuario se envían a
      Gemini 2.5 Pro para analizar tema/tono/estructura y generar un guion ORIGINAL viral en español.
  4.  El guion se guarda en MongoDB (historial) y se devuelve a la app para leerlo en voz alta.
"""
import aiofiles, subprocess, shutil, tempfile, time, os
import os
import re
import uuid
import shutil
import base64
import logging
import asyncio
import tempfile
import subprocess
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Optional

import requests
from bson import ObjectId
from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorGridFSBucket
from pydantic import BaseModel, Field

from emergentintegrations.llm.chat import (
    LlmChat,
    UserMessage,
    FileContentWithMimeType,
)
from emergentintegrations.llm.openai.text_to_speech import OpenAITextToSpeech
@app.post("/api/merge-video-audio")
async def merge_video_audio(
    video: UploadFile = File(...),
    audio: UploadFile = File(...),
):
    work_dir = tempfile.mkdtemp()
    try:
        ext = os.path.splitext(video.filename or ".mp4")[1] or ".mp4"
        video_path = os.path.join(work_dir, f"input_video{ext}")
        audio_path = os.path.join(work_dir, "input_audio.mp3")
        output_path = os.path.join(work_dir, "output.mp4")

        async with aiofiles.open(video_path, "wb") as f:
            while chunk := await video.read(1024 * 1024):
                await f.write(chunk)

        async with aiofiles.open(audio_path, "wb") as f:
            while chunk := await audio.read(1024 * 1024):
                await f.write(chunk)
import aiofiles, subprocess, shutil, tempfile, time, os, asyncio
        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-i", audio_path,
            "-c:v", "copy",
            "-c:a", "aac",
            "-map", "0:v:0",
            "-map", "1:a:0",
            "-shortest",
            output_path,
        ]
        proc = await asyncio.to_thread(
            subprocess.run, cmd, capture_output=True, text=True
        )
        if proc.returncode != 0:
            raise HTTPException(status_code=500, detail=f"ffmpeg: {proc.stderr}")

        async with aiofiles.open(output_path, "rb") as f:
            video_bytes = await f.read()

        filename = f"guionviral_video_{int(time.time())}.mp4"
        media = await _store_media(video_bytes, filename, "video/mp4")
        return media
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]
# Almacenamiento de archivos/media (File & media storage) sobre MongoDB GridFS.
# Persistente y sin credenciales externas. Sustituible por S3 si se proveen claves.
fs = AsyncIOMotorGridFSBucket(db, bucket_name="media")

app = FastAPI(title="GuionViral API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("guionviral")

# ffmpeg empaquetado vía pip (imageio-ffmpeg) para que persista entre reinicios
# del contenedor (una instalación con apt no sobrevive a un rebuild).
try:
    import imageio_ffmpeg

    FFMPEG_BIN = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:  # pragma: no cover
    FFMPEG_BIN = "ffmpeg"

MAX_FRAMES = 6
GEMINI_MODEL = "gemini-2.5-pro"
TTS_MODEL = "tts-1"
TTS_DEFAULT_VOICE = "nova"
TTS_MAX_CHARS = 3900
# Ritmo aproximado de lectura del TTS en español (palabras por segundo).
TTS_WORDS_PER_SEC = 2.4
# Tope de duración objetivo para no disparar el costo con videos muy largos.
MAX_TARGET_SECONDS = 300

SYSTEM_PROMPT = (
    "Eres un experto creador de contenido viral en español. "
    "Analizas el tema, el tono y la estructura del contenido multimedia que se te muestra "
    "y generas un guion NUEVO y ORIGINAL, altamente viral, basado en esos conceptos. "
    "El guion debe estar listo para ser leído en voz alta: usa un lenguaje natural, "
    "con gancho inicial potente, desarrollo claro y un cierre con llamada a la acción. "
    "Responde ÚNICAMENTE con el texto del guion, sin encabezados, sin markdown, sin notas."
)


# --------------------------- Modelos ---------------------------
class GenerateRequest(BaseModel):
    url: str
    tone: Optional[str] = "viral"
    style: Optional[str] = None        # estilo libre definido por el usuario (opcional)
    description: Optional[str] = None  # descripción del video escrita por el usuario (opcional)


class ScriptItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    source_type: str = "link"  # "link" | "upload" | "text"
    source_url: Optional[str] = None
    source_title: Optional[str] = None
    thumbnail: Optional[str] = None  # base64 data uri
    script_generado: str
    tone: Optional[str] = "viral"
    style: Optional[str] = None
    frames_used: int = 0
    used_fallback: bool = False
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class SaveTextRequest(BaseModel):
    text: str
    title: Optional[str] = None


class FramesRequest(BaseModel):
    frames: List[str]  # fotogramas JPEG en base64 (extraídos en el dispositivo)
    duration_seconds: Optional[float] = 0
    tone: Optional[str] = "viral"
    style: Optional[str] = None
    description: Optional[str] = None
    title: Optional[str] = None


class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = None


class MediaItem(BaseModel):
    id: str
    filename: str
    content_type: str
    size: int
    kind: str  # "audio" | "image" | "video" | "file"
    url: str
    created_at: str


# --------------------------- Utilidades de video ---------------------------
def _extract_frames(video_path: str, workdir: str, duration: float = 0.0) -> List[str]:
    """
    Extrae fotogramas de un video con un único comando ffmpeg (sin ffprobe).
    Toma 1 fotograma cada ~2s hasta MAX_FRAMES; si el video es muy corto y no
    se obtiene nada, cae a extraer el primer fotograma.
    """
    frames: List[str] = []
    if not (video_path and os.path.exists(video_path) and os.path.getsize(video_path) > 0):
        return frames

    pattern = os.path.join(workdir, "frame_%03d.jpg")
    try:
        subprocess.run(
            [FFMPEG_BIN, "-y", "-i", video_path,
             "-vf", "fps=1/2,scale=640:-1", "-frames:v", str(MAX_FRAMES),
             "-q:v", "4", pattern],
            capture_output=True, timeout=90,
        )
    except Exception as e:
        logger.warning("ffmpeg (fps) falló: %s", e)

    for i in range(1, MAX_FRAMES + 1):
        p = os.path.join(workdir, f"frame_{i:03d}.jpg")
        if os.path.exists(p) and os.path.getsize(p) > 0:
            frames.append(p)

    # Respaldo: primer fotograma para videos muy cortos.
    if not frames:
        out = os.path.join(workdir, "frame_first.jpg")
        try:
            subprocess.run(
                [FFMPEG_BIN, "-y", "-i", video_path, "-frames:v", "1",
                 "-vf", "scale=640:-1", "-q:v", "4", out],
                capture_output=True, timeout=45,
            )
            if os.path.exists(out) and os.path.getsize(out) > 0:
                frames.append(out)
        except Exception as e:
            logger.warning("ffmpeg (primer frame) falló: %s", e)

    return frames


def _video_duration(video_path: str) -> float:
    """Obtiene la duración (segundos) de un video parseando la salida de ffmpeg."""
    if not (video_path and os.path.exists(video_path)):
        return 0.0
    try:
        r = subprocess.run(
            [FFMPEG_BIN, "-i", video_path], capture_output=True, text=True, timeout=30
        )
        m = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.?\d*)", r.stderr or "")
        if m:
            h, mn, s = m.groups()
            return int(h) * 3600 + int(mn) * 60 + float(s)
    except Exception as e:
        logger.warning("No se pudo obtener duración: %s", e)
    return 0.0


def _extract_video_context(url: str) -> dict:
    """Trabajo síncrono y pesado para ENLACES. Se ejecuta en un hilo aparte."""
    import yt_dlp

    workdir = tempfile.mkdtemp(prefix="guionviral_")
    result = {
        "title": None,
        "description": None,
        "thumbnail_bytes": None,
        "frame_paths": [],
        "used_fallback": False,
        "workdir": workdir,
        "duration": 0,
    }

    info = None
    try:
        with yt_dlp.YoutubeDL(
            {"quiet": True, "no_warnings": True, "skip_download": True, "socket_timeout": 20}
        ) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        logger.warning("No se pudieron obtener metadatos: %s", e)

    if info:
        result["title"] = info.get("title")
        result["description"] = (info.get("description") or "")[:1500]
        result["duration"] = info.get("duration") or 0
        thumb = info.get("thumbnail")
        if thumb:
            try:
                r = requests.get(thumb, timeout=15)
                if r.ok:
                    result["thumbnail_bytes"] = r.content
            except Exception as e:
                logger.warning("No se pudo bajar la miniatura: %s", e)

    video_path = None
    try:
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "outtmpl": os.path.join(workdir, "video.%(ext)s"),
            "format": "bv*[height<=480]/b[height<=480]/worst",
            "merge_output_format": "mp4",
            "socket_timeout": 25,
            "noplaylist": True,
            "ffmpeg_location": FFMPEG_BIN,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        for f in os.listdir(workdir):
            if f.startswith("video."):
                video_path = os.path.join(workdir, f)
                break
    except Exception as e:
        logger.warning("Descarga de video fallida: %s", e)
        video_path = None

    result["frame_paths"] = _extract_frames(video_path, workdir, result["duration"])

    # Si yt-dlp no dio duración, intentar obtenerla del archivo descargado.
    if not result["duration"] and video_path and os.path.exists(video_path):
        result["duration"] = _video_duration(video_path)

    # Respaldo: miniatura como único fotograma
    if not result["frame_paths"] and result["thumbnail_bytes"]:
        thumb_path = os.path.join(workdir, "thumb.jpg")
        try:
            with open(thumb_path, "wb") as fh:
                fh.write(result["thumbnail_bytes"])
            result["frame_paths"].append(thumb_path)
            result["used_fallback"] = True
        except Exception as e:
            logger.warning("No se pudo guardar la miniatura: %s", e)

    return result


async def _generate_script_with_gemini(
    ctx: dict,
    tone: str,
    style: Optional[str] = None,
    user_description: Optional[str] = None,
) -> str:
    """Envía los fotogramas + metadatos a Gemini 2.5 Pro y devuelve el guion."""
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY no configurada.")

    title = ctx.get("title") or "Contenido de video"
    description = ctx.get("description") or ""
    frames = ctx.get("frame_paths", [])

    tono_map = {
        "viral": "altamente viral y llamativo",
        "educativo": "educativo y claro",
        "humor": "divertido y con humor",
        "motivacional": "motivacional e inspirador",
    }
    # El estilo libre del usuario tiene prioridad sobre el preset.
    if style and style.strip():
        estilo_desc = style.strip()
    else:
        estilo_desc = tono_map.get(tone, "altamente viral")

    partes = [f"Título del video original: {title}"]
    if description:
        partes.append(f"Descripción disponible (metadatos): {description}")
    if user_description and user_description.strip():
        partes.append(f"El usuario describe el video así: {user_description.strip()}")

    # Objetivo de duración: el guion, leído en voz alta, debe durar ~ lo mismo
    # que el video de muestra. Estimamos las palabras necesarias por el ritmo TTS.
    duration = float(ctx.get("duration") or 0)
    target_seconds = min(duration, MAX_TARGET_SECONDS) if duration > 0 else 0
    if target_seconds >= 1:
        target_words = max(int(round(target_seconds * TTS_WORDS_PER_SEC)), 12)
        partes.append(
            f"IMPORTANTE — DURACIÓN: el video dura {int(round(target_seconds))} segundos. "
            f"El guion, leído en voz alta a ritmo normal, debe durar aproximadamente esa "
            f"misma cantidad de tiempo, es decir, unas {target_words} palabras (±10%). "
            f"Si el contenido visual no da para tanto, COMPLETA con datos interesantes, "
            f"conceptos, curiosidades, ideas y contexto adicional relacionados con el tema "
            f"del video, de forma fluida, original y coherente (nada de relleno vacío ni "
            f"repeticiones). Ajusta la extensión para cumplir la duración objetivo."
        )

    partes.append(
        f"A continuación se muestran {len(frames)} fotograma(s) extraído(s) del video. "
        f"Analiza el tema, el tono y la estructura visual del contenido y crea un guion "
        f"NUEVO y original con este estilo: '{estilo_desc}'. Escríbelo en español y listo "
        f"para leer en voz alta."
    )
    user_text = "\n\n".join(partes)

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"guionviral-{uuid.uuid4()}",
        system_message=SYSTEM_PROMPT,
    ).with_model("gemini", GEMINI_MODEL)

    file_contents = [
        FileContentWithMimeType(file_path=fp, mime_type="image/jpeg") for fp in frames
    ]

    message = UserMessage(text=user_text, file_contents=file_contents)
    response = await chat.send_message(message)

    if isinstance(response, str):
        return response.strip()
    return str(getattr(response, "text", response)).strip()


def _thumb_to_datauri(thumb_bytes: Optional[bytes]) -> Optional[str]:
    if not thumb_bytes:
        return None
    b64 = base64.b64encode(thumb_bytes).decode("utf-8")
    return f"data:image/jpeg;base64,{b64}"


# --------------------------- Endpoints ---------------------------
@api_router.get("/")
async def root():
    return {"message": "GuionViral API online"}


@api_router.post("/generate", response_model=ScriptItem)
async def generate_script(req: GenerateRequest):
    """Genera un guion a partir de un ENLACE de video."""
    url = req.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="Debes enviar un enlace válido.")

    logger.info("Procesando enlace: %s", url)
    ctx = await asyncio.to_thread(_extract_video_context, url)

    workdir = ctx.get("workdir")
    try:
        if not ctx.get("frame_paths") and not ctx.get("title"):
            raise HTTPException(
                status_code=502,
                detail="No se pudo acceder al contenido del enlace. Verifica la URL e inténtalo de nuevo.",
            )

        script = await _generate_script_with_gemini(
            ctx, req.tone or "viral", req.style, req.description
        )
        if not script:
            raise HTTPException(status_code=502, detail="La IA no devolvió ningún guion.")

        item = ScriptItem(
            source_type="link",
            source_url=url,
            source_title=ctx.get("title"),
            thumbnail=_thumb_to_datauri(ctx.get("thumbnail_bytes")),
            script_generado=script,
            tone=req.tone or "viral",
            style=req.style,
            frames_used=len(ctx.get("frame_paths", [])),
            used_fallback=ctx.get("used_fallback", False),
        )
        await db.scripts.insert_one(item.dict())
        return item
    finally:
        if workdir and os.path.isdir(workdir):
            shutil.rmtree(workdir, ignore_errors=True)


@api_router.post("/generate-upload", response_model=ScriptItem)
async def generate_from_upload(
    file: UploadFile = File(...),
    tone: str = Form("viral"),
    style: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    title: Optional[str] = Form(None),
):
    """Genera un guion a partir de un VIDEO subido desde la galería."""
    workdir = tempfile.mkdtemp(prefix="guionviral_up_")
    ext = os.path.splitext(file.filename or "video.mp4")[1] or ".mp4"
    video_path = os.path.join(workdir, f"upload{ext}")

    try:
        # Guardar el archivo subido en disco.
        with open(video_path, "wb") as fh:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                fh.write(chunk)

        if os.path.getsize(video_path) == 0:
            raise HTTPException(status_code=400, detail="El video está vacío.")

        # Extraer fotogramas (trabajo pesado en hilo aparte).
        frames = await asyncio.to_thread(_extract_frames, video_path, workdir, 0.0)
        if not frames:
            raise HTTPException(
                status_code=502,
                detail="No se pudieron extraer fotogramas del video. Intenta con otro archivo.",
            )

        # Duración real del video subido (para ajustar la longitud del guion).
        duration = await asyncio.to_thread(_video_duration, video_path)

        # Miniatura para el historial: primer fotograma en base64.
        thumb_uri = None
        try:
            with open(frames[0], "rb") as fh:
                thumb_uri = _thumb_to_datauri(fh.read())
        except Exception:
            thumb_uri = None

        ctx = {
            "title": title or (file.filename or "Video de galería"),
            "description": "",
            "frame_paths": frames,
            "duration": duration,
        }
        script = await _generate_script_with_gemini(ctx, tone, style, description)
        if not script:
            raise HTTPException(status_code=502, detail="La IA no devolvió ningún guion.")

        item = ScriptItem(
            source_type="upload",
            source_url=None,
            source_title=ctx["title"],
            thumbnail=thumb_uri,
            script_generado=script,
            tone=tone,
            style=style,
            frames_used=len(frames),
            used_fallback=False,
        )
        await db.scripts.insert_one(item.dict())
        return item
    finally:
        if workdir and os.path.isdir(workdir):
            shutil.rmtree(workdir, ignore_errors=True)


@api_router.post("/generate-frames", response_model=ScriptItem)
async def generate_from_frames(req: FramesRequest):
    """
    Genera un guion a partir de FOTOGRAMAS ya extraídos en el dispositivo.
    Evita subir el video completo (rápido y confiable en móviles, cualquier formato).
    """
    if not req.frames:
        raise HTTPException(status_code=400, detail="No se recibieron fotogramas del video.")

    workdir = tempfile.mkdtemp(prefix="guionviral_fr_")
    try:
        frame_paths: List[str] = []
        for i, b64 in enumerate(req.frames[:MAX_FRAMES + 2]):
            data = b64.split(",", 1)[1] if b64.startswith("data:") else b64
            try:
                raw = base64.b64decode(data)
            except Exception:
                continue
            if not raw:
                continue
            p = os.path.join(workdir, f"frame_{i:03d}.jpg")
            with open(p, "wb") as fh:
                fh.write(raw)
            frame_paths.append(p)

        if not frame_paths:
            raise HTTPException(status_code=400, detail="Los fotogramas no son válidos.")

        thumb_uri = None
        try:
            with open(frame_paths[0], "rb") as fh:
                thumb_uri = _thumb_to_datauri(fh.read())
        except Exception:
            thumb_uri = None

        ctx = {
            "title": req.title or "Video de galería",
            "description": "",
            "frame_paths": frame_paths,
            "duration": req.duration_seconds or 0,
        }
        script = await _generate_script_with_gemini(
            ctx, req.tone or "viral", req.style, req.description
        )
        if not script:
            raise HTTPException(status_code=502, detail="La IA no devolvió ningún guion.")

        item = ScriptItem(
            source_type="upload",
            source_url=None,
            source_title=ctx["title"],
            thumbnail=thumb_uri,
            script_generado=script,
            tone=req.tone or "viral",
            style=req.style,
            frames_used=len(frame_paths),
            used_fallback=False,
        )
        await db.scripts.insert_one(item.dict())
        return item
    finally:
        if workdir and os.path.isdir(workdir):
            shutil.rmtree(workdir, ignore_errors=True)


@api_router.post("/save-text", response_model=ScriptItem)
async def save_text(req: SaveTextRequest):
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="El texto no puede estar vacío.")
    item = ScriptItem(
        source_type="text",
        source_title=req.title or "Texto directo",
        script_generado=text,
    )
    await db.scripts.insert_one(item.dict())
    return item


def _chunk_text(text: str, size: int = TTS_MAX_CHARS) -> List[str]:
    """Divide un texto largo en fragmentos <= size respetando fin de frase."""
    text = text.strip()
    if len(text) <= size:
        return [text]
    chunks: List[str] = []
    cur = ""
    for sent in re.split(r"(?<=[.!?\n])\s+", text):
        if len(cur) + len(sent) + 1 > size:
            if cur:
                chunks.append(cur)
                cur = sent
            else:
                # frase única más larga que el límite: cortar duro
                chunks.append(sent[:size])
                cur = sent[size:]
        else:
            cur = (cur + " " + sent).strip()
    if cur:
        chunks.append(cur)
    return chunks


async def _synthesize_tts(text: str, voice: str) -> bytes:
    """Sintetiza voz con OpenAI TTS (vía Emergent Key). Une fragmentos largos."""
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY no configurada.")
    tts = OpenAITextToSpeech(api_key=EMERGENT_LLM_KEY)
    audio = b""
    for chunk in _chunk_text(text):
        part = await tts.generate_speech(
            text=chunk,
            model=TTS_MODEL,
            voice=voice,
            response_format="mp3",
        )
        audio += part
    return audio


@api_router.post("/tts")
async def synthesize_audio(req: TTSRequest):
    """Genera un archivo MP3 (base64) a partir del texto para descargar en la app."""
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="El texto no puede estar vacío.")
    voice = req.voice or TTS_DEFAULT_VOICE
    if voice not in OpenAITextToSpeech.VOICES:
        voice = TTS_DEFAULT_VOICE
    try:
        audio = await _synthesize_tts(text, voice)
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("Fallo TTS: %s", e)
        raise HTTPException(status_code=502, detail="No se pudo generar el audio.")
    return {
        "audio_base64": base64.b64encode(audio).decode("utf-8"),
        "mime": "audio/mpeg",
        "voice": voice,
    }


# --------------------------- Almacenamiento de archivos/media ---------------------------
def _guess_kind(content_type: str) -> str:
    if content_type.startswith("audio"):
        return "audio"
    if content_type.startswith("image"):
        return "image"
    if content_type.startswith("video"):
        return "video"
    return "file"


async def _store_media(data: bytes, filename: str, content_type: str) -> MediaItem:
    """Guarda bytes en GridFS + metadatos en la colección `media`. Devuelve MediaItem."""
    kind = _guess_kind(content_type)
    file_id = await fs.upload_from_stream(
        filename, data, metadata={"content_type": content_type, "kind": kind}
    )
    fid = str(file_id)
    created_at = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": fid,
        "filename": filename,
        "content_type": content_type,
        "size": len(data),
        "kind": kind,
        "url": f"/api/files/{fid}",
        "created_at": created_at,
    }
    await db.media_files.insert_one(dict(doc))
    return MediaItem(**doc)


@api_router.post("/files/tts", response_model=MediaItem)
async def tts_to_storage(req: TTSRequest):
    """Sintetiza el texto con OpenAI TTS, lo guarda en el store y devuelve una URL."""
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="El texto no puede estar vacío.")
    voice = req.voice or TTS_DEFAULT_VOICE
    if voice not in OpenAITextToSpeech.VOICES:
        voice = TTS_DEFAULT_VOICE
    try:
        audio = await _synthesize_tts(text, voice)
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("Fallo TTS storage: %s", e)
        raise HTTPException(status_code=502, detail="No se pudo generar el audio.")
    filename = f"guionviral_{voice}_{int(datetime.now(timezone.utc).timestamp())}.mp3"
    return await _store_media(audio, filename, "audio/mpeg")


@api_router.post("/files/upload", response_model=MediaItem)
async def upload_media(file: UploadFile = File(...)):
    """Sube cualquier archivo (imagen, audio, video, etc.) al store y devuelve una URL."""
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="El archivo está vacío.")
    filename = file.filename or "archivo"
    content_type = file.content_type or "application/octet-stream"
    return await _store_media(data, filename, content_type)


@api_router.get("/files", response_model=List[MediaItem])
async def list_media():
    docs = await db.media_files.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [MediaItem(**d) for d in docs]


@api_router.get("/files/{file_id}")
async def download_media(file_id: str):
    """Descarga/stream de un archivo del store (URL recuperable)."""
    doc = await db.media_files.find_one({"id": file_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Archivo no encontrado.")
    try:
        grid_out = await fs.open_download_stream(ObjectId(file_id))
    except Exception:
        raise HTTPException(status_code=404, detail="Archivo no encontrado.")

    async def _stream():
        while True:
            chunk = await grid_out.readchunk()
            if not chunk:
                break
            yield chunk

    return StreamingResponse(
        _stream(),
        media_type=doc["content_type"],
        headers={
            "Content-Disposition": f'attachment; filename="{doc["filename"]}"',
            "Content-Length": str(doc["size"]),
        },
    )


@api_router.delete("/files/{file_id}")
async def delete_media(file_id: str):
    doc = await db.media_files.find_one({"id": file_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Archivo no encontrado.")
    try:
        await fs.delete(ObjectId(file_id))
    except Exception as e:
        logger.warning("No se pudo borrar de GridFS: %s", e)
    await db.media_files.delete_one({"id": file_id})
    return {"deleted": True, "id": file_id}


@api_router.get("/history", response_model=List[ScriptItem])
async def get_history():
    docs = (
        await db.scripts.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    )
    return [ScriptItem(**d) for d in docs]


@api_router.get("/history/{item_id}", response_model=ScriptItem)
async def get_history_item(item_id: str):
    doc = await db.scripts.find_one({"id": item_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Guion no encontrado.")
    return ScriptItem(**doc)


@api_router.delete("/history/{item_id}")
async def delete_history_item(item_id: str):
    res = await db.scripts.delete_one({"id": item_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Guion no encontrado.")
    return {"deleted": True, "id": item_id}


@api_router.delete("/history")
async def clear_history():
    res = await db.scripts.delete_many({})
    return {"deleted": res.deleted_count}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
@app.post("/api/merge-video-audio")
async def merge_video_audio(
    video: UploadFile = File(...),
    audio: UploadFile = File(...),
):
    """Mezcla un video con un audio MP3 generado y devuelve el video final."""
    work_dir = tempfile.mkdtemp()
    try:
        # Guardar video y audio en disco temporal
        video_path = os.path.join(work_dir, "input_video" + os.path.splitext(video.filename or ".mp4")[1])
        audio_path = os.path.join(work_dir, "input_audio.mp3")
        output_path = os.path.join(work_dir, "output.mp4")

        async with aiofiles.open(video_path, "wb") as f:
            while chunk := await video.read(1024 * 1024):
                await f.write(chunk)

        async with aiofiles.open(audio_path, "wb") as f:
            while chunk := await audio.read(1024 * 1024):
                await f.write(chunk)

        # ffmpeg: reemplaza el audio del video con el generado
        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-i", audio_path,
            "-c:v", "copy",
            "-c:a", "aac",
            "-map", "0:v:0",
            "-map", "1:a:0",
            "-shortest",
            output_path,
        ]
        proc = await asyncio.to_thread(
            subprocess.run, cmd, capture_output=True, text=True
        )
        if proc.returncode != 0:
            raise HTTPException(status_code=500, detail=f"ffmpeg error: {proc.stderr}")

        # Leer el video resultante y guardarlo en GridFS
        async with aiofiles.open(output_path, "rb") as f:
            video_bytes = await f.read()

        timestamp = int(time.time())
        filename = f"guionviral_video_{timestamp}.mp4"
        media = await _store_media(video_bytes, filename, "video/mp4")
        return media

    finally:
        shutil.rmtree(work_dir, ignore_errors=True)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
