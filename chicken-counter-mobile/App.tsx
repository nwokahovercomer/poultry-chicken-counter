import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Image,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Switch,
  Modal,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { prepareImage } from "./src/imagePrep";
import { countImageWithRetry } from "./src/api";
import { roundedMeanVote } from "./src/voting";
import CameraScreen from "./src/CameraScreen";

type ImgSet = { id: string; uris: string[]; createdAt: number };
type SetResult = { counts: number[]; voted: number };

const COLORS = {
  deepGreen: "#15402E",
  green: "#1F6E43",
  greenLight: "#5E9C78",
  tint: "#EAF5EC",
  gold: "#F5B301",
  text: "#1B2A22",
  muted: "#6B7A72",
  success: "#1E8F4E",
  successTint: "#DCF5E3",
  danger: "#C0392B",
  border: "#D7E8DC",
};

export default function App() {
  return (
    <SafeAreaProvider>
      <ChickenCounter />
    </SafeAreaProvider>
  );
}

function ChickenCounter() {
  const [sets, setSets] = useState<ImgSet[]>([]);
  const [current, setCurrent] = useState<string[]>([]);
  const [autoCapture, setAutoCapture] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<SetResult[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);

  // --- capture: manual (single photo via native camera/gallery UI) --------
  async function addPhoto(fromCamera: boolean) {
    if (current.length >= 3) return;

    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Permission needed",
        fromCamera
          ? "Camera access is required to take a photo."
          : "Gallery access is required to pick a photo."
      );
      return;
    }

    // Native preview (Retake/Use) is the "if good enough, add it" step.
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.9 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.9 });

    if (result.canceled || !result.assets?.[0]) return;
    addToCurrent(result.assets[0].uri);
  }

  function addToCurrent(uri: string) {
    setCurrent((prev) => {
      const next = [...prev, uri];
      if (next.length === 3) {
        completeSet(next);
        return [];
      }
      return next;
    });
    setResults(null);
    setTotal(null);
  }

  function completeSet(uris: string[]) {
    setSets((s) => [...s, { id: `${Date.now()}`, uris, createdAt: Date.now() }]);
  }

  function handleTakePhotoPress() {
    if (autoCapture) {
      if (current.length > 0) {
        Alert.alert(
          "Finish or clear the current set first",
          "Auto-capture creates a full set of 3 at once, so it can't mix with photos already in progress."
        );
        return;
      }
      setShowCamera(true);
    } else {
      addPhoto(true);
    }
  }

  function handleAutoCaptureDone(uris: string[]) {
    setShowCamera(false);
    if (uris.length === 3) {
      completeSet(uris);
      setResults(null);
      setTotal(null);
    } else if (uris.length > 0) {
      Alert.alert("Incomplete set", "Fewer than 3 photos came through — please try auto-capture again.");
    }
  }

  function removeCurrentPhoto(index: number) {
    setCurrent((prev) => prev.filter((_, i) => i !== index));
  }

  // Finalizes the in-progress set early, even with fewer than 3 photos.
  function addSetEarly() {
    if (current.length === 0) return;
    completeSet(current);
    setCurrent([]);
    setResults(null);
    setTotal(null);
  }

  function deleteSet(id: string) {
    setSets((prev) => prev.filter((s) => s.id !== id));
    setResults(null);
    setTotal(null);
  }

  function clearAllSets() {
    Alert.alert(
      "Clear all sets?",
      `This removes all ${sets.length} completed set${sets.length > 1 ? "s" : ""} and any photos in progress. This can't be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear All",
          style: "destructive",
          onPress: () => {
            setSets([]);
            setCurrent([]);
            setResults(null);
            setTotal(null);
          },
        },
      ]
    );
  }

  function reopenSet(id: string) {
    if (current.length > 0) {
      Alert.alert("Finish the current set first", "Add or clear the in-progress photos before editing another set.");
      return;
    }
    const set = sets.find((s) => s.id === id);
    if (!set) return;
    setSets((prev) => prev.filter((s) => s.id !== id));
    setCurrent(set.uris);
    setResults(null);
    setTotal(null);
  }

  // --- counting --------------------------------------------------------------
  async function countChickens() {
    if (sets.length === 0 || processing) return;
    setProcessing(true);
    setResults(null);
    setTotal(null);
    const totalImages = sets.reduce((n, s) => n + s.uris.length, 0);
    setProgress({ done: 0, total: totalImages });

    const collected: SetResult[] = [];
    let grandTotal = 0;
    let done = 0;

    try {
      for (const set of sets) {
        const counts: number[] = [];
        for (const uri of set.uris) {
          const b64 = await prepareImage(uri);
          const count = await countImageWithRetry(b64);
          counts.push(count);
          done += 1;
          setProgress({ done, total: totalImages });
        }
        const voted = roundedMeanVote(counts);
        grandTotal += voted;
        collected.push({ counts, voted });
      }
      setResults(collected);
      setTotal(grandTotal);
    } catch (e) {
      Alert.alert(
        "Counting failed",
        e instanceof Error ? e.message : "Something went wrong. Please try again."
      );
    } finally {
      setProcessing(false);
    }
  }

  const canCount = sets.length > 0 && current.length === 0 && !processing;
  const takePhotoDisabled = current.length >= 3 || (autoCapture && current.length > 0);

  function formatDate(ts: number) {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) +
      "  " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  // --- UI ----------------------------------------------------------------------
  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <Modal visible={showCamera} animationType="slide" statusBarTranslucent>
        <CameraScreen onDone={handleAutoCaptureDone} onCancel={() => setShowCamera(false)} />
      </Modal>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <LinearGradient
          colors={[COLORS.deepGreen, COLORS.green]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <View style={styles.headerIcon}>
            <Text style={{ fontSize: 24 }}>🐔</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>
              Chicken <Text style={{ color: COLORS.gold }}>Counter</Text>
            </Text>
            <Text style={styles.headerSubtitle}>Count Smarter. Farm Better.</Text>
          </View>
        </LinearGradient>

        {/* Current set */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.numberBadge}>
              <Text style={styles.numberBadgeText}>1</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>Current set ({current.length}/3)</Text>
              <Text style={styles.sectionSubtitle}>
                Take 3 images of the same group of chickens for accurate counting.
              </Text>
            </View>
          </View>
          <View style={styles.pill}>
            <Ionicons name="locate-outline" size={13} color={COLORS.green} />
            <Text style={styles.pillText}>3 images per set</Text>
          </View>

          {/* Auto-capture toggle */}
          <View style={styles.autoRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.autoLabel}>Auto-capture</Text>
              <Text style={styles.autoSubtext}>Takes 3 photos automatically in ~5 seconds</Text>
            </View>
            <Switch
              value={autoCapture}
              onValueChange={setAutoCapture}
              trackColor={{ false: "#ccc", true: COLORS.greenLight }}
              thumbColor={autoCapture ? COLORS.green : "#fff"}
            />
          </View>

          <View style={styles.thumbRow}>
            {current.map((uri, i) => (
              <TouchableOpacity key={uri} style={styles.thumbWrap} onLongPress={() => removeCurrentPhoto(i)}>
                <Image source={{ uri }} style={styles.thumb} />
                <View style={styles.thumbNumber}>
                  <Text style={styles.thumbNumberText}>{i + 1}</Text>
                </View>
                <TouchableOpacity style={styles.removeBadge} onPress={() => removeCurrentPhoto(i)}>
                  <Ionicons name="close" size={14} color="#fff" />
                </TouchableOpacity>
              </TouchableOpacity>
            ))}
            {!autoCapture &&
              Array.from({ length: 3 - current.length }).map((_, i) =>
                i === 0 ? (
                  <TouchableOpacity key="slot-camera" style={styles.dashedSlot} onPress={handleTakePhotoPress}>
                    <View style={styles.plusBadge}>
                      <Ionicons name="add" size={12} color="#fff" />
                    </View>
                    <Ionicons name="camera-outline" size={24} color={COLORS.green} />
                    <Text style={styles.dashedSlotText}>Tap to take photo</Text>
                  </TouchableOpacity>
                ) : i === 1 ? (
                  <TouchableOpacity key="slot-gallery" style={styles.dashedSlot} onPress={() => addPhoto(false)}>
                    <View style={styles.plusBadge}>
                      <Ionicons name="add" size={12} color="#fff" />
                    </View>
                    <Ionicons name="image-outline" size={24} color={COLORS.green} />
                    <Text style={styles.dashedSlotText}>From gallery</Text>
                  </TouchableOpacity>
                ) : (
                  <View key="slot-empty" style={styles.emptySlot}>
                    <Ionicons name="image-outline" size={22} color={COLORS.border} />
                    <Text style={styles.emptySlotText}>{current.length + i + 1}</Text>
                  </View>
                )
              )}
          </View>

          <View style={styles.captureRow}>
            <TouchableOpacity
              style={[styles.btn, takePhotoDisabled && styles.btnDisabled]}
              disabled={takePhotoDisabled}
              onPress={handleTakePhotoPress}
            >
              <Ionicons name="camera-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
              <Text style={styles.btnText}>Take Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btnLight, (current.length >= 3 || autoCapture) && styles.btnDisabled]}
              disabled={current.length >= 3 || autoCapture}
              onPress={() => addPhoto(false)}
            >
              <Ionicons name="images-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
              <Text style={styles.btnText}>From Gallery</Text>
            </TouchableOpacity>
          </View>

          {current.length > 0 && current.length < 3 && (
            <TouchableOpacity style={styles.addEarlyBtn} onPress={addSetEarly}>
              <Text style={styles.addEarlyBtnText}>Finish this set with {current.length} photo{current.length > 1 ? "s" : ""}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Completed sets */}
        <View style={styles.completedHeaderRow}>
          <Ionicons name="layers-outline" size={18} color={COLORS.deepGreen} />
          <Text style={[styles.sectionLabelPlain, { flex: 1 }]}>Completed sets ({sets.length})</Text>
          {sets.length > 0 && (
            <TouchableOpacity onPress={clearAllSets} disabled={processing}>
              <Text style={[styles.clearAllText, processing && { opacity: 0.4 }]}>Clear All</Text>
            </TouchableOpacity>
          )}
        </View>

        {sets.length === 0 && (
          <Text style={styles.emptyText}>
            No sets yet. Add 3 photos above to create your first one.
          </Text>
        )}
        {sets.map((set, idx) => (
          <View key={set.id} style={styles.setCard}>
            <View style={styles.setCardHeader}>
              <View style={styles.numberBadgeSmall}>
                <Text style={styles.numberBadgeSmallText}>{idx + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.setLabel}>Set {idx + 1}</Text>
                <Text style={styles.setMeta}>{set.uris.length} images  •  {formatDate(set.createdAt)}</Text>
              </View>
              <View style={styles.statusPill}>
                <Ionicons name="checkmark" size={12} color={COLORS.success} />
                <Text style={styles.statusPillText}>
                  {results ? `Counted: ${results[idx]?.voted ?? "—"}` : "Ready"}
                </Text>
              </View>
            </View>

            <View style={styles.thumbRow}>
              {set.uris.map((uri, i) => (
                <View key={uri} style={styles.thumbSmallWrap}>
                  <Image source={{ uri }} style={styles.thumbSmall} />
                  <View style={styles.thumbNumberSmall}>
                    <Text style={styles.thumbNumberSmallText}>{i + 1}</Text>
                  </View>
                </View>
              ))}
            </View>

            <View style={styles.setCardFooter}>
              {results && (
                <Text style={styles.countsLine}>
                  Per-image: {results[idx]?.counts.join(" / ")}
                </Text>
              )}
              <View style={styles.setCardActions}>
                <TouchableOpacity style={styles.linkBtn} onPress={() => reopenSet(set.id)}>
                  <Ionicons name="pencil-outline" size={14} color={COLORS.green} />
                  <Text style={styles.linkText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.linkBtn} onPress={() => deleteSet(set.id)}>
                  <Ionicons name="trash-outline" size={14} color={COLORS.danger} />
                  <Text style={[styles.linkText, { color: COLORS.danger }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ))}

        {/* Count button */}
        <TouchableOpacity
          style={[styles.countBtn, !canCount && styles.btnDisabled]}
          disabled={!canCount}
          onPress={countChickens}
        >
          {processing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Text style={{ fontSize: 18, marginRight: 8 }}>🐔</Text>
              <Text style={styles.countBtnText}>Count Chickens</Text>
              <Ionicons name="arrow-forward-circle" size={22} color="#fff" style={{ marginLeft: 8 }} />
            </>
          )}
        </TouchableOpacity>

        {current.length > 0 && (
          <Text style={styles.hint}>Finish the current set before counting.</Text>
        )}

        {processing && (
          <Text style={styles.progressText}>
            Processing {progress.done}/{progress.total} images…
          </Text>
        )}

        {total !== null && (
          <View style={styles.totalBox}>
            <Text style={styles.totalLabel}>Total chickens</Text>
            <Text style={styles.totalText}>{total}</Text>
          </View>
        )}

        <View style={styles.footerRow}>
          <Ionicons name="shield-checkmark-outline" size={14} color={COLORS.muted} />
          <Text style={styles.footerTagline}>Accurate counts. Better decisions.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  scroll: { paddingBottom: 48 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 24,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    marginBottom: 20,
  },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 22, fontWeight: "700", color: "#fff" },
  headerSubtitle: { fontSize: 13, color: "#D7EEDD", marginTop: 2 },

  section: {
    marginHorizontal: 16,
    backgroundColor: COLORS.tint,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  sectionHeaderRow: { flexDirection: "row", gap: 12, marginBottom: 10 },
  numberBadge: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.green,
    alignItems: "center", justifyContent: "center",
  },
  numberBadgeText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: COLORS.text },
  sectionSubtitle: { fontSize: 13, color: COLORS.muted, marginTop: 2 },

  pill: {
    flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start",
    backgroundColor: "#fff", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
    marginBottom: 14,
  },
  pillText: { fontSize: 12, fontWeight: "600", color: COLORS.green },

  autoRow: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#fff",
    borderRadius: 12, padding: 12, marginBottom: 14,
  },
  autoLabel: { fontWeight: "700", color: COLORS.text, fontSize: 14 },
  autoSubtext: { color: COLORS.muted, fontSize: 12, marginTop: 1 },

  thumbRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  thumbWrap: { position: "relative" },
  thumb: { width: 88, height: 88, borderRadius: 12, backgroundColor: "#fff" },
  thumbNumber: {
    position: "absolute", bottom: 4, left: 4, backgroundColor: "rgba(21,64,46,0.85)",
    width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center",
  },
  thumbNumberText: { color: "#fff", fontSize: 10, fontWeight: "700" },

  dashedSlot: {
    width: 88, height: 88, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.greenLight,
    borderStyle: "dashed", alignItems: "center", justifyContent: "center", backgroundColor: "#fff",
    position: "relative", padding: 4,
  },
  plusBadge: {
    position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: 10,
    backgroundColor: COLORS.green, alignItems: "center", justifyContent: "center",
  },
  dashedSlotText: { fontSize: 10, color: COLORS.green, textAlign: "center", marginTop: 4, fontWeight: "600" },

  emptySlot: {
    width: 88, height: 88, borderRadius: 12, backgroundColor: "#F0F0F0",
    alignItems: "center", justifyContent: "center", gap: 4,
  },
  emptySlotText: { color: "#aaa", fontSize: 14, fontWeight: "700" },
  removeBadge: {
    position: "absolute", top: -6, right: -6, backgroundColor: COLORS.danger,
    width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center",
  },

  captureRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  btn: {
    flex: 1, flexDirection: "row", backgroundColor: COLORS.green, paddingVertical: 12,
    borderRadius: 10, alignItems: "center", justifyContent: "center",
  },
  btnLight: {
    flex: 1, flexDirection: "row", backgroundColor: COLORS.greenLight, paddingVertical: 12,
    borderRadius: 10, alignItems: "center", justifyContent: "center",
  },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: "#fff", fontWeight: "600" },

  addEarlyBtn: { marginTop: 10, alignItems: "center" },
  addEarlyBtnText: { color: COLORS.green, fontWeight: "600", fontSize: 13, textDecorationLine: "underline" },

  completedHeaderRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginBottom: 10,
  },
  sectionLabelPlain: { fontSize: 15, fontWeight: "700", color: COLORS.deepGreen },
  clearAllText: { color: COLORS.danger, fontWeight: "600", fontSize: 13 },
  emptyText: { color: COLORS.muted, fontSize: 13, marginHorizontal: 16, marginBottom: 16 },

  setCard: {
    marginHorizontal: 16, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 14, padding: 14, marginBottom: 12,
  },
  setCardHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  numberBadgeSmall: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: COLORS.tint,
    alignItems: "center", justifyContent: "center",
  },
  numberBadgeSmallText: { color: COLORS.green, fontWeight: "700", fontSize: 12 },
  setLabel: { fontWeight: "700", color: COLORS.text },
  setMeta: { color: COLORS.muted, fontSize: 11, marginTop: 1 },
  statusPill: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: COLORS.successTint, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
  },
  statusPillText: { color: COLORS.success, fontSize: 12, fontWeight: "700" },

  thumbSmallWrap: { position: "relative" },
  thumbSmall: { width: 64, height: 64, borderRadius: 8, backgroundColor: "#eee" },
  thumbNumberSmall: {
    position: "absolute", bottom: 3, left: 3, backgroundColor: "rgba(21,64,46,0.85)",
    width: 14, height: 14, borderRadius: 7, alignItems: "center", justifyContent: "center",
  },
  thumbNumberSmallText: { color: "#fff", fontSize: 8, fontWeight: "700" },

  setCardFooter: { marginTop: 10, gap: 8 },
  setCardActions: { flexDirection: "row", gap: 18 },
  linkBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  linkText: { color: COLORS.green, fontWeight: "600", fontSize: 13 },
  countsLine: { color: COLORS.muted, fontSize: 12 },

  countBtn: {
    flexDirection: "row", marginHorizontal: 16, marginTop: 10, backgroundColor: COLORS.green,
    paddingVertical: 16, borderRadius: 14, alignItems: "center", justifyContent: "center",
    shadowColor: COLORS.green, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  countBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },

  hint: { textAlign: "center", color: COLORS.muted, marginTop: 10, fontSize: 12, marginHorizontal: 16 },
  progressText: { textAlign: "center", marginTop: 14, color: COLORS.muted },

  totalBox: {
    marginHorizontal: 16, marginTop: 20, padding: 18, backgroundColor: COLORS.tint,
    borderRadius: 14, alignItems: "center",
  },
  totalLabel: { fontSize: 13, color: COLORS.muted, fontWeight: "600" },
  totalText: { fontSize: 28, fontWeight: "800", color: COLORS.deepGreen, marginTop: 2 },

  footerRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, marginTop: 24 },
  footerTagline: { color: COLORS.muted, fontSize: 12 },
});
