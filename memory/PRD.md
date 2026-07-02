# GuionViral — PRD

## Problem Statement (original)
App móvil personal (React Native/Expo) generadora de contenido: (1) Text-to-Speech local en español con expo-speech; (2) recibir un enlace de video (YouTube y otras plataformas) o un video de la galería, analizarlo con IA (Gemini 2.5 Pro), generar un guion viral original derivado, devolverlo y leerlo en voz alta. UI Dark Mode. Guardar historial.

## Architecture
- Frontend: Expo Router (tabs). Generar (index) + Historial. Dark "command-center" design (Rajdhani/DM Sans, Signal Red accent).
- Backend: FastAPI (sustituye a Firebase Cloud Functions solicitado, no soportado en este entorno). yt-dlp + ffmpeg extraen fotogramas; Gemini 2.5 Pro (vía emergentintegrations + EMERGENT_LLM_KEY) analiza los frames.
- DB: MongoDB (colección `scripts`, id uuid, sin _id expuesto).

## User Persona
Creador de contenido / uso personal que quiere generar guiones virales a partir de videos y escucharlos.

## Core Requirements (static)
- TTS local español (expo-speech), detener audio previo antes de nuevo.
- Analizar video por enlace o subida de galería; campos opcionales estilo + descripción.
- Guardar y reproducir historial.

## Implemented (2026-06)
- POST /api/generate (enlace), /api/generate-upload (video galería multipart), /api/save-text, /api/tts (OpenAI TTS tts-1 voz nova, MP3 base64), GET/DELETE /api/history.
- ffmpeg empaquetado vía pip (imageio-ffmpeg) => persiste entre reinicios; extracción de frames con un solo comando (fps=1/2), sin ffprobe.
- Generación con Gemini 2.5 Pro (image inputs).
- Descarga de audio MP3 en Generador y en cada tarjeta del Historial (nativo: expo-file-system/legacy + expo-sharing; web: <a download>).
- Modo Texto a voz: escribir cualquier texto y generar/descargar MP3.
- Duración del guion ajustada a la duración del video: se calcula la duración (yt-dlp o ffmpeg) y se instruye a Gemini a producir ~palabras = duración * 2.4, rellenando con datos/conceptos/ideas de contexto (tope 300s). Verificado: video 20s -> 52 palabras.
- Selección de voz de lectura (dispositivo) y voz del MP3 (9 voces OpenAI), persistidas.
- Verificado por testing agent (iter 3): features de descarga MP3 y texto->MP3 OK.

## Known limitations
- Análisis de video (Gemini) puede fallar si la Universal Key de Emergent se queda sin saldo (error de presupuesto). Solución: Profile -> Universal Key -> Add Balance.
- La descarga nativa (guardar en el celular) solo se valida en dispositivo real / Expo Go, no en preview web.

## Backlog / Next
- P1: Ajuste de velocidad/voz TTS y selector de voz (es-ES/es-MX).
- P1: Editar guion antes de reproducir/guardar.
- P2: Compartir/exportar guion (share sheet).
- P2: Miniatura real del video seleccionado en galería (preview de primer frame).
