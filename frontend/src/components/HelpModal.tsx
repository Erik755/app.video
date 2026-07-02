import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing, radius, fonts, fontSize } from "@/src/theme";

// Modal reutilizable "¿Cómo funciona esto?" con las indicaciones de una sección.
export function HelpModal({
  visible,
  title,
  intro,
  steps,
  heading = "¿Cómo funciona esto?",
  ctaLabel,
  onClose,
}: {
  visible: boolean;
  title: string;
  intro?: string;
  steps: string[];
  heading?: string;
  ctaLabel?: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} testID="help-backdrop" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.handle} />
        <View style={styles.headerRow}>
          <View style={styles.titleRow}>
            <Ionicons name="help-circle" size={22} color={colors.brandPrimary} />
            <Text style={styles.title}>{heading}</Text>
          </View>
          <Pressable testID="help-close" onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.onSurfaceSecondary} />
          </Pressable>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: spacing.md }}
        >
          <Text style={styles.subtitle}>{title}</Text>
          {intro ? <Text style={styles.intro}>{intro}</Text> : null}
          <View style={{ gap: spacing.md, marginTop: spacing.md }}>
            {steps.map((s, i) => (
              <View key={i} style={styles.step}>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{i + 1}</Text>
                </View>
                <Text style={styles.stepText}>{s}</Text>
              </View>
            ))}
          </View>
        </ScrollView>

        {ctaLabel ? (
          <Pressable testID="help-cta" onPress={onClose} style={styles.cta}>
            <Text style={styles.ctaText}>{ctaLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "80%",
    backgroundColor: colors.surfaceSecondary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: {
    fontFamily: fonts.display,
    fontSize: fontSize.xl,
    color: colors.onSurface,
    letterSpacing: 0.5,
  },
  subtitle: {
    fontFamily: fonts.displaySemi,
    fontSize: fontSize.lg,
    color: colors.brandPrimary,
    marginBottom: spacing.xs,
  },
  intro: {
    fontFamily: fonts.text,
    fontSize: fontSize.base,
    color: colors.onSurfaceSecondary,
    lineHeight: 20,
  },
  step: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  badge: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  badgeText: {
    fontFamily: fonts.displaySemi,
    fontSize: fontSize.sm,
    color: colors.brandPrimary,
  },
  stepText: {
    flex: 1,
    fontFamily: fonts.text,
    fontSize: fontSize.base,
    color: colors.onSurfaceSecondary,
    lineHeight: 20,
  },
  cta: {
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.md,
  },
  ctaText: {
    fontFamily: fonts.display,
    fontSize: fontSize.xl,
    color: colors.onBrandPrimary,
    letterSpacing: 0.5,
  },
});
