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
import { getHistory, deleteHistoryItem, ScriptItem } from "@/src/api";
import { Toast } from "@/src/components/Toast";

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

  const [items, setItems] = useState<ScriptItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
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
        <Text style={styles.brand}>Historial</Text>
        <Text style={styles.subtitle}>Tus guiones generados</Text>
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
