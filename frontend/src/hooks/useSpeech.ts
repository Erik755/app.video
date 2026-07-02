// Hook de Text-to-Speech local usando expo-speech (español, es-ES).
// Detiene cualquier lectura en curso antes de iniciar una nueva.
// Permite elegir la voz del dispositivo (persistida en almacenamiento local).
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as Speech from "expo-speech";

import { storage } from "@/src/utils/storage";

const VOICE_KEY = "tts_voice_id";

export function useSpeech() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [voices, setVoices] = useState<Speech.Voice[]>([]);
  const [voiceId, setVoiceId] = useState<string>("");
  const voiceRef = useRef<string>("");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      const persisted = await storage.getItem<string>(VOICE_KEY, "");
      if (persisted && mounted.current) {
        voiceRef.current = persisted;
        setVoiceId(persisted);
      }
      try {
        const all = await Speech.getAvailableVoicesAsync();
        const es = all.filter((v) =>
          (v.language || "").toLowerCase().startsWith("es"),
        );
        if (mounted.current) setVoices(es.length ? es : all);
      } catch {
        // sin voces disponibles: se usará la voz por defecto del sistema
      }
    })();
    return () => {
      mounted.current = false;
      Speech.stop();
    };
  }, []);

  const stop = useCallback(() => {
    Speech.stop();
    setIsSpeaking(false);
    setIsPaused(false);
  }, []);

  // voiceOverride permite previsualizar una voz sin cambiar la seleccionada.
  const speak = useCallback((text: string, voiceOverride?: string) => {
    if (!text?.trim()) return;
    Speech.stop(); // Detener audio en curso antes de una nueva ejecución.
    setIsPaused(false);
    setIsSpeaking(true);
    const chosen = voiceOverride ?? voiceRef.current;
    Speech.speak(text, {
      language: "es-ES",
      voice: chosen || undefined,
      rate: Platform.OS === "ios" ? 0.5 : 1.0,
      pitch: 1.0,
      onDone: () => {
        if (mounted.current) {
          setIsSpeaking(false);
          setIsPaused(false);
        }
      },
      onStopped: () => {
        if (mounted.current) setIsSpeaking(false);
      },
      onError: () => {
        if (mounted.current) {
          setIsSpeaking(false);
          setIsPaused(false);
        }
      },
    });
  }, []);

  const pause = useCallback(() => {
    Speech.pause();
    setIsPaused(true);
  }, []);

  const resume = useCallback(() => {
    Speech.resume();
    setIsPaused(false);
  }, []);

  const selectVoice = useCallback(async (id: string) => {
    voiceRef.current = id;
    setVoiceId(id);
    await storage.setItem(VOICE_KEY, id);
  }, []);

  return {
    isSpeaking,
    isPaused,
    voices,
    voiceId,
    speak,
    pause,
    resume,
    stop,
    selectVoice,
  };
}
