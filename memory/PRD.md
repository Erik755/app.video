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
- POST /api/generate (enlace), /api/generate-upload (video galería multipart), /api/save-text, GET/DELETE /api/history.
- Extracción de fotogramas con ffmpeg (fallback a miniatura si la descarga falla).
- Generación con Gemini 2.5 Pro (image inputs).
- Pantalla Generar: modos Enlace/Galería/Texto, campos opcionales estilo y descripción, presets de tono, overlay de carga, tarjeta de resultado, barra glass de reproducción TTS (play/pausa/stop), copiar.
- Pantalla Historial: lista, pull-to-refresh, reproducir/detener, eliminar, estado vacío.
- Permisos de galería (expo-image-picker) con manejo de denegación + "Abrir Ajustes".
- Verificado por testing agent (backend 9/9, frontend flujos OK).

## Backlog / Next
- P1: Ajuste de velocidad/voz TTS y selector de voz (es-ES/es-MX).
- P1: Editar guion antes de reproducir/guardar.
- P2: Compartir/exportar guion (share sheet).
- P2: Miniatura real del video seleccionado en galería (preview de primer frame).
