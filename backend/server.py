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
from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field

from emergentintegrations.llm.chat import (
    LlmChat,
    UserMessage,
    FileContentWithMimeType,
)
from emergentintegrations.llm.openai.text_to_speech import OpenAITextToSpeech

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="GuionViral API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("guionviral")

MAX_FRAMES = 6
GEMINI_MODEL = "gemini-2.5-pro"
TTS_MODEL = "tts-1"
TTS_DEFAULT_VOICE = "nova"
TTS_MAX_CHARS = 3900

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


class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = None


# --------------------------- Utilidades de video ---------------------------
def _probe_duration(video_path: str) -> float:
    try:
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", video_path],
            capture_output=True, text=True, timeout=30,
        )
        return float(probe.stdout.strip())
    except Exception:
        return 0.0


def _extract_frames(video_path: str, workdir: str, duration: float = 0.0) -> List[str]:
    """Extrae hasta MAX_FRAMES fotogramas espaciados de un archivo de video."""
    frames: List[str] = []
    if not (video_path and os.path.exists(video_path) and os.path.getsize(video_path) > 0):
        return frames

    if not duration:
        duration = _probe_duration(video_path)

    if duration and duration > 1:
        step = duration / (MAX_FRAMES + 1)
        timestamps = [round(step * (i + 1), 2) for i in range(MAX_FRAMES)]
    else:
        timestamps = [0]

    for idx, ts in enumerate(timestamps):
        out = os.path.join(workdir, f"frame_{idx:03d}.jpg")
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-ss", str(ts), "-i", video_path,
                 "-frames:v", "1", "-vf", "scale=640:-1", "-q:v", "4", out],
                capture_output=True, timeout=30,
            )
            if os.path.exists(out) and os.path.getsize(out) > 0:
                frames.append(out)
        except Exception as e:
            logger.warning("ffmpeg falló en ts=%s: %s", ts, e)
    return frames


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


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
