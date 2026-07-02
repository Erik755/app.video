// Voz de OpenAI usada para el audio MP3 descargable (persistida localmente).
import { useCallback, useEffect, useState } from "react";

import { storage } from "@/src/utils/storage";

export const OPENAI_VOICES: { id: string; label: string }[] = [
  { id: "nova", label: "Nova · femenina cálida" },
  { id: "shimmer", label: "Shimmer · femenina suave" },
  { id: "coral", label: "Coral · femenina expresiva" },
  { id: "sage", label: "Sage · femenina serena" },
  { id: "alloy", label: "Alloy · neutra" },
  { id: "ash", label: "Ash · neutra grave" },
  { id: "echo", label: "Echo · masculina clara" },
  { id: "fable", label: "Fable · masculina narrativa" },
  { id: "onyx", label: "Onyx · masculina grave" },
];

const KEY = "mp3_voice_id";

export function useMp3Voice() {
  const [voice, setVoiceState] = useState<string>("nova");

  useEffect(() => {
    (async () => {
      const v = await storage.getItem<string>(KEY, "nova");
      if (v) setVoiceState(v);
    })();
  }, []);

  const setVoice = useCallback(async (id: string) => {
    setVoiceState(id);
    await storage.setItem(KEY, id);
  }, []);

  return { voice, setVoice };
}
