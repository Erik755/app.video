import { useState, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Share,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import dayjs from "dayjs";

import { colors, spacing, radius, fonts, fontSize } from "@/src/theme";
import { useSpeech } from "@/src/hooks/useSpeech";
import { getHistory, deleteHistoryItem, synthesizeAudio, ScriptItem } from "@/src/api";
import { Toast } from "@/src/components/Toast";
import { HelpModal } from "@/src/components/HelpModal";
import { useMp3Voice } from "@/src/hooks/useMp3Voice";
import { downloadAudioBase64 } from "@/src/utils/audioDownload";

const EMPTY_IMG =
  "https://images.pexels.com/photos/7301210/pexels-photo-7301210.jpeg";

const SOURCE_ICON: Record<string, string> = {
  link: "link",
  upload: "film",
  text: "text",
};

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const { isSpeaking, isPaused, speak, stop } = useSpeech();
  const { voice: mp3Voice } = useMp3Voice();

  const [items, setItems] = useState<ScriptItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "error" | "success" | "info" } | null>(
    null,
  );

  const load = useCallback(async () => {
    try {
      const data = await getHistory();
      setItems(data);
    } catch {
      setToast({ msg: "No se pudo cargar el historial.", type: "error" });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      return () => stop();
    }, [load, stop]),
  );

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const togglePlay = (item: ScriptItem) => {
    if (playingId === item.id && isSpeaking) {
      stop();
      setPlayingId(null);
    } else {
      speak(item.script_generado);
      setPlayingId(item.id);
    }
  };

  const share = async (item: ScriptItem) => {
    try {
      await Share.share({
        message: item.script_generado,
        title: item.source_title || "Guion viral",
      });
    } catch {
      setToast({ msg: "No se pudo compartir.", type: "error" });
    }
  };

  const downloadMp3 = async (item: ScriptItem) => {
    if (downloadingId) return;
    setDownloadingId(item.id);
    setToast({ msg: "Generando audio…", type: "info" });
    try {
      const { audio_base64 } = await synthesizeAudio(item.script_generado, mp3Voice);
      const safe = (item.source_title || "guion")
        .replace(/[^a-z0-9]+/gi, "_")
        .slice(0, 40);
      await downloadAudioBase64(audio_base64, `guionviral_${safe}.mp3`);
      setToast({ msg: "Audio listo para guardar.", type: "success" });
    } catch (e) {
      setToast({
        msg: e instanceof Error ? e.message : "No se pudo generar el audio.",
        type: "error",
      });
    } finally {
      setDownloadingId(null);
    }
  };

  const remove = async (id: string) => {    try {
      if (playingId === id) {
        stop();
        setPlayingId(null);
      }
      await deleteHistoryItem(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
      setToast({ msg: "Guion eliminado.", type: "success" });
    } catch {
      setToast({ msg: "No se pudo eliminar.", type: "error" });
    }
  };

  const renderItem = ({ item }: { item: ScriptItem }) => {
    const active = playingId === item.id && isSpeaking && !isPaused;
    return (
      <View style={styles.card} testID={`history-card-${item.id}`}>
        <View style={styles.cardTop}>
          {item.thumbnail ? (
            <Image
              source={{ uri: item.thumbnail }}
              style={styles.thumb}
              contentFit="cover"
              transition={200}
            />
          ) : (
            <View style={[styles.thumb, styles.thumbPlaceholder]}>
              <Ionicons
                name={(SOURCE_ICON[item.source_type] || "document") as never}
                size={22}
                color={colors.onSurfaceTertiary}
              />
            </View>
          )}
          <View style={styles.cardMeta}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {item.source_title || "Guion generado"}
            </Text>
            <Text style={styles.cardDate}>
              {dayjs(item.created_at).format("DD MMM YYYY · HH:mm")}
            </Text>
          </View>
          <Pressable
            testID={`download-${item.id}`}
            onPress={() => downloadMp3(item)}
            disabled={downloadingId === item.id}
            hitSlop={8}
            style={styles.deleteBtn}
          >
            {downloadingId === item.id ? (
              <ActivityIndicator size="small" color={colors.brandPrimary} />
            ) : (
              <Ionicons name="download-outline" size={18} color={colors.brandPrimary} />
            )}
          </Pressable>
          <Pressable
            testID={`share-${item.id}`}
            onPress={() => share(item)}
            hitSlop={8}
            style={styles.deleteBtn}
          >
            <Ionicons name="share-social-outline" size={18} color={colors.brandPrimary} />
          </Pressable>
          <Pressable
            testID={`delete-${item.id}`}
            onPress={() => remove(item.id)}
            hitSlop={8}
            style={styles.deleteBtn}
          >
            <Ionicons name="trash-outline" size={18} color={colors.onSurfaceTertiary} />
          </Pressable>
        </View>

        <Text style={styles.snippet} numberOfLines={3}>
          {item.script_generado}
        </Text>

        <Pressable
          testID={`play-${item.id}`}
          onPress={() => togglePlay(item)}
          style={[styles.playRow, active && styles.playRowActive]}
        >
          <Ionicons
            name={active ? "stop" : "play"}
            size={16}
            color={active ? colors.onBrandPrimary : colors.brandPrimary}
          />
          <Text style={[styles.playText, active && styles.playTextActive]}>
            {active ? "Detener" : "Reproducir"}
          </Text>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.brand}>Historial</Text>
            <Text style={styles.subtitle}>Tus guiones generados</Text>
          </View>
          <Pressable
            testID="help-button"
            onPress={() => setHelpOpen(true)}
            style={styles.helpBtn}
          >
            <Ionicons name="help-circle-outline" size={20} color={colors.brandPrimary} />
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center} testID="history-empty">
          <Image source={{ uri: EMPTY_IMG }} style={styles.emptyImg} contentFit="cover" />
          <Text style={styles.emptyTitle}>Aún no hay guiones</Text>
          <Text style={styles.emptySub}>
            Genera tu primer guion desde la pestaña Generar.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          contentContainerStyle={{
            padding: spacing.lg,
            paddingBottom: insets.bottom + spacing.xl,
            gap: spacing.md,
          }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.brandPrimary}
            />
          }
        />
      )}

      <Toast
        visible={!!toast}
        message={toast?.msg || ""}
        type={toast?.type || "info"}
        onHide={() => setToast(null)}
      />

      <HelpModal
        visible={helpOpen}
        title="Historial de guiones"
        intro="Aquí se guardan automáticamente todos los guiones que generas."
        steps={[
          "Toca 'Reproducir' para escuchar un guion en voz alta, o 'Detener' para pararlo.",
          "Usa el icono de descarga para generar y guardar el audio MP3 del guion.",
          "El icono de compartir envía el guion a WhatsApp, redes o notas.",
          "El icono de papelera elimina el guion del historial.",
          "Desliza hacia abajo para actualizar la lista.",
        ]}
        onClose={() => setHelpOpen(false)}
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
  helpBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
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
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
  },
  emptyImg: {
    width: 140,
    height: 140,
    borderRadius: radius.lg,
    opacity: 0.7,
    marginBottom: spacing.sm,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontSize: fontSize.xl,
    color: colors.onSurface,
  },
  emptySub: {
    fontFamily: fonts.text,
    fontSize: fontSize.base,
    color: colors.onSurfaceTertiary,
    textAlign: "center",
  },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  thumb: { width: 52, height: 52, borderRadius: radius.md },
  thumbPlaceholder: {
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  cardMeta: { flex: 1 },
  cardTitle: {
    fontFamily: fonts.displaySemi,
    fontSize: fontSize.lg,
    color: colors.onSurface,
  },
  cardDate: {
    fontFamily: fonts.text,
    fontSize: fontSize.sm,
    color: colors.onSurfaceTertiary,
    marginTop: 2,
  },
  deleteBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  snippet: {
    fontFamily: fonts.text,
    fontSize: fontSize.base,
    lineHeight: 20,
    color: colors.onSurfaceSecondary,
  },
  playRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    height: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brandTertiary,
  },
  playRowActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  playText: {
    fontFamily: fonts.displaySemi,
    fontSize: fontSize.base,
    color: colors.brandPrimary,
  },
  playTextActive: { color: colors.onBrandPrimary },
});
