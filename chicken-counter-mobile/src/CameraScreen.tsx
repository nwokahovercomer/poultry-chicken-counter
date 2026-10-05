/**
 * CameraScreen.tsx
 *
 * Full-screen auto-capture camera. Only used for the "Auto-capture" path —
 * manual single-shot photos still go through expo-image-picker's native
 * camera in App.tsx, since that already works well and there's no reason
 * to replace it.
 *
 * Flow: live preview -> short countdown to let the user frame the shot ->
 * 3 photos fired automatically ~2.5s apart -> review screen (Use These /
 * Retake All) -> onDone(uris) with exactly 3 photos, or onCancel().
 */
import React, { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Image, ActivityIndicator } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";

const SHOT_COUNT = 3;
const FRAMING_COUNTDOWN_SECS = 3; // time to let the user position the phone
const SHOT_INTERVAL_MS = 2500;     // gap between each of the 3 shots

type Phase = "framing" | "capturing" | "review";

type Props = {
  onDone: (uris: string[]) => void;
  onCancel: () => void;
};

export default function CameraScreen({ onDone, onCancel }: Props) {
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>("framing");
  const [countdown, setCountdown] = useState(FRAMING_COUNTDOWN_SECS);
  const [shotsTaken, setShotsTaken] = useState(0);
  const [photos, setPhotos] = useState<string[]>([]);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission]);

  // Framing countdown, then kick off the capture sequence.
  useEffect(() => {
    if (phase !== "framing" || !permission?.granted) return;
    if (countdown <= 0) {
      runCaptureSequence();
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, countdown, permission?.granted]);

  async function runCaptureSequence() {
    setPhase("capturing");
    const uris: string[] = [];
    for (let i = 0; i < SHOT_COUNT; i++) {
      try {
        const photo = await cameraRef.current?.takePictureAsync({ quality: 0.9 });
        if (photo?.uri) uris.push(photo.uri);
      } catch {
        // A single missed shot shouldn't abort the whole sequence here —
        // the review screen below lets the user retake all 3 if the set
        // looks wrong, which also covers a dropped shot.
      }
      setShotsTaken(i + 1);
      if (i < SHOT_COUNT - 1) {
        await new Promise((r) => setTimeout(r, SHOT_INTERVAL_MS));
      }
    }
    setPhotos(uris);
    setPhase("review");
  }

  function retakeAll() {
    setPhotos([]);
    setShotsTaken(0);
    setCountdown(FRAMING_COUNTDOWN_SECS);
    setPhase("framing");
  }

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permText}>Camera access is required for auto-capture.</Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>Grant permission</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onCancel} style={{ marginTop: 16 }}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (phase === "review") {
    return (
      <View style={styles.reviewContainer}>
        <Text style={styles.reviewTitle}>3 photos captured</Text>
        <View style={styles.reviewRow}>
          {photos.map((uri, i) => (
            <Image key={uri} source={{ uri }} style={styles.reviewThumb} />
          ))}
        </View>
        {photos.length < SHOT_COUNT && (
          <Text style={styles.reviewWarning}>
            Only {photos.length} of {SHOT_COUNT} came through — retaking is recommended.
          </Text>
        )}
        <View style={styles.reviewActions}>
          <TouchableOpacity style={styles.retakeBtn} onPress={retakeAll}>
            <Text style={styles.retakeBtnText}>Retake All</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.useBtn, photos.length === 0 && styles.disabled]}
            disabled={photos.length === 0}
            onPress={() => onDone(photos)}
          >
            <Text style={styles.useBtnText}>Use These</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />

      <TouchableOpacity style={styles.closeBtn} onPress={onCancel}>
        <Ionicons name="close" size={26} color="#fff" />
      </TouchableOpacity>

      <View style={styles.overlay}>
        {phase === "framing" ? (
          <>
            <Text style={styles.overlayBig}>{countdown > 0 ? countdown : "Go!"}</Text>
            <Text style={styles.overlayHint}>Frame the group — capturing starts automatically</Text>
          </>
        ) : (
          <>
            <Text style={styles.overlayBig}>{shotsTaken}/{SHOT_COUNT}</Text>
            <View style={styles.dotsRow}>
              {Array.from({ length: SHOT_COUNT }).map((_, i) => (
                <View key={i} style={[styles.dot, i < shotsTaken && styles.dotFilled]} />
              ))}
            </View>
            <Text style={styles.overlayHint}>Hold steady — capturing…</Text>
          </>
        )}
      </View>
    </View>
  );
}

const GREEN = "#1F6E43";

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center", padding: 24 },
  permText: { color: "#fff", textAlign: "center", marginBottom: 16, fontSize: 15 },
  permBtn: { backgroundColor: GREEN, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 10 },
  permBtnText: { color: "#fff", fontWeight: "700" },
  cancelText: { color: "#bbb", fontSize: 14 },

  closeBtn: {
    position: "absolute", top: 50, right: 20, zIndex: 2,
    width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center", justifyContent: "center",
  },
  overlay: {
    position: "absolute", bottom: 60, left: 0, right: 0,
    alignItems: "center", gap: 10,
  },
  overlayBig: { color: "#fff", fontSize: 40, fontWeight: "800" },
  overlayHint: { color: "#e6e6e6", fontSize: 14 },
  dotsRow: { flexDirection: "row", gap: 10 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: "rgba(255,255,255,0.35)" },
  dotFilled: { backgroundColor: "#fff" },

  reviewContainer: { flex: 1, backgroundColor: "#111", padding: 20, justifyContent: "center" },
  reviewTitle: { color: "#fff", fontSize: 18, fontWeight: "700", textAlign: "center", marginBottom: 16 },
  reviewRow: { flexDirection: "row", justifyContent: "center", gap: 10, marginBottom: 12 },
  reviewThumb: { width: 100, height: 100, borderRadius: 10, backgroundColor: "#333" },
  reviewWarning: { color: "#F5B301", textAlign: "center", fontSize: 13, marginBottom: 12 },
  reviewActions: { flexDirection: "row", gap: 12, marginTop: 12 },
  retakeBtn: {
    flex: 1, borderWidth: 1.5, borderColor: "#fff", paddingVertical: 14,
    borderRadius: 10, alignItems: "center",
  },
  retakeBtnText: { color: "#fff", fontWeight: "700" },
  useBtn: { flex: 1, backgroundColor: GREEN, paddingVertical: 14, borderRadius: 10, alignItems: "center" },
  useBtnText: { color: "#fff", fontWeight: "700" },
  disabled: { opacity: 0.4 },
});
