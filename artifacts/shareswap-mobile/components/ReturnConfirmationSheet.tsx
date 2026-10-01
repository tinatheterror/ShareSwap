import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPost, apiRequest } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

interface ReturnConfirmationSheetProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  requestId: number;
  itemName: string;
  depositAmount: number | null;
  userRole: "owner" | "borrower";
  requestType?: string;
  endDate?: string | null;
  depositMethod?: string | null;
}

const CONDITION_RATINGS = [
  { value: 4, label: "Good", description: "Minor wear, as expected" },
  { value: 3, label: "Fair", description: "Some wear but acceptable" },
  { value: 2, label: "Poor", description: "Noticeable damage or wear" },
  { value: 1, label: "Damaged", description: "Significant damage occurred" },
];

export function ReturnConfirmationSheet({
  visible,
  onClose,
  onSuccess,
  requestId,
  itemName,
  depositAmount,
  userRole,
  requestType = "BORROW",
  endDate,
  depositMethod,
}: ReturnConfirmationSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const router = useRouter();
  const { refetchUser } = useAuth();

  const [sameCondition, setSameCondition] = useState(true);
  const [conditionRating, setConditionRating] = useState(4);
  const [conditionNotes, setConditionNotes] = useState("");
  const [confirmDispute, setConfirmDispute] = useState(false);
  const [disputePhotoUri, setDisputePhotoUri] = useState<string | null>(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [signInRequired, setSignInRequired] = useState(false);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const completionHandled = useRef(false);

  useEffect(() => {
    setRecoveryPending(false);
    if (visible) completionHandled.current = false;
  }, [visible, requestId, userRole]);

  const recoveryStatus = useQuery<Array<{ id: number; status: string }>>({
    queryKey: ["return-recovery-status", requestId],
    queryFn: () => apiGet("/api/requests"),
    enabled: visible && userRole === "owner" && recoveryPending && !signInRequired,
    refetchInterval: recoveryPending ? 3000 : false,
    retry: false,
  });

  const isEarlyReturn = endDate ? new Date() < new Date(endDate) : false;
  const isRental = requestType === "RENT";
  const shouldTriggerDispute = !sameCondition && conditionRating <= 2;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/requests"] });
    qc.invalidateQueries({ queryKey: ["/api/user"] });
    qc.invalidateQueries({ queryKey: ["/api/inbox"] });
    qc.invalidateQueries({ queryKey: ["/api/inbox/archived"] });
  };

  useEffect(() => {
    if (!visible || !recoveryPending || completionHandled.current) return;
    const recovered = recoveryStatus.data?.find(request => request.id === requestId);
    if (!recovered || !["COMPLETED", "COMPLETED_EARLY"].includes(recovered.status)) return;
    completionHandled.current = true;
    setRecoveryPending(false);
    setSubmitError(null);
    invalidate();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onSuccess();
  }, [visible, recoveryPending, recoveryStatus.data, requestId, onSuccess]);

  function handleSubmitError(error: Error & { status?: number }) {
    const expired = error.status === 401;
    setSignInRequired(expired);
    setRecoveryPending(userRole === "owner" && error.status === 503);
    setSubmitError(expired
      ? "Your sign-in has expired. Sign in again, then reopen this chat to return the item."
      : error.message || "The return could not be saved. Please try again.");
    if (expired) void refetchUser();
  }

  function goToSignIn() {
    handleClose();
    router.push("/login?session_expired=1" as never);
  }

  async function pickDisputePhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow photo access to attach damage evidence.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      setDisputePhotoUri(result.assets[0].uri);
    }
  }

  async function takeDisputePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow camera access to photograph the damage.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      setDisputePhotoUri(result.assets[0].uri);
    }
  }

  // Borrower: initiate return
  const initiateReturnMutation = useMutation({
    mutationFn: () => apiPost(`/api/requests/${requestId}/return`, {}),
    onSuccess: () => {
      if (completionHandled.current) return;
      completionHandled.current = true;
      setRecoveryPending(false);
      setSubmitError(null);
      invalidate();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSuccess();
    },
    onError: handleSubmitError,
  });

  // Owner: confirm return — uploads dispute photo first if present
  const confirmReturnMutation = useMutation({
    mutationFn: async () => {
      let disputePhotoUrl: string | null = null;

      if (shouldTriggerDispute && disputePhotoUri) {
        setIsUploadingPhoto(true);
        try {
          const formData = new FormData();
          const mimeType = disputePhotoUri.endsWith(".png") ? "image/png" : "image/jpeg";
          const filename = `dispute-${Date.now()}.${mimeType === "image/png" ? "png" : "jpg"}`;
          formData.append("photo", { uri: disputePhotoUri, type: mimeType, name: filename } as any);
          const uploadRes = await apiRequest("POST", "/api/uploads/dispute-photo", formData);
          const data = await uploadRes.json();
          if (data?.url) disputePhotoUrl = data.url;
        } catch {
          // Photo upload failed — proceed without it (non-blocking)
        } finally {
          setIsUploadingPhoto(false);
        }
      }

      return apiPost(`/api/requests/${requestId}/confirm-return`, {
        conditionRating: sameCondition ? 5 : conditionRating,
        conditionNotes,
        sameCondition,
        triggerDispute: shouldTriggerDispute,
        disputePhotoUrl,
      });
    },
    onSuccess: () => {
      if (completionHandled.current) return;
      completionHandled.current = true;
      setRecoveryPending(false);
      setSubmitError(null);
      invalidate();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSuccess();
    },
    onError: handleSubmitError,
  });

  const reset = () => {
    setSameCondition(true);
    setConditionRating(4);
    setConditionNotes("");
    setConfirmDispute(false);
    setDisputePhotoUri(null);
    setSubmitError(null);
    setSignInRequired(false);
    setRecoveryPending(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  // ── BORROWER VIEW ──────────────────────────────────────────────────────────
  if (userRole === "borrower") {
    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
        <Pressable style={ss.backdrop} onPress={handleClose} />
        <View
          style={[ss.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 24 }]}
        >
          <View style={[ss.handle, { backgroundColor: colors.border }]} />
          <Text style={[ss.title, { color: colors.foreground }]}>
            {isEarlyReturn ? "Return Item Early" : "Return Item"}
          </Text>

          {isEarlyReturn && (
            <Text style={[ss.sub, { color: colors.mutedForeground }]}>
              {isRental
                ? "You're returning this item before your rental period ends. No refund will be issued for unused days."
                : "You're returning this item early. No penalty applies. The authorization hold will be released once the owner confirms its safe return."}
            </Text>
          )}

          {depositMethod === "in_person" ? (
            <View style={[ss.infoBox, { backgroundColor: "#fffbeb", borderColor: "#fde68a" }]}>
              <Feather name="shield" size={14} color="#b45309" />
              <Text style={{ color: "#92400e", fontSize: 13, flex: 1 }}>
                Your ${depositAmount ?? "–"} deposit was paid in person. Make sure the owner
                returns it to you when you hand back the item.
              </Text>
            </View>
          ) : null}

          <View style={[ss.infoBox, { backgroundColor: "#fffbeb", borderColor: "#fde68a" }]}>
            <Feather name="alert-circle" size={14} color="#b45309" />
            <Text style={{ color: "#92400e", fontSize: 12, flex: 1 }}>
              {isEarlyReturn
                ? "Only initiate the early return process after you've communicated and returned the item to the owner."
                : "Only confirm the return after you've physically handed the item back to the owner."}
            </Text>
          </View>

          {submitError && (
            <View testID="return-submit-error" style={[ss.infoBox, { backgroundColor: "#fef2f2", borderColor: "#fecaca" }]}>
              <Text style={{ color: "#991b1b", fontSize: 13, flex: 1 }}>{submitError}</Text>
            </View>
          )}

          <View style={ss.btnRow}>
            <Pressable
              style={[ss.btn, { flex: 1, borderColor: colors.border }]}
              onPress={handleClose}
              disabled={initiateReturnMutation.isPending}
            >
              <Text style={[ss.btnTxt, { color: colors.foreground }]}>Message Owner</Text>
            </Pressable>
            <Pressable
              testID={signInRequired ? "return-sign-in" : "submit-borrower-return"}
              style={[ss.btn, { flex: 1, backgroundColor: "#2563eb", borderColor: "#2563eb" }]}
              onPress={signInRequired ? goToSignIn : () => {
                setSubmitError(null);
                initiateReturnMutation.mutate();
              }}
              disabled={initiateReturnMutation.isPending}
            >
              {initiateReturnMutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Feather name={signInRequired ? "log-in" : "rotate-ccw"} size={14} color="#fff" />
                  <Text style={[ss.btnTxt, { color: "#fff" }]}>
                    {signInRequired ? "Sign in again" : isEarlyReturn ? "Initiate Early Return" : "Return Item"}
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    );
  }

  // ── OWNER VIEW ─────────────────────────────────────────────────────────────
  const canSubmit =
    !shouldTriggerDispute
      ? sameCondition || conditionNotes.trim().length > 0
      : confirmDispute && conditionNotes.trim().length > 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <Pressable style={ss.backdrop} onPress={handleClose} />
      <View
        style={[
          ss.sheet,
          { backgroundColor: colors.card, paddingBottom: insets.bottom + 24, maxHeight: "90%" },
        ]}
      >
        <View style={[ss.handle, { backgroundColor: colors.border }]} />
        <Text style={[ss.title, { color: colors.foreground }]}>
          {isEarlyReturn ? "Confirm Early Return" : "Confirm Item Return"}
        </Text>

        <ScrollView showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>
          <View style={{ gap: 14, paddingBottom: 8 }}>
            {isEarlyReturn && (
              <View style={[ss.infoBox, { backgroundColor: "#eff6ff", borderColor: "#bfdbfe" }]}>
                <Feather name="clock" size={14} color="#1d4ed8" />
                <Text style={{ color: "#1d4ed8", fontSize: 13, flex: 1 }}>
                  {isRental
                    ? "You keep the full rental amount — no refund for unused days."
                    : "No ShareCoins deducted for early return. Borrower's deposit hold will be released."}
                </Text>
              </View>
            )}

            {/* Same condition checkbox */}
            <Pressable
              style={[ss.conditionCard, { borderColor: sameCondition ? "#0d9488" : colors.border, backgroundColor: colors.muted }]}
              onPress={() => {
                if (recoveryPending) return;
                const next = !sameCondition;
                setSameCondition(next);
                if (next) {
                  setConditionRating(5);
                  setConfirmDispute(false);
                } else {
                  setConditionRating(4);
                }
              }}
            >
              <View
                style={[
                  ss.checkbox,
                  {
                    borderColor: sameCondition ? "#0d9488" : colors.border,
                    backgroundColor: sameCondition ? "#0d9488" : "transparent",
                  },
                ]}
              >
                {sameCondition && <Feather name="check" size={12} color="#fff" />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: colors.foreground }}>
                  Returned in the same condition
                </Text>
                <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 2 }}>
                  Item was returned with no damage or issues
                </Text>
              </View>
            </Pressable>

            {/* Condition rating (shown when not same) */}
            {!sameCondition && (
              <View style={{ gap: 8 }}>
                <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: "Inter_500Medium" }}>
                  ★ Rate Item Condition
                </Text>
                {CONDITION_RATINGS.filter((r) => r.value < 5).map((r) => (
                  <Pressable
                    key={r.value}
                    style={[
                      ss.ratingRow,
                      {
                        borderColor: conditionRating === r.value ? "#0d9488" : colors.border,
                        backgroundColor:
                          conditionRating === r.value ? "#f0fdf4" : colors.background,
                      },
                    ]}
                    disabled={recoveryPending}
                    onPress={() => setConditionRating(r.value)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: colors.foreground }}>
                        {r.label}
                      </Text>
                      <Text style={{ fontSize: 11, color: colors.mutedForeground }}>
                        {r.description}
                      </Text>
                    </View>
                    <View style={{ flexDirection: "row", gap: 2 }}>
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Text
                          key={s}
                          style={{ fontSize: 12, color: s <= r.value ? "#f59e0b" : "#d1d5db" }}
                        >
                          ★
                        </Text>
                      ))}
                    </View>
                  </Pressable>
                ))}
              </View>
            )}

            {/* Notes */}
            <View style={{ gap: 6 }}>
              <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: "Inter_500Medium" }}>
                {!sameCondition ? "Describe the issue *" : "Additional Notes (optional)"}
              </Text>
              <TextInput
                style={[
                  ss.notes,
                  { borderColor: colors.border, backgroundColor: colors.muted, color: colors.foreground },
                ]}
                placeholder={
                  !sameCondition
                    ? "Please describe what happened to the item..."
                    : "Any comments about the item condition..."
                }
                placeholderTextColor={colors.mutedForeground}
                value={conditionNotes}
                editable={!recoveryPending}
                onChangeText={setConditionNotes}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>

            {/* Dispute warning */}
            {shouldTriggerDispute && (
              <View style={[ss.disputeBox, { backgroundColor: "#fef2f2", borderColor: "#fecaca" }]}>
                <Feather name="alert-triangle" size={16} color="#dc2626" />
                <View style={{ flex: 1, gap: 10 }}>
                  <View>
                    <Text style={{ color: "#991b1b", fontFamily: "Inter_500Medium", fontSize: 13 }}>
                      This will open a dispute
                    </Text>
                    <Text style={{ color: "#dc2626", fontSize: 12, marginTop: 3 }}>
                      Since you reported damage, we'll hold the{" "}
                      {isRental ? "renter's" : "borrower's"} ${depositAmount ?? "–"} deposit while
                      we review. Both parties will be contacted to resolve this.
                    </Text>
                  </View>
                  {/* Photo evidence — matches web's camera/file input */}
                  <View style={{ gap: 6 }}>
                    <Text style={{ color: "#991b1b", fontSize: 12, fontFamily: "Inter_500Medium" }}>
                      📷 Add a photo of the damage (recommended)
                    </Text>
                    {disputePhotoUri ? (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Image
                          source={{ uri: disputePhotoUri }}
                          style={{ width: 80, height: 80, borderRadius: 8, borderWidth: 1, borderColor: "#fca5a5" }}
                        />
                        <Pressable
                          onPress={() => setDisputePhotoUri(null)}
                          style={{ padding: 6 }}
                          hitSlop={8}
                        >
                          <Feather name="x-circle" size={20} color="#dc2626" />
                        </Pressable>
                      </View>
                    ) : (
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <Pressable
                          style={[ss.photoBtn, { borderColor: "#fca5a5" }]}
                          onPress={takeDisputePhoto}
                        >
                          <Feather name="camera" size={14} color="#dc2626" />
                          <Text style={{ color: "#dc2626", fontSize: 12 }}>Camera</Text>
                        </Pressable>
                        <Pressable
                          style={[ss.photoBtn, { borderColor: "#fca5a5" }]}
                          onPress={pickDisputePhoto}
                        >
                          <Feather name="image" size={14} color="#dc2626" />
                          <Text style={{ color: "#dc2626", fontSize: 12 }}>Library</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>

                  <Pressable
                    style={ss.disputeCheck}
                    onPress={() => setConfirmDispute(!confirmDispute)}
                  >
                    <View
                      style={[
                        ss.checkbox,
                        {
                          borderColor: confirmDispute ? "#dc2626" : "#fca5a5",
                          backgroundColor: confirmDispute ? "#dc2626" : "transparent",
                        },
                      ]}
                    >
                      {confirmDispute && <Feather name="check" size={12} color="#fff" />}
                    </View>
                    <Text style={{ color: "#991b1b", fontSize: 12, flex: 1 }}>
                      I understand and want to proceed with the dispute
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        </ScrollView>

        {submitError && (
          <View testID="return-submit-error" style={[ss.infoBox, { backgroundColor: "#fef2f2", borderColor: "#fecaca" }]}>
            <Text style={{ color: "#991b1b", fontSize: 13, flex: 1 }}>{submitError}</Text>
          </View>
        )}
        <View style={ss.btnRow}>
          <Pressable
            style={[ss.btn, { flex: 1, borderColor: colors.border }]}
            onPress={handleClose}
            disabled={confirmReturnMutation.isPending}
          >
            <Text style={[ss.btnTxt, { color: colors.foreground }]}>Cancel</Text>
          </Pressable>
          <Pressable
            testID={signInRequired ? "return-sign-in" : "submit-confirm-return"}
            style={[
              ss.btn,
              {
                flex: 1,
                backgroundColor: shouldTriggerDispute ? "#dc2626" : "#16a34a",
                borderColor: shouldTriggerDispute ? "#dc2626" : "#16a34a",
                opacity: canSubmit ? 1 : 0.5,
              },
            ]}
            onPress={signInRequired ? goToSignIn : () => {
              setSubmitError(null);
              confirmReturnMutation.mutate();
            }}
            disabled={(!signInRequired && !canSubmit) || confirmReturnMutation.isPending}
          >
            {confirmReturnMutation.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Feather
                  name={signInRequired ? "log-in" : shouldTriggerDispute ? "alert-triangle" : "check-circle"}
                  size={14}
                  color="#fff"
                />
                <Text style={[ss.btnTxt, { color: "#fff" }]}>
                  {signInRequired ? "Sign in again" : shouldTriggerDispute ? "Open Dispute" : "Confirm Return"}
                </Text>
              </>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const ss = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 14,
  },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 4 },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  sub: { fontSize: 13, lineHeight: 18 },
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
  },
  btnRow: { flexDirection: "row", gap: 10 },
  btn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  btnTxt: { fontSize: 14, fontFamily: "Inter_500Medium" },
  conditionCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    gap: 8,
  },
  notes: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    fontSize: 13,
    minHeight: 72,
  },
  disputeBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
  },
  disputeCheck: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  photoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "dashed",
  },
});
