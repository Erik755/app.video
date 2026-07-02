import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing, radius, fonts, fontSize } from "@/src/theme";

// Barra flotante glassmorphic con los controles de Text-to-Speech.
export function AudioPlayerBar({
  isSpeaking,
  isPaused,
  onPlay,
  onPause,
  onResume,
  onStop,
  label,
}: {
  isSpeaking: boolean;
  isPaused: boolean;
  onPlay: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  label: string;
}) {
  const playing = isSpeaking && !isPaused;

  const handlePlayPause = () => {
    if (!isSpeaking) {
      onPlay();
    } else if (isPaused) {
      onResume();
    } else {
      onPause();
    }
  };

  const status = playing
    ? "Reproduciendo…"
    : isPaused
      ? "En pausa"
      : "Listo para reproducir";

  return (
    <BlurView
      intensity={Platform.OS === "android" ? 25 : 45}
      tint="dark"
      style={styles.wrap}
    >
      <View style={styles.inner}>
        <View style={styles.iconBadge}>
          <Ionicons name="mic" size={18} color={colors.brandPrimary} />
        </View>
        <View style={styles.meta}>
          <Text style={styles.label} numberOfLines={1}>
            {label}
          </Text>
          <Text style={styles.status}>{status}</Text>
        </View>
        <Pressable
          testID="tts-play-pause-button"
          onPress={handlePlayPause}
          style={styles.playBtn}
          hitSlop={8}
        >
          <Ionicons
            name={playing ? "pause" : "play"}
            size={22}
            color={colors.onBrandPrimary}
          />
        </Pressable>
        <Pressable
          testID="tts-stop-button"
          onPress={onStop}
          style={styles.stopBtn}
          hitSlop={8}
          disabled={!isSpeaking}
        >
          <Ionicons
            name="stop"
            size={18}
            color={isSpeaking ? colors.onSurface : colors.onSurfaceTertiary}
          />
        </Pressable>
      </View>
    </BlurView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: "rgba(18,20,24,0.6)",
  },
  iconBadge: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  meta: { flex: 1 },
  label: {
    color: colors.onSurface,
    fontFamily: fonts.displaySemi,
    fontSize: fontSize.lg,
  },
  status: {
    color: colors.onSurfaceTertiary,
    fontFamily: fonts.text,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  playBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  stopBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
});
