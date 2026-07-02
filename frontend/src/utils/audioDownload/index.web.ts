// Descarga de un archivo desde una URL en web: navega para forzar la descarga.
export async function downloadAudioUrl(
  url: string,
  filename: string,
): Promise<string> {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.target = "_blank";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  return url;
}
