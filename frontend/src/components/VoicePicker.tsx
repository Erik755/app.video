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
import type * as Speech from "expo-speech";

import { colors, spacing, radius, fonts, fontSize } from "@/src/theme";

// Etiqueta legible de la región a partir del código de idioma (es-ES, es-MX, …).
const REGION: Record<string, string> = {
  "es-es": "España",
  "es-mx": "México",
  "es-us": "EE. UU.",
  "es-ar": "Argentina",
  "es-co": "Colombia",
  "es-cl": "Chile",
  "es-419": "Latinoamérica",
};

function label(v: Speech.Voice): string {
  const region = REGION[(v.language || "").toLowerCase()] || v.language || "";
  const name = v.name || v.identifier;
  return region ? `${region} · ${name}` : name;
}

export function VoicePicker({
  visible,
  voices,
  selectedId,
  onSelect,
  onPreview,
  openaiVoices,
  selectedOpenaiId,
  onSelectOpenai,
  onClose,
}: {
  visible: boolean;
  voices: Speech.Voice[];
  selectedId: string;
  onSelect: (id: string) => void;
  onPreview: (id: string) => void;
  openaiVoices: { id: string; label: string }[];
  selectedOpenaiId: string;
  onSelectOpenai: (id: string) => void;
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
      <Pressable style={styles.backdrop} onPress={onClose} testID="voice-backdrop" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.handle} />
        <View style={styles.headerRow}>
          <Text style={styles.title}>Voz de lectura</Text>
          <Pressable testID="voice-close" onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.onSurfaceSecondary} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.list}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md }}
        >
          <Text style={styles.section}>Voz de lectura en la app (dispositivo)</Text>
          {voices.length === 0 ? (
            <Text style={styles.empty}>
              No se encontraron voces en español en este dispositivo. Se usará
              la voz predeterminada del sistema.
            </Text>
          ) : (
            voices.map((v) => {
              const active = v.identifier === selectedId;
              return (
                <View
                  key={v.identifier}
                  style={[styles.row, active && styles.rowActive]}
                  testID={`voice-row-${v.identifier}`}
                >
                  <Pressable
                    testID={`voice-select-${v.identifier}`}
                    style={styles.rowMain}
                    onPress={() => onSelect(v.identifier)}
                  >
                    <Ionicons
                      name={active ? "radio-button-on" : "radio-button-off"}
                      size={20}
                      color={active ? colors.brandPrimary : colors.onSurfaceTertiary}
                    />
                    <Text style={styles.rowLabel} numberOfLines={1}>
                      {label(v)}
                    </Text>
                  </Pressable>
                  <Pressable
                    testID={`voice-preview-${v.identifier}`}
                    onPress={() => onPreview(v.identifier)}
                    hitSlop={8}
                    style={styles.previewBtn}
                  >
                    <Ionicons name="play" size={16} color={colors.brandPrimary} />
                  </Pressable>
                </View>
              );
            })
          )}

          <Text style={[styles.section, { marginTop: spacing.lg }]}>
            Voz del audio descargado (MP3)
          </Text>
          {openaiVoices.map((v) => {
            const active = v.id === selectedOpenaiId;
            return (
              <Pressable
                key={v.id}
                testID={`mp3-voice-${v.id}`}
                style={[styles.row, styles.rowMain, active && styles.rowActive]}
                onPress={() => onSelectOpenai(v.id)}
              >
                <Ionicons
                  name={active ? "radio-button-on" : "radio-button-off"}
                  size={20}
                  color={active ? colors.brandPrimary : colors.onSurfaceTertiary}
                />
                <Text style={styles.rowLabel} numberOfLines={1}>
                  {v.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
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
    maxHeight: "75%",
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
  title: {
    fontFamily: fonts.display,
    fontSize: fontSize.xl,
    color: colors.onSurface,
    letterSpacing: 0.5,
  },
  empty: {
    fontFamily: fonts.text,
    fontSize: fontSize.base,
    color: colors.onSurfaceTertiary,
    paddingVertical: spacing.lg,
  },
  list: { marginBottom: spacing.sm },
  section: {
    fontFamily: fonts.displaySemi,
    fontSize: fontSize.sm,
    color: colors.onSurfaceTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  rowActive: { borderColor: colors.brandPrimary },
  rowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  rowLabel: {
    flex: 1,
    fontFamily: fonts.text,
    fontSize: fontSize.base,
    color: colors.onSurface,
  },
  previewBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary,
    marginLeft: spacing.sm,
  },
});
