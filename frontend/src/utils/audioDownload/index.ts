// Descarga/guardado de un archivo desde una URL en dispositivo nativo (iOS/Android).
// Descarga el archivo del store y abre la hoja de "Compartir/Guardar".
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";

export async function downloadAudioUrl(
  url: string,
  filename: string,
): Promise<string> {
  const dir = FileSystem.cacheDirectory || FileSystem.documentDirectory || "";
  const target = dir + filename;
  const { uri } = await FileSystem.downloadAsync(url, target);

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
