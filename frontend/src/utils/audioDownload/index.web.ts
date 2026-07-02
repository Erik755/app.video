// Descarga de audio en web: dispara la descarga del navegador vía data URL.
export async function downloadAudioBase64(
  base64: string,
  filename: string,
): Promise<string> {
  const link = document.createElement("a");
  link.href = `data:audio/mpeg;base64,${base64}`;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  return filename;
}
