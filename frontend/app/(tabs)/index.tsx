import { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Linking,
  Platform,
  Share,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  KeyboardAwareScrollView,
  KeyboardStickyView,
} from "react-native-keyboard-controller";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, fonts, fontSize } from "@/src/theme";
import { useSpeech } from "@/src/hooks/useSpeech";
import {
  generateFromLink,
  generateFromUpload,
  saveText,
  synthesizeAudio,
  ScriptItem,
} from "@/src/api";
import { Toast } from "@/src/components/Toast";
import { AudioPlayerBar } from "@/src/components/AudioPlayerBar";
import { VoicePicker } from "@/src/components/VoicePicker";
import { downloadAudioBase64 } from "@/src/utils/audioDownload";

type Mode = "link" | "upload" | "text";
type PickedVideo = { uri: string; name: string; type: string };

const MODES: { key: Mode; label: string; icon: string }[] = [
  { key: "link", label: "Enlace", icon: "link" },
  { key: "upload", label: "Galería", icon: "images" },
  { key: "text", label: "Texto", icon: "text" },
];

const TONES = [
  { key: "viral", label: "Viral" },
  { key: "educativo", label: "Educativo" },
  { key: "humor", label: "Humor" },
  { key: "motivacional", label: "Motivacional" },
];

const BOTTOM_BAR_HEIGHT = 96;

export default function GeneratorScreen() {
  const insets = useSafeAreaInsets();
  const { isSpeaking, isPaused, voices, voiceId, speak, pause, resume, stop, selectVoice } =
    useSpeech();

  const [mode, setMode] = useState<Mode>("link");
  const [url, setUrl] = useState("");
  const [rawText, setRawText] = useState("");
  const [description, setDescription] = useState("");
  const [style, setStyle] = useState("");
  const [tone, setTone] = useState("viral");
  const [video, setVideo] = useState<PickedVideo | null>(null);
  const [permBlocked, setPermBlocked] = useState(false);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScriptItem | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const [toast, setToast] = useState<{
    msg: string;
    type: "error" | "success" | "info";
  } | null>(null);

  const showToast = useCallback(
    (msg: string, type: "error" | "success" | "info" = "info") =>
      setToast({ msg, type }),
    [],
  );

  const switchMode = (m: Mode) => {
    setMode(m);
    stop();
    setResult(null);
  };

  const pickVideo = async () => {
    try {
      let perm = await ImagePicker.getMediaLibraryPermissionsAsync();
      if (perm.status !== "granted") {
        if (perm.canAskAgain) {
          perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        }
        if (perm.status !== "granted") {
          if (!perm.canAskAgain) setPermBlocked(true);
          showToast(
            "Necesitamos acceso a tu galería para elegir un video.",
            "error",
          );
          return;
        }
      }
      setPermBlocked(false);
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["videos"],
        quality: 1,
      });
      if (!res.canceled && res.assets?.length) {
        const a = res.assets[0];
        const name = a.fileName || a.uri.split("/").pop() || "video.mp4";
        setVideo({
          uri: a.uri,
          name,
          type: a.mimeType || "video/mp4",
        });
        setResult(null);
        stop();
      }
    } catch {
      showToast("No se pudo abrir la galería.", "error");
    }
  };

  const canProcess =
    (mode === "link" && url.trim().length > 0) ||
    (mode === "upload" && !!video) ||
    (mode === "text" && rawText.trim().length > 0);

  const process = async () => {
    if (!canProcess || loading) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    stop();
    setResult(null);

    // Modo texto: TTS local + guardado, sin backend.
    if (mode === "text") {
      const text = rawText.trim();
      setLoading(true);
      try {
        const item = await saveText(text);
        setResult(item);
        speak(item.script_generado);
      } catch {
        // Aún si falla el guardado, leemos el texto localmente.
        setResult({
          id: "local",
          source_type: "text",
          script_generado: text,
          frames_used: 0,
          used_fallback: false,
          created_at: new Date().toISOString(),
          source_title: "Texto directo",
        });
        speak(text);
      } finally {
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    try {
      let item: ScriptItem;
      if (mode === "link") {
        item = await generateFromLink(
          url.trim(),
          tone,
          style.trim() || undefined,
          description.trim() || undefined,
        );
      } else {
        item = await generateFromUpload(
          video!.uri,
          video!.name,
          video!.type,
          tone,
          style.trim() || undefined,
          description.trim() || undefined,
        );
      }
      setResult(item);
      showToast("¡Guion generado!", "success");
      speak(item.script_generado);
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "No se pudo generar el guion.",
        "error",
      );
    } finally {
      setLoading(false);
    }
  };

  const copyScript = async () => {
    if (!result) return;
    await Clipboard.setStringAsync(result.script_generado);
    showToast("Guion copiado al portapapeles.", "success");
  };

  const shareScript = async () => {
    if (!result) return;
    try {
      await Share.share({
        message: result.script_generado,
        title: result.source_title || "Guion viral",
      });
    } catch {
      showToast("No se pudo compartir el guion.", "error");
    }
  };

  const downloadAudio = async () => {
    if (!result || downloading) return;
    setDownloading(true);
    showToast("Generando audio…", "info");
    try {
      const { audio_base64 } = await synthesizeAudio(
        result.script_generado,
        voiceId || undefined,
      );
      const safe = (result.source_title || "guion")
        .replace(/[^a-z0-9]+/gi, "_")
        .slice(0, 40);
      await downloadAudioBase64(audio_base64, `guionviral_${safe}.mp3`);
      showToast("Audio listo para guardar.", "success");
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "No se pudo generar el audio.",
        "error",
      );
    } finally {
      setDownloading(false);
    }
  };

  const resetAll = () => {
    stop();
    setResult(null);
    setUrl("");
    setRawText("");
    setDescription("");
    setStyle("");
    setVideo(null);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.brand}>
              GUION<Text style={{ color: colors.brandPrimary }}>VIRAL</Text>
            </Text>
            <Text style={styles.subtitle}>
              Analiza un video con IA y léelo en voz alta
            </Text>
          </View>
          <Pressable
            testID="voice-button"
            onPress={() => setVoiceOpen(true)}
            style={styles.voiceBtn}
          >
            <Ionicons name="options-outline" size={18} color={colors.brandPrimary} />
            <Text style={styles.voiceBtnText}>Voz</Text>
          </Pressable>
        </View>
      </View>

      <KeyboardAwareScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: BOTTOM_BAR_HEIGHT + insets.bottom + spacing.xl },
        ]}
        bottomOffset={BOTTOM_BAR_HEIGHT + spacing.lg}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Selector de modo */}
        <View style={styles.segment} testID="mode-segment">
          {MODES.map((m) => {
            const active = mode === m.key;
            return (
              <Pressable
                key={m.key}
                testID={`mode-${m.key}`}
                onPress={() => switchMode(m.key)}
                style={[styles.segmentItem, active && styles.segmentItemActive]}
              >
                <Ionicons
                  name={m.icon as never}
                  size={16}
                  color={active ? colors.onBrandPrimary : colors.onSurfaceTertiary}
                />
                <Text
                  style={[
                    styles.segmentText,
                    active && styles.segmentTextActive,
                  ]}
                >
                  {m.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Entrada según el modo */}
        {mode === "link" && (
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Enlace del video</Text>
            <TextInput
              testID="url-input"
              value={url}
              onChangeText={setUrl}
              placeholder="https://youtube.com/..."
              placeholderTextColor={colors.onSurfaceTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={styles.input}
            />
          </View>
        )}

        {mode === "upload" && (
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Video de tu galería</Text>
            <Pressable
              testID="pick-video-button"
              onPress={pickVideo}
              style={styles.pickBox}
            >
              <Ionicons
                name={video ? "film" : "cloud-upload-outline"}
                size={26}
                color={colors.brandPrimary}
              />
              <Text style={styles.pickText} numberOfLines={1}>
                {video ? video.name : "Toca para seleccionar un video"}
              </Text>
              {video && (
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              )}
            </Pressable>
            {permBlocked && (
              <Pressable
                testID="open-settings-button"
                onPress={() => Linking.openSettings()}
                style={styles.settingsBtn}
              >
                <Ionicons name="settings-outline" size={16} color={colors.brandPrimary} />
                <Text style={styles.settingsText}>Abrir Ajustes para dar permiso</Text>
              </Pressable>
            )}
          </View>
        )}

        {mode === "text" && (
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Texto para leer</Text>
            <TextInput
              testID="text-input"
              value={rawText}
              onChangeText={setRawText}
              placeholder="Escribe o pega el texto que quieres escuchar…"
              placeholderTextColor={colors.onSurfaceTertiary}
              multiline
              style={[styles.input, styles.multiline]}
            />
          </View>
        )}

        {/* Campos opcionales (solo para análisis de video) */}
        {mode !== "text" && (
          <>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>
                Descripción del video{" "}
                <Text style={styles.optional}>(opcional)</Text>
              </Text>
              <TextInput
                testID="description-input"
                value={description}
                onChangeText={setDescription}
                placeholder="Cuéntale a la IA de qué trata el video…"
                placeholderTextColor={colors.onSurfaceTertiary}
                multiline
                style={[styles.input, styles.multilineSm]}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>
                Estilo del guion <Text style={styles.optional}>(opcional)</Text>
              </Text>
              <TextInput
                testID="style-input"
                value={style}
                onChangeText={setStyle}
                placeholder="Ej: divertido y juvenil, tono serio, narrativo…"
                placeholderTextColor={colors.onSurfaceTertiary}
                style={styles.input}
              />
              <View style={styles.chipsRow}>
                {TONES.map((t) => {
                  const active = tone === t.key;
                  return (
                    <Pressable
                      key={t.key}
                      testID={`tone-${t.key}`}
                      onPress={() => setTone(t.key)}
                      style={[styles.chip, active && styles.chipActive]}
                    >
                      <Text
                        style={[styles.chipText, active && styles.chipTextActive]}
                      >
                        {t.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.hint}>
                Los presets se usan si no escribes un estilo personalizado.
              </Text>
            </View>
          </>
        )}

        {/* Resultado */}
        {result && (
          <View style={styles.resultCard} testID="result-card">
            <View style={styles.resultHeader}>
              <Ionicons name="document-text" size={16} color={colors.brandPrimary} />
              <Text style={styles.resultTitle} numberOfLines={1}>
                {result.source_title || "Guion generado"}
              </Text>
              <Pressable
                testID="share-script-button"
                onPress={shareScript}
                hitSlop={8}
                style={{ marginRight: spacing.md }}
              >
                <Ionicons name="share-social-outline" size={18} color={colors.brandPrimary} />
              </Pressable>
              <Pressable
                testID="copy-script-button"
                onPress={copyScript}
                hitSlop={8}
              >
                <Ionicons name="copy-outline" size={18} color={colors.onSurfaceSecondary} />
              </Pressable>
            </View>
            {result.used_fallback && (
              <Text style={styles.fallbackNote}>
                No se pudo descargar el video completo; se analizó la miniatura.
              </Text>
            )}
            <ScrollView
              style={styles.resultScroll}
              nestedScrollEnabled
              showsVerticalScrollIndicator
            >
              <Text style={styles.resultText} testID="result-text">
                {result.script_generado}
              </Text>
            </ScrollView>
            <Pressable
              testID="download-audio-button"
              onPress={downloadAudio}
              disabled={downloading}
              style={[styles.downloadBtn, downloading && styles.downloadBtnDisabled]}
            >
              {downloading ? (
                <ActivityIndicator color={colors.brandPrimary} size="small" />
              ) : (
                <Ionicons name="download-outline" size={18} color={colors.brandPrimary} />
              )}
              <Text style={styles.downloadBtnText}>
                {downloading ? "Generando audio…" : "Descargar audio (MP3)"}
              </Text>
            </Pressable>
            <Pressable
              testID="reset-button"
              onPress={resetAll}
              style={styles.newBtn}
            >
              <Ionicons name="add-circle-outline" size={16} color={colors.onSurfaceSecondary} />
              <Text style={styles.newBtnText}>Nuevo guion</Text>
            </Pressable>
          </View>
        )}
      </KeyboardAwareScrollView>

      {/* Barra inferior fija */}
      <KeyboardStickyView>
        <View
          style={[
            styles.bottomBar,
            { paddingBottom: insets.bottom + spacing.sm },
          ]}
        >
          {result ? (
            <AudioPlayerBar
              isSpeaking={isSpeaking}
              isPaused={isPaused}
              onPlay={() => speak(result.script_generado)}
              onPause={pause}
              onResume={resume}
              onStop={stop}
              label={result.source_title || "Guion generado"}
            />
          ) : (
            <Pressable
              testID="process-button"
              onPress={process}
              disabled={!canProcess || loading}
              style={[styles.cta, (!canProcess || loading) && styles.ctaDisabled]}
            >
              {loading ? (
                <ActivityIndicator color={colors.onBrandPrimary} />
              ) : (
                <>
                  <Ionicons
                    name={mode === "text" ? "volume-high" : "sparkles"}
                    size={18}
                    color={colors.onBrandPrimary}
                  />
                  <Text style={styles.ctaText}>
                    {mode === "text" ? "Leer en voz alta" : "Procesar y Leer"}
                  </Text>
                </>
              )}
            </Pressable>
          )}
        </View>
      </KeyboardStickyView>

      {/* Overlay de carga */}
      {loading && mode !== "text" && (
        <View style={styles.overlay} testID="loading-overlay">
          <ActivityIndicator size="large" color={colors.brandPrimary} />
          <Text style={styles.overlayTitle}>Analizando el video con IA…</Text>
          <Text style={styles.overlaySub}>
            Extrayendo fotogramas y generando tu guion viral.
          </Text>
        </View>
      )}

      <Toast
        visible={!!toast}
        message={toast?.msg || ""}
        type={toast?.type || "info"}
        onHide={() => setToast(null)}
      />

      <VoicePicker
        visible={voiceOpen}
        voices={voices}
        selectedId={voiceId}
        onSelect={(id) => {
          selectVoice(id);
          setVoiceOpen(false);
          showToast("Voz actualizada.", "success");
        }}
        onPreview={(id) =>
          speak("Hola, así se escuchará tu guion viral.", id)
        }
        onClose={() => setVoiceOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  voiceBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  voiceBtnText: {
    fontFamily: fonts.displaySemi,
    fontSize: fontSize.base,
    color: colors.brandPrimary,
  },
  brand: {
    fontFamily: fonts.display,
    fontSize: fontSize["2xl"],
    color: colors.onSurface,
    letterSpacing: 1,
  },
  subtitle: {
    fontFamily: fonts.text,
    fontSize: fontSize.sm,
    color: colors.onSurfaceTertiary,
    marginTop: 2,
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.lg,
  },
  segment: {
    flexDirection: "row",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segmentItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
  },
  segmentItemActive: { backgroundColor: colors.brandPrimary },
  segmentText: {
    fontFamily: fonts.displaySemi,
    fontSize: fontSize.base,
    color: colors.onSurfaceTertiary,
  },
  segmentTextActive: { color: colors.onBrandPrimary },
  field: { gap: spacing.sm },
  fieldLabel: {
    fontFamily: fonts.displaySemi,
    fontSize: fontSize.base,
    color: colors.onSurfaceSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  optional: {
    fontFamily: fonts.text,
    fontSize: fontSize.sm,
    color: colors.onSurfaceTertiary,
    textTransform: "none",
    letterSpacing: 0,
  },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    color: colors.onSurface,
    fontFamily: fonts.text,
    fontSize: fontSize.lg,
  },
  multiline: { minHeight: 160, textAlignVertical: "top" },
  multilineSm: { minHeight: 84, textAlignVertical: "top" },
  pickBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  pickText: {
    flex: 1,
    color: colors.onSurfaceSecondary,
    fontFamily: fonts.text,
    fontSize: fontSize.base,
  },
  settingsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  settingsText: {
    color: colors.brandPrimary,
    fontFamily: fonts.displaySemi,
    fontSize: fontSize.base,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.lg,
    height: 36,
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { borderColor: colors.brandPrimary },
  chipText: {
    fontFamily: fonts.text,
    fontSize: fontSize.base,
    color: colors.onSurfaceTertiary,
  },
  chipTextActive: { color: colors.brandPrimary },
  hint: {
    fontFamily: fonts.text,
    fontSize: fontSize.sm,
    color: colors.onSurfaceTertiary,
  },
  resultCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  resultHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  resultTitle: {
    flex: 1,
    fontFamily: fonts.displaySemi,
    fontSize: fontSize.lg,
    color: colors.onSurface,
  },
  fallbackNote: {
    fontFamily: fonts.text,
    fontSize: fontSize.sm,
    color: colors.warning,
  },
  resultScroll: { maxHeight: 260 },
  resultText: {
    fontFamily: fonts.text,
    fontSize: fontSize.lg,
    lineHeight: 24,
    color: colors.onSurfaceSecondary,
  },
  newBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    marginTop: spacing.xs,
  },
  newBtnText: {
    fontFamily: fonts.displaySemi,
    fontSize: fontSize.base,
    color: colors.onSurfaceSecondary,
  },
  downloadBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.brandTertiary,
    borderWidth: 1,
    borderColor: colors.brandSecondary,
  },
  downloadBtnDisabled: { opacity: 0.6 },
  downloadBtnText: {
    fontFamily: fonts.displaySemi,
    fontSize: fontSize.lg,
    color: colors.brandPrimary,
  },
  bottomBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    height: 54,
    borderRadius: radius.md,
    backgroundColor: colors.brandPrimary,
  },
  ctaDisabled: { backgroundColor: colors.surfaceTertiary },
  ctaText: {
    fontFamily: fonts.display,
    fontSize: fontSize.xl,
    color: colors.onBrandPrimary,
    letterSpacing: 0.5,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(9,10,12,0.92)",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  overlayTitle: {
    fontFamily: fonts.display,
    fontSize: fontSize.xl,
    color: colors.onSurface,
    marginTop: spacing.sm,
  },
  overlaySub: {
    fontFamily: fonts.text,
    fontSize: fontSize.base,
    color: colors.onSurfaceTertiary,
    textAlign: "center",
  },
});
