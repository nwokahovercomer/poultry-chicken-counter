import React, { useState, useRef } from "react";
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

type SetStatus = "counting" | "done" | "error";
type ImgSet = {
  id: string;
  uris: string[];
  createdAt: number;
  status: SetStatus;
  counts: number[] | null;
  voted: number | null;
  errorMessage?: string;
};

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
  counting: "#B8860B",
  countingTint: "#FBF0D9",
  danger: "#C0392B",
  dangerTint: "#F8E3E1",
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
  const [pendingReview, setPendingReview] = useState<string[] | null>(null);
  const [autoCapture, setAutoCapture] = useState(false);
  const [showCamera, setShowCamera] = useState(false);

  // Sum of every finished set's count. Derived, not stored — so deleting a
  // set automatically removes its contribution with no manual bookkeeping.
  const cumulativeTotal = sets.reduce(
    (sum, s) => sum + (s.status === "done" && s.voted != null ? s.voted : 0),
    0
  );
  const anySetsCounting = sets.some((s) => s.status === "counting");

  // Caps how many sets count at once. Approving (or retrying) many sets in
  // quick succession queues the rest instead of firing every request at
  // the proxy simultaneously. Refs, not state — this bookkeeping doesn't
  // need to trigger re-renders itself.
  const MAX_CONCURRENT = 3;
  const queueRef = useRef<{ id: string; uris: string[] }[]>([]);
  const activeCountRef = useRef(0);

  function enqueueCount(id: string, uris: string[]) {
    queueRef.current.push({ id, uris });
    processQueue();
  }

  function processQueue() {
    while (activeCountRef.current < MAX_CONCURRENT && queueRef.current.length > 0) {
      const next = queueRef.current.shift()!;
      activeCountRef.current += 1;
      runSetCount(next.id, next.uris).finally(() => {
        activeCountRef.current -= 1;
        processQueue();
      });
    }
  }

  // --- capture: manual (single photo via native camera/gallery UI) --------
  async function addPhoto(fromCamera: boolean) {
    if (current.length >= 3 || pendingReview) return;

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

    // Native preview (Retake/Use) confirms each individual photo. The set
    // as a whole still gets its own Approve/Replace step once it hits 3.
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
        setPendingReview(next);
        return [];
      }
      return next;
    });
  }

  function removeCurrentPhoto(index: number) {
    setCurrent((prev) => prev.filter((_, i) => i !== index));
  }

  // Sends the in-progress set to review instead of finalizing it directly,
  // even with fewer than 3 photos — keeps one consistent approve/replace
  // path regardless of how a set got finished.
  function addSetEarly() {
    if (current.length === 0) return;
    setPendingReview(current);
    setCurrent([]);
  }

  function approveReview() {
    if (!pendingReview) return;
    completeSet(pendingReview);
    setPendingReview(null);
  }

  function replaceReview() {
    setPendingReview(null);
  }

  // Finalizes a set and immediately kicks off counting for just that set —
  // no batch "Count Chickens" step anymore.
  function completeSet(uris: string[]) {
    const id = `${Date.now()}`;
    setSets((prev) => [
      ...prev,
      { id, uris, createdAt: Date.now(), status: "counting", counts: null, voted: null },
    ]);
    enqueueCount(id, uris);
  }

  async function runSetCount(id: string, uris: string[]) {
    try {
      const counts: number[] = [];
      for (const uri of uris) {
        const b64 = await prepareImage(uri);
        const count = await countImageWithRetry(b64);
        counts.push(count);
      }
      const voted = roundedMeanVote(counts);
      // Functional update + id match: if this set was deleted or pulled
      // back into Edit while counting was in flight, there's no matching
      // id anymore and this safely no-ops instead of resurrecting it.
      setSets((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status: "done", counts, voted } : s))
      );
    } catch (e) {
      setSets((prev) =>
        prev.map((s) =>
          s.id === id
            ? {
                ...s,
                status: "error",
                errorMessage: e instanceof Error ? e.message : "Counting failed.",
              }
            : s
        )
      );
    }
  }

  function retrySet(id: string) {
    const set = sets.find((s) => s.id === id);
    if (!set) return;
    setSets((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: "counting", errorMessage: undefined } : s))
    );
    enqueueCount(id, set.uris);
  }

  function handleTakePhotoPress() {
    if (pendingReview) {
      Alert.alert("Resolve the current set first", "Approve or replace the set awaiting review before starting another.");
      return;
    }
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
    // CameraScreen's own review screen (Retake All / Use These) already
    // serves as the approve/replace step for auto-capture, so this goes
    // straight to counting rather than a second outer review.
    if (uris.length === 3) {
      completeSet(uris);
    } else if (uris.length > 0) {
      Alert.alert("Incomplete set", "Fewer than 3 photos came through — please try auto-capture again.");
    }
  }

  function deleteSet(id: string) {
    setSets((prev) => prev.filter((s) => s.id !== id));
  }

  function clearAllSets() {
    Alert.alert(
      "Clear all sets?",
      `This removes all ${sets.length} set${sets.length > 1 ? "s" : ""} and any photos in progress. This can't be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear All",
          style: "destructive",
          onPress: () => {
            setSets([]);
            setCurrent([]);
            setPendingReview(null);
          },
        },
      ]
    );
  }

  function reopenSet(id: string) {
    if (pendingReview) {
      Alert.alert("Resolve the current set first", "Approve or replace the set awaiting review before editing another.");
      return;
    }
    if (current.length > 0) {
      Alert.alert("Finish the current set first", "Add or clear the in-progress photos before editing another set.");
      return;
    }
    const set = sets.find((s) => s.id === id);
    if (!set) return;
    setSets((prev) => prev.filter((s) => s.id !== id));
    setCurrent(set.uris);
  }

  const takePhotoDisabled = current.length >= 3 || !!pendingReview || (autoCapture && current.length > 0);

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

        {/* Running total — always visible, updates live as sets finish */}
        <View style={styles.totalBox}>
          <Text style={styles.totalLabel}>Total chickens</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={styles.totalText}>{cumulativeTotal}</Text>
            {anySetsCounting && <ActivityIndicator color={COLORS.green} />}
          </View>
          {sets.length > 0 && (
            <Text style={styles.totalSubtext}>
              across {sets.filter((s) => s.status === "done").length} of {sets.length} set{sets.length > 1 ? "s" : ""} counted
            </Text>
          )}
        </View>

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

          {pendingReview ? (
            <View style={styles.reviewBox}>
              <Text style={styles.reviewTitle}>Review this set</Text>
              <View style={styles.thumbRow}>
                {pendingReview.map((uri, i) => (
                  <View key={uri} style={styles.thumbWrap}>
                    <Image source={{ uri }} style={styles.thumb} />
                    <View style={styles.thumbNumber}>
                      <Text style={styles.thumbNumberText}>{i + 1}</Text>
                    </View>
                  </View>
                ))}
              </View>
              <View style={styles.reviewActions}>
                <TouchableOpacity style={styles.replaceBtn} onPress={replaceReview}>
                  <Text style={styles.replaceBtnText}>Replace Set</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.approveBtn} onPress={approveReview}>
                  <Ionicons name="checkmark" size={18} color="#fff" style={{ marginRight: 6 }} />
                  <Text style={styles.approveBtnText}>Approve</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <>
              {current.length > 0 && (
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
                </View>
              )}

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
                  <Text style={styles.addEarlyBtnText}>
                    Finish this set with {current.length} photo{current.length > 1 ? "s" : ""}
                  </Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>

        {/* Completed sets */}
        <View style={styles.completedHeaderRow}>
          <Ionicons name="layers-outline" size={18} color={COLORS.deepGreen} />
          <Text style={[styles.sectionLabelPlain, { flex: 1 }]}>Sets ({sets.length})</Text>
          {sets.length > 0 && (
            <TouchableOpacity onPress={clearAllSets}>
              <Text style={styles.clearAllText}>Clear All</Text>
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
              {set.status === "counting" && (
                <View style={[styles.statusPill, { backgroundColor: COLORS.countingTint }]}>
                  <ActivityIndicator size="small" color={COLORS.counting} />
                  <Text style={[styles.statusPillText, { color: COLORS.counting }]}>Counting</Text>
                </View>
              )}
              {set.status === "done" && (
                <View style={styles.statusPill}>
                  <Ionicons name="checkmark" size={12} color={COLORS.success} />
                  <Text style={styles.statusPillText}>Counted: {set.voted}</Text>
                </View>
              )}
              {set.status === "error" && (
                <View style={[styles.statusPill, { backgroundColor: COLORS.dangerTint }]}>
                  <Ionicons name="alert-circle-outline" size={12} color={COLORS.danger} />
                  <Text style={[styles.statusPillText, { color: COLORS.danger }]}>Error</Text>
                </View>
              )}
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
              {set.status === "done" && set.counts && (
                <Text style={styles.countsLine}>Per-image: {set.counts.join(" / ")}</Text>
              )}
              {set.status === "error" && (
                <Text style={[styles.countsLine, { color: COLORS.danger }]}>
                  {set.errorMessage || "Something went wrong."}
                </Text>
              )}
              <View style={styles.setCardActions}>
                {set.status === "error" && (
                  <TouchableOpacity style={styles.linkBtn} onPress={() => retrySet(set.id)}>
                    <Ionicons name="refresh-outline" size={14} color={COLORS.green} />
                    <Text style={styles.linkText}>Retry</Text>
                  </TouchableOpacity>
                )}
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
    marginBottom: 16,
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

  totalBox: {
    marginHorizontal: 16, marginBottom: 20, padding: 18, backgroundColor: COLORS.tint,
    borderRadius: 14, alignItems: "center",
  },
  totalLabel: { fontSize: 13, color: COLORS.muted, fontWeight: "600" },
  totalText: { fontSize: 32, fontWeight: "800", color: COLORS.deepGreen, marginTop: 2 },
  totalSubtext: { fontSize: 12, color: COLORS.muted, marginTop: 4 },

  section: {
    marginHorizontal: 16,
    backgroundColor: COLORS.tint,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  sectionHeaderRow: { flexDirection: "row", gap: 12, marginBottom: 14 },
  numberBadge: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.green,
    alignItems: "center", justifyContent: "center",
  },
  numberBadgeText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: COLORS.text },
  sectionSubtitle: { fontSize: 13, color: COLORS.muted, marginTop: 2 },

  autoRow: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#fff",
    borderRadius: 12, padding: 12, marginBottom: 14,
  },
  autoLabel: { fontWeight: "700", color: COLORS.text, fontSize: 14 },
  autoSubtext: { color: COLORS.muted, fontSize: 12, marginTop: 1 },

  reviewBox: { backgroundColor: "#fff", borderRadius: 12, padding: 12 },
  reviewTitle: { fontWeight: "700", color: COLORS.text, marginBottom: 10 },
  reviewActions: { flexDirection: "row", gap: 10, marginTop: 14 },
  replaceBtn: {
    flex: 1, borderWidth: 1.5, borderColor: COLORS.danger, paddingVertical: 12,
    borderRadius: 10, alignItems: "center", justifyContent: "center",
  },
  replaceBtnText: { color: COLORS.danger, fontWeight: "700" },
  approveBtn: {
    flex: 1, flexDirection: "row", backgroundColor: COLORS.green, paddingVertical: 12,
    borderRadius: 10, alignItems: "center", justifyContent: "center",
  },
  approveBtnText: { color: "#fff", fontWeight: "700" },

  thumbRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  thumbWrap: { position: "relative" },
  thumb: { width: 88, height: 88, borderRadius: 12, backgroundColor: "#fff" },
  thumbNumber: {
    position: "absolute", bottom: 4, left: 4, backgroundColor: "rgba(21,64,46,0.85)",
    width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center",
  },
  thumbNumberText: { color: "#fff", fontSize: 10, fontWeight: "700" },

  removeBadge: {
    position: "absolute", top: -6, right: -6, backgroundColor: COLORS.danger,
    width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center",
  },

  captureRow: { flexDirection: "row", gap: 10, marginTop: 4 },
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
    flexDirection: "row", alignItems: "center", gap: 4,
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

  footerRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, marginTop: 8 },
  footerTagline: { color: COLORS.muted, fontSize: 12 },
});
