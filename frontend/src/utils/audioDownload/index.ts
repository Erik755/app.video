// Descarga/guardado de audio en dispositivo nativo (iOS/Android).
// Escribe el base64 a un archivo local y abre la hoja de "Compartir/Guardar"
// para que el usuario lo guarde en Archivos / Descargas / Música.
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";

export async function downloadAudioBase64(
  base64: string,
  filename: string,
): Promise<string> {
  const dir =
    FileSystem.cacheDirectory || FileSystem.documentDirectory || "";
  const uri = dir + filename;

  // encoding en formato string ("base64") para no depender del enum.
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: "base64" });

  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(uri, {
      mimeType: "audio/mpeg",
      dialogTitle: "Guardar audio del guion",
      UTI: "public.mp3",
    });
  }
  return uri;
}
