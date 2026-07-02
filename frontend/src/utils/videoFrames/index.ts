// Extrae fotogramas JPEG (base64) de un video local en el dispositivo,
// para no tener que subir el archivo de video completo al backend.
import * as VideoThumbnails from "expo-video-thumbnails";
import * as FileSystem from "expo-file-system/legacy";

const MAX_FRAMES = 6;

export async function extractFramesBase64(
  uri: string,
  durationMs: number,
): Promise<string[]> {
  // Calcular tiempos (ms) espaciados a lo largo del video.
  let times: number[];
  if (durationMs && durationMs > 1000) {
    const step = durationMs / (MAX_FRAMES + 1);
    times = Array.from({ length: MAX_FRAMES }, (_, i) => Math.round(step * (i + 1)));
  } else {
    times = [0, 500, 1000, 1500, 2000, 3000];
  }

  const frames: string[] = [];
  for (const t of times) {
    try {
      const { uri: thumbUri } = await VideoThumbnails.getThumbnailAsync(uri, {
        time: t,
        quality: 0.7,
      });
      const b64 = await FileSystem.readAsStringAsync(thumbUri, {
        encoding: "base64",
      });
      if (b64) frames.push(b64);
    } catch {
      // Ese instante puede estar fuera de rango en videos cortos: se ignora.
    }
  }
  return frames;
}
