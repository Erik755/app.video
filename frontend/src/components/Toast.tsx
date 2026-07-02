import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing, radius, fonts, fontSize } from "@/src/theme";

type ToastType = "error" | "success" | "info";

export function Toast({
  message,
  type = "info",
  visible,
  onHide,
}: {
  message: string;
  type?: ToastType;
  visible: boolean;
  onHide: () => void;
}) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
      const t = setTimeout(() => {
        Animated.timing(opacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }).start(() => onHide());
      }, 3200);
      return () => clearTimeout(t);
    }
  }, [visible, message, opacity, onHide]);

  if (!visible) return null;

  const accent =
    type === "error"
      ? colors.error
      : type === "success"
        ? colors.success
        : colors.info;
  const icon =
    type === "error"
      ? "alert-circle"
      : type === "success"
        ? "checkmark-circle"
        : "information-circle";

  return (
    <Animated.View
      testID="app-toast"
      pointerEvents="box-none"
      style={[styles.wrap, { opacity }]}
    >
      <Pressable style={[styles.toast, { borderColor: accent }]} onPress={onHide}>
        <Ionicons name={icon as never} size={18} color={accent} />
        <Text style={styles.text} numberOfLines={3}>
          {message}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: spacing["3xl"],
    left: spacing.lg,
    right: spacing.lg,
    alignItems: "center",
    zIndex: 999,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    maxWidth: 480,
  },
  text: {
    flex: 1,
    color: colors.onSurface,
    fontFamily: fonts.text,
    fontSize: fontSize.base,
  },
});
