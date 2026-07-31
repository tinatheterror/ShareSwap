import { Feather, Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { apiGet, apiRequest } from "@/lib/api";

interface UserProfile {
  id: number;
  username: string; // this is the email
  displayName?: string | null;
  phone?: string | null;
  phoneVerified?: boolean;
  authProvider?: string | null;
}

interface AccountStatus {
  accountStatus: string;
  deactivatedAt?: string | null;
}

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;

  // ── phone state ──────────────────────────────────────────────────────────
  const [phone, setPhone] = useState("");

  // ── password modal state ─────────────────────────────────────────────────
  const [pwdModalVisible, setPwdModalVisible] = useState(false);
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // ── queries ───────────────────────────────────────────────────────────────
  const { data: profile } = useQuery<UserProfile>({
    queryKey: ["user-profile"],
    queryFn: () => apiGet("/api/user-profile"),
  });

  const { data: accountStatus } = useQuery<AccountStatus>({
    queryKey: ["account-status"],
    queryFn: () => apiGet("/api/account/status"),
  });

  useEffect(() => {
    if (profile?.phone) setPhone(profile.phone);
  }, [profile?.phone]);

  // ── mutations ─────────────────────────────────────────────────────────────
  const phoneMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/user-profile", {
        phone: phone.trim(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error || (body as any).message || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-profile"] });
      Alert.alert("Saved", "Phone number registered successfully.");
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const passwordMutation = useMutation({
    mutationFn: async () => {
      if (newPwd !== confirmPwd) throw new Error("New passwords do not match.");
      if (newPwd.length < 8) throw new Error("New password must be at least 8 characters.");
      const res = await apiRequest("POST", "/api/account/change-password", {
        currentPassword: currentPwd,
        newPassword: newPwd,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).message || "Failed to change password");
      }
      return res.json();
    },
    onSuccess: () => {
      setPwdModalVisible(false);
      setCurrentPwd(""); setNewPwd(""); setConfirmPwd("");
      Alert.alert("Password updated", "Your password has been changed.");
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const deactivateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/account/deactivate", {
        confirmDeactivation: true,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).message || "Failed to deactivate");
      }
      return res.json();
    },
    onSuccess: async () => {
      await logout();
      router.replace("/(tabs)" as never);
    },
    onError: (e: Error) => Alert.alert("Cannot deactivate", e.message),
  });

  const handleDeactivate = () => {
    Alert.alert(
      "Deactivate Account",
      "Your profile and listings will be hidden. You can reactivate anytime by logging back in.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Deactivate",
          style: "destructive",
          onPress: () => deactivateMutation.mutate(),
        },
      ]
    );
  };

  const handleDeleteRequest = () => {
    Alert.alert(
      "Delete Account",
      "To permanently delete your account and data, please contact our support team.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Contact Support",
          onPress: () => {
            Alert.alert("Support", "Email us at support@shareswap.community");
          },
        },
      ]
    );
  };

  const closePwdModal = () => {
    setPwdModalVisible(false);
    setCurrentPwd(""); setNewPwd(""); setConfirmPwd("");
    setShowCurrent(false); setShowNew(false); setShowConfirm(false);
  };

  const statusLabel = accountStatus?.accountStatus ?? "active";
  const isActive = statusLabel === "active" || !statusLabel;

  // ── is google / OAuth user (no password) ─────────────────────────────────
  const isOAuthUser = profile?.authProvider && profile.authProvider !== "local";

  return (
    <View style={[styles.container, { backgroundColor: colors.muted ?? "#f5f6f8" }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: topPad + 16, paddingBottom: insets.bottom + 40 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Page header */}
        <View style={styles.pageHeader}>
          <View style={[styles.gearIconWrap, { backgroundColor: "#D4F7F1" }]}>
            <Feather name="settings" size={22} color="#0d9488" />
          </View>
          <View>
            <Text style={[styles.pageTitle, { color: colors.foreground }]}>
              Settings
            </Text>
            <Text style={[styles.pageSubtitle, { color: colors.mutedForeground }]}>
              Manage your account preferences
            </Text>
          </View>
        </View>

        {/* ── Contact ── */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Feather name="phone" size={17} color="#0d9488" />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Contact</Text>
          </View>

          <View style={styles.fieldBlock}>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Phone Number</Text>
            <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>
              Used to manage account security and recovery. Not publicly visible.
            </Text>
            <View style={styles.phoneRow}>
              <TextInput
                style={[
                  styles.phoneInput,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                    color: colors.foreground,
                  },
                ]}
                value={phone}
                onChangeText={setPhone}
                placeholder="e.g. +1 (416) 555-0123"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="phone-pad"
                autoComplete="tel"
              />
              <Pressable
                style={({ pressed }) => [
                  styles.registerBtn,
                  { opacity: pressed || phoneMutation.isPending ? 0.8 : 1 },
                ]}
                onPress={() => phoneMutation.mutate()}
                disabled={phoneMutation.isPending}
              >
                {phoneMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.registerBtnText}>Register</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>

        {/* ── Account ── */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Feather name="shield" size={17} color="#0d9488" />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Account</Text>
          </View>

          {/* Email */}
          <View style={styles.fieldBlock}>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Email Address</Text>
            <Text style={[styles.fieldValue, { color: colors.mutedForeground }]}>
              {profile?.username ?? user?.email ?? "—"}
            </Text>
          </View>

          {/* Change password — only for local accounts */}
          {!isOAuthUser ? (
            <Pressable
              onPress={() => setPwdModalVisible(true)}
              style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[styles.linkText, { color: "#0d9488" }]}>Change password</Text>
            </Pressable>
          ) : (
            <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>
              Password login is managed through your Google account.
            </Text>
          )}

          <View style={[styles.sep, { backgroundColor: colors.border }]} />

          {/* Account Status */}
          <View style={styles.statusRow}>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Account Status</Text>
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: isActive ? "#d1fae5" : "#fee2e2" },
              ]}
            >
              <Text
                style={[
                  styles.statusBadgeText,
                  { color: isActive ? "#065f46" : "#991b1b" },
                ]}
              >
                {isActive ? "Active" : "Deactivated"}
              </Text>
            </View>
          </View>
        </View>

        {/* ── Account Actions ── */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Feather name="alert-triangle" size={17} color={colors.mutedForeground} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Account Actions</Text>
          </View>

          {/* Deactivate */}
          <View style={styles.actionRow}>
            <View style={styles.actionText}>
              <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
                Deactivate Account
              </Text>
              <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>
                Hide your profile and listings.{"\n"}Reactivate anytime by logging back in.
              </Text>
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.outlineBtn,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                  opacity: pressed || deactivateMutation.isPending ? 0.7 : 1,
                },
              ]}
              onPress={handleDeactivate}
              disabled={deactivateMutation.isPending}
            >
              {deactivateMutation.isPending ? (
                <ActivityIndicator size="small" color={colors.foreground} />
              ) : (
                <Text style={[styles.outlineBtnText, { color: colors.foreground }]}>
                  Deactivate
                </Text>
              )}
            </Pressable>
          </View>

          <View style={[styles.sep, { backgroundColor: colors.border }]} />

          {/* Delete */}
          <View style={styles.actionRow}>
            <View style={styles.actionText}>
              <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
                Delete Account
              </Text>
              <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>
                Permanently delete your{"\n"}account and data.
              </Text>
            </View>
            <Pressable
              onPress={handleDeleteRequest}
              style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[styles.linkText, { color: colors.mutedForeground }]}>
                Contact Support
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      {/* ── Change Password Modal ── */}
      <Modal
        visible={pwdModalVisible}
        animationType="slide"
        transparent
        onRequestClose={closePwdModal}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable style={styles.modalBackdrop} onPress={closePwdModal} />
          <View
            style={[
              styles.modalSheet,
              { backgroundColor: colors.card, paddingBottom: insets.bottom + 20 },
            ]}
          >
            <View style={[styles.modalHandle, { backgroundColor: colors.border }]} />
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              Change Password
            </Text>

            {/* Current password */}
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>
              Current Password
            </Text>
            <View style={[styles.pwdRow, { borderColor: colors.border, backgroundColor: colors.background }]}>
              <TextInput
                style={[styles.pwdInput, { color: colors.foreground }]}
                value={currentPwd}
                onChangeText={setCurrentPwd}
                placeholder="Current password"
                placeholderTextColor={colors.mutedForeground}
                secureTextEntry={!showCurrent}
                autoCapitalize="none"
              />
              <Pressable onPress={() => setShowCurrent(v => !v)}>
                <Feather name={showCurrent ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>

            {/* New password */}
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>
              New Password
            </Text>
            <View style={[styles.pwdRow, { borderColor: colors.border, backgroundColor: colors.background }]}>
              <TextInput
                style={[styles.pwdInput, { color: colors.foreground }]}
                value={newPwd}
                onChangeText={setNewPwd}
                placeholder="Min. 8 characters"
                placeholderTextColor={colors.mutedForeground}
                secureTextEntry={!showNew}
                autoCapitalize="none"
              />
              <Pressable onPress={() => setShowNew(v => !v)}>
                <Feather name={showNew ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>

            {/* Confirm password */}
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>
              Confirm New Password
            </Text>
            <View style={[styles.pwdRow, { borderColor: colors.border, backgroundColor: colors.background }]}>
              <TextInput
                style={[styles.pwdInput, { color: colors.foreground }]}
                value={confirmPwd}
                onChangeText={setConfirmPwd}
                placeholder="Re-enter new password"
                placeholderTextColor={colors.mutedForeground}
                secureTextEntry={!showConfirm}
                autoCapitalize="none"
              />
              <Pressable onPress={() => setShowConfirm(v => !v)}>
                <Feather name={showConfirm ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>

            <View style={styles.modalBtns}>
              <Pressable
                style={({ pressed }) => [
                  styles.saveBtn,
                  { opacity: pressed || passwordMutation.isPending ? 0.8 : 1 },
                ]}
                onPress={() => passwordMutation.mutate()}
                disabled={passwordMutation.isPending}
              >
                {passwordMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.saveBtnText}>Update Password</Text>
                )}
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.cancelBtn,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.background,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
                onPress={closePwdModal}
              >
                <Text style={[styles.cancelBtnText, { color: colors.foreground }]}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: {
    paddingHorizontal: 16,
    gap: 16,
  },
  pageHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 4,
  },
  gearIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  pageTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
  },
  pageSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 1,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  fieldBlock: {
    gap: 4,
  },
  fieldLabel: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  fieldHint: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },
  fieldValue: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
  },
  phoneInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  registerBtn: {
    backgroundColor: "#0d9488",
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 90,
  },
  registerBtnText: {
    color: "#fff",
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  linkText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  sep: {
    height: StyleSheet.hairlineWidth,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statusBadge: {
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  statusBadgeText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  actionText: {
    flex: 1,
    gap: 3,
  },
  outlineBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 100,
  },
  outlineBtnText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },

  // Modal
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    gap: 12,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 4,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    marginBottom: 4,
  },
  inputLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    marginBottom: -4,
  },
  pwdRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  pwdInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  modalBtns: {
    gap: 10,
    marginTop: 4,
  },
  saveBtn: {
    backgroundColor: "#0d9488",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  saveBtnText: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  cancelBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  cancelBtnText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
});
