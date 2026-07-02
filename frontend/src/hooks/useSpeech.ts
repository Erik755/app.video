// Hook de Text-to-Speech local usando expo-speech (español, es-ES).
// Detiene cualquier lectura en curso antes de iniciar una nueva.
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as Speech from "expo-speech";

export function useSpeech() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
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

  const speak = useCallback((text: string) => {
    if (!text?.trim()) return;
    // Detener audio en curso antes de una nueva ejecución.
    Speech.stop();
    setIsPaused(false);
    setIsSpeaking(true);
    Speech.speak(text, {
      language: "es-ES",
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

  return { isSpeaking, isPaused, speak, pause, resume, stop };
}
