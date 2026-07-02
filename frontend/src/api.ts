// Cliente HTTP hacia el backend FastAPI. La URL base viene del .env de Expo.
const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export type ScriptItem = {
  id: string;
  source_type: "link" | "upload" | "text";
  source_url?: string | null;
  source_title?: string | null;
  thumbnail?: string | null;
  script_generado: string;
  tone?: string | null;
  style?: string | null;
  frames_used: number;
  used_fallback: boolean;
  created_at: string;
};

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = "Ocurrió un error inesperado.";
    try {
      const body = await res.json();
      detail = body?.detail || detail;
    } catch {
      // ignorar
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export async function generateFromLink(
  url: string,
  tone: string,
  style?: string,
  description?: string,
): Promise<ScriptItem> {
  const res = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, tone, style, description }),
  });
  return handle<ScriptItem>(res);
}

// Sube un video de la galería al backend (multipart) para analizarlo con la IA.
export async function generateFromUpload(
  fileUri: string,
  fileName: string,
  mimeType: string,
  tone: string,
  style?: string,
  description?: string,
): Promise<ScriptItem> {
  const form = new FormData();
  // React Native FormData: el archivo se envía como { uri, name, type }.
  form.append("file", {
    uri: fileUri,
    name: fileName,
    type: mimeType,
  } as unknown as Blob);
  form.append("tone", tone);
  if (style) form.append("style", style);
  if (description) form.append("description", description);
  form.append("title", fileName);

  const res = await fetch(`${BASE}/api/generate-upload`, {
    method: "POST",
    body: form,
  });
  return handle<ScriptItem>(res);
}

export async function saveText(
  text: string,
  title?: string,
): Promise<ScriptItem> {
  const res = await fetch(`${BASE}/api/save-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, title }),
  });
  return handle<ScriptItem>(res);
}

export async function synthesizeAudio(
  text: string,
  voice?: string,
): Promise<{ audio_base64: string; mime: string; voice: string }> {
  const res = await fetch(`${BASE}/api/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice }),
  });
  return handle<{ audio_base64: string; mime: string; voice: string }>(res);
}

export async function getHistory(): Promise<ScriptItem[]> {  const res = await fetch(`${BASE}/api/history`);
  return handle<ScriptItem[]>(res);
}

export async function deleteHistoryItem(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/history/${id}`, { method: "DELETE" });
  await handle(res);
}
