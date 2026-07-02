// Descarga/guardado de audio en dispositivo nativo (iOS/Android).
// Escribe el base64 a un archivo y abre la hoja de "Compartir/Guardar".
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";

export async function downloadAudioBase64(
  base64: string,
  filename: string,
): Promise<string> {
  const uri = (FileSystem.documentDirectory || "") + filename;
  await FileSystem.writeAsStringAsync(uri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
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
