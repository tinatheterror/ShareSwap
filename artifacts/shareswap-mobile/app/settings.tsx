import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
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
  username: string;
  displayName?: string | null;
  phone?: string | null;
  authProvider?: string | null;
}

interface AccountStatus {
  accountStatus?: string;
}

type NotifCategory = "messages" | "requests" | "payments" | "achievements" | "sharecoins" | "return_deadlines";

interface NotificationPrefs {
  messages: boolean;
  requests: boolean;
  payments: boolean;
  achievements: boolean;
  sharecoins: boolean;
}

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;

  // ── state ────────────────────────────────────────────────────────────────
  const [phone, setPhone] = useState((user as any)?.phone || "");
  const [isDeactivated, setIsDeactivated] = useState(false);

  // deactivate modal
  const [deactivateModalOpen, setDeactivateModalOpen] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);

  // password modal
  const [pwdModalVisible, setPwdModalVisible] = useState(false);
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // email modal
  const [emailModalVisible, setEmailModalVisible] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailCurrentPwd, setEmailCurrentPwd] = useState("");
  const [showEmailPwd, setShowEmailPwd] = useState(false);

  // ── queries ───────────────────────────────────────────────────────────────
  const { data: profile } = useQuery<UserProfile>({
    queryKey: ["user-profile"],
    queryFn: () => apiGet("/api/user-profile"),
  });

  const { data: accountStatus } = useQuery<AccountStatus>({
    queryKey: ["account-status"],
    queryFn: () => apiGet("/api/account/status"),
  });

  const { data: notifPrefs, isLoading: notifPrefsLoading } = useQuery<NotificationPrefs>({
    queryKey: ["notification-prefs"],
    queryFn: () => apiGet("/api/user/notification-prefs"),
  });

  const updateNotifPrefMutation = useMutation({
    mutationFn: async (update: Partial<NotificationPrefs>) => {
      const res = await apiRequest("PATCH", "/api/user/notification-prefs", update);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Could not save preference.");
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notification-prefs"] });
    },
    onError: (error: Error) => {
      Alert.alert("Failed to save", error.message);
      queryClient.invalidateQueries({ queryKey: ["notification-prefs"] });
    },
  });

  useEffect(() => {
    if (profile?.phone) setPhone(profile.phone);
  }, [profile?.phone]);

  // ── mutations — exactly mirrors web app ──────────────────────────────────

  // Phone: PATCH /api/user-profile  { phone }
  const updatePhoneMutation = useMutation({
    mutationFn: async (phoneNumber: string) => {
      const res = await apiRequest("PATCH", "/api/user-profile", {
        phone: phoneNumber,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || body?.message || "Could not update phone number.");
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-profile"] });
      Alert.alert("Phone number saved", "Your phone number has been updated.");
    },
    onError: (error: Error) => {
      Alert.alert("Failed to save", error.message);
    },
  });

  // Password: POST /api/account/change-password
  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      if (newPwd !== confirmPwd) throw new Error("New passwords do not match.");
      if (newPwd.length < 8) throw new Error("New password must be at least 8 characters.");
      const res = await apiRequest("POST", "/api/account/change-password", {
        currentPassword: currentPwd,
        newPassword: newPwd,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message || "Could not update password.");
      return body;
    },
    onSuccess: () => {
      Alert.alert("Password changed", "Your password has been updated successfully.");
      closePwdModal();
    },
    onError: (error: Error) => {
      Alert.alert("Failed to change password", error.message);
    },
  });

  // Deactivate: POST /api/account/deactivate  — server calls req.logout()
  const deactivateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/account/deactivate", {
        confirmDeactivation: true,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message || "Failed to deactivate account");
      return body;
    },
    onSuccess: () => {
      // Mirror web: clear query cache, show deactivated screen
      queryClient.clear();
      setDeactivateModalOpen(false);
      setIsDeactivated(true);
    },
    onError: (error: Error) => {
      setDeactivateModalOpen(false);
      Alert.alert("Cannot Deactivate", error.message);
    },
  });

  const closePwdModal = () => {
    setPwdModalVisible(false);
    setCurrentPwd(""); setNewPwd(""); setConfirmPwd("");
    setShowCurrent(false); setShowNew(false); setShowConfirm(false);
  };

  const closeEmailModal = () => {
    setEmailModalVisible(false);
    setNewEmail(""); setEmailCurrentPwd("");
    setShowEmailPwd(false);
  };

  // Email change: POST /api/account/change-email
  const changeEmailMutation = useMutation({
    mutationFn: async () => {
      const trimmed = newEmail.trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmed)) throw new Error("Please enter a valid email address.");
      if (!emailCurrentPwd) throw new Error("Current password is required.");
      const res = await apiRequest("POST", "/api/account/change-email", {
        newEmail: trimmed,
        currentPassword: emailCurrentPwd,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message || "Could not update email.");
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-profile"] });
      Alert.alert("Email updated", "Your email address has been changed. Please use your new email to log in.");
      closeEmailModal();
    },
    onError: (error: Error) => {
      Alert.alert("Failed to update email", error.message);
    },
  });

  const openDeactivateModal = () => {
    setConfirmChecked(false);
    setDeactivateModalOpen(true);
  };

  // Contact Support: open mail client (mirrors web toast with email address)
  const handleContactSupport = () => {
    Linking.openURL("mailto:support@shareswap.com").catch(() => {
      Alert.alert(
        "Contact Support",
        "Please email support@shareswap.com to request account deletion."
      );
    });
  };

  const statusLabel = accountStatus?.accountStatus ?? "active";
  const isActive = statusLabel === "active" || !statusLabel;
  const isOAuthUser = !!(profile?.authProvider && profile.authProvider !== "local");

  // ── notification summary ──────────────────────────────────────────────────
  const allNotifCategories: NotifCategory[] = ["messages", "requests", "payments", "achievements", "sharecoins", "return_deadlines"];
  const notifOnCount = notifPrefs ? allNotifCategories.filter(k => notifPrefs[k]).length : null;
  const notifSummary = notifOnCount === null
    ? null
    : notifOnCount === allNotifCategories.length
      ? "All on"
      : notifOnCount === 0
        ? "All off"
        : `${notifOnCount} of ${allNotifCategories.length} on`;

  // ── deactivated screen (mirrors web) ────────────────────────────────────
  if (isDeactivated) {
    return (
      <View style={[styles.container, { backgroundColor: colors.muted ?? "#f5f6f8", alignItems: "center", justifyContent: "center", padding: 24 }]}>
        <View style={[styles.deactivatedCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.deactivatedIcon}>
            <Feather name="user-x" size={32} color="#d97706" />
          </View>
          <Text style={[styles.deactivatedTitle, { color: colors.foreground }]}>Account Deactivated</Text>
          <Text style={[styles.deactivatedBody, { color: colors.mutedForeground }]}>
            Your profile and listings are now hidden from other users. Your transaction history, messages, and reviews have been preserved for trust and safety purposes.
          </Text>
          <View style={[styles.deactivatedInfoBox, { backgroundColor: "#eff6ff", borderColor: "#bfdbfe" }]}>
            <Text style={styles.deactivatedInfoTitle}>Want to come back?</Text>
            <Text style={styles.deactivatedInfoBody}>
              Simply log in again with your credentials and you'll have the option to reactivate your account instantly.
            </Text>
          </View>
          <Pressable
            style={({ pressed }) => [styles.saveBtn, { opacity: pressed ? 0.8 : 1, marginTop: 4 }]}
            onPress={() => router.replace("/login" as never)}
          >
            <Text style={styles.saveBtnText}>Return to Login</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── main screen ──────────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { backgroundColor: colors.muted ?? "#f5f6f8" }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: topPad + 16, paddingBottom: insets.bottom + 40 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Page header */}
        <Pressable
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 8, opacity: pressed ? 0.6 : 1, alignSelf: "flex-start" })}
          onPress={() => router.back()}
        >
          <Feather name="arrow-left" size={16} color={colors.mutedForeground} />
          <Text style={{ fontSize: 14, color: colors.mutedForeground }}>Profile</Text>
        </Pressable>
        <View style={styles.pageHeader}>
          <View style={[styles.gearIconWrap, { backgroundColor: "#D4F7F1" }]}>
            <Feather name="settings" size={22} color="#0d9488" />
          </View>
          <View>
            <Text style={[styles.pageTitle, { color: colors.foreground }]}>Settings</Text>
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
                  { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground },
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
                  { opacity: pressed || updatePhoneMutation.isPending ? 0.8 : 1 },
                ]}
                onPress={() => updatePhoneMutation.mutate(phone)}
                disabled={updatePhoneMutation.isPending}
              >
                {updatePhoneMutation.isPending ? (
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

          <View style={styles.fieldBlock}>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Email Address</Text>
            <Text style={[styles.fieldValue, { color: colors.mutedForeground }]}>
              {(user as any)?.email || profile?.username || "—"}
            </Text>
          </View>

          {!isOAuthUser ? (
            <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
              <Pressable
                onPress={() => setPwdModalVisible(true)}
                style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
              >
                <Text style={[styles.linkText, { color: "#0d9488" }]}>Change password</Text>
              </Pressable>
              <Pressable
                onPress={() => setEmailModalVisible(true)}
                style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
              >
                <Text style={[styles.linkText, { color: "#0d9488" }]}>Change email</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>
              Password login is managed through your Google account.
            </Text>
          )}

          <View style={[styles.sep, { backgroundColor: colors.border }]} />

          <View style={styles.statusRow}>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Account Status</Text>
            <View style={[styles.statusBadge, { backgroundColor: isActive ? "#d1fae5" : "#fee2e2" }]}>
              <Text style={[styles.statusBadgeText, { color: isActive ? "#065f46" : "#991b1b" }]}>
                {isActive ? "Active" : "Deactivated"}
              </Text>
            </View>
          </View>
        </View>

        {/* ── Notifications ── */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Feather name="bell" size={17} color="#0d9488" />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Notifications</Text>
            {notifSummary !== null && (
              <View style={[styles.notifSummaryBadge, { backgroundColor: "#d4f7f1" }]}>
                <Text style={[styles.notifSummaryText, { color: "#0d9488" }]}>{notifSummary}</Text>
              </View>
            )}
          </View>
          <Text style={[styles.fieldHint, { color: colors.mutedForeground, marginTop: -6 }]}>
            Choose which push notifications you receive on this device.
          </Text>

          {/* ── Master mute switch ── */}
          <View style={[styles.notifMasterRow, { borderColor: colors.border }]}>
            <View style={styles.notifText}>
              <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Enable Notifications</Text>
              <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>
                Mute or unmute all notification types at once
              </Text>
            </View>
            <Switch
              value={notifOnCount !== 0}
              onValueChange={(newVal) => {
                updateNotifPrefMutation.mutate({
                  messages: newVal,
                  requests: newVal,
                  payments: newVal,
                  achievements: newVal,
                  sharecoins: newVal,
                });
              }}
              trackColor={{ false: colors.border, true: "#0d9488" }}
              thumbColor="#fff"
              disabled={notifPrefsLoading || updateNotifPrefMutation.isPending || notifOnCount === null}
            />
          </View>

          <View style={[styles.sep, { backgroundColor: colors.border }]} />

          {(
            [
              { key: "messages" as NotifCategory, label: "Messages", hint: "New chat messages from other users" },
              { key: "requests" as NotifCategory, label: "Requests", hint: "New requests, acceptances, and counter-offers" },
              { key: "payments" as NotifCategory, label: "Payments", hint: "Payouts, deposits, and payment confirmations" },
              { key: "achievements" as NotifCategory, label: "Achievements", hint: "Badges and milestones you've earned" },
              { key: "sharecoins" as NotifCategory, label: "ShareCoins", hint: "ShareCoin balance changes and rewards" },
              { key: "return_deadlines" as NotifCategory, label: "Return Deadlines", hint: "Reminders when borrowed items are due back" },
            ] as { key: NotifCategory; label: string; hint: string }[]
          ).map(({ key, label, hint }, idx) => {
            const value = notifPrefs ? notifPrefs[key] : true;
            const masterOff = notifOnCount === 0;
            return (
              <View key={key}>
                {idx > 0 && <View style={[styles.sep, { backgroundColor: colors.border }]} />}
                <View style={[styles.notifRow, masterOff && styles.notifRowMuted]}>
                  <View style={styles.notifText}>
                    <Text style={[styles.fieldLabel, { color: masterOff ? colors.mutedForeground : colors.foreground }]}>{label}</Text>
                    <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>{hint}</Text>
                  </View>
                  <Switch
                    value={value}
                    onValueChange={(newVal) => {
                      updateNotifPrefMutation.mutate({ [key]: newVal });
                    }}
                    trackColor={{ false: colors.border, true: "#0d9488" }}
                    thumbColor="#fff"
                    disabled={notifPrefsLoading || updateNotifPrefMutation.isPending || masterOff}
                  />
                </View>
              </View>
            );
          })}
        </View>

        {/* ── Account Actions ── */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Feather name="alert-triangle" size={17} color={colors.mutedForeground} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Account Actions</Text>
          </View>

          <View style={styles.actionRow}>
            <View style={styles.actionText}>
              <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Deactivate Account</Text>
              <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>
                Hide your profile and listings.{"\n"}Reactivate anytime by logging back in.
              </Text>
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.outlineBtn,
                { borderColor: colors.border, backgroundColor: colors.background, opacity: pressed ? 0.7 : 1 },
              ]}
              onPress={openDeactivateModal}
            >
              <Text style={[styles.outlineBtnText, { color: colors.foreground }]}>Deactivate</Text>
            </Pressable>
          </View>

          <View style={[styles.sep, { backgroundColor: colors.border }]} />

          <View style={styles.actionRow}>
            <View style={styles.actionText}>
              <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Delete Account</Text>
              <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>
                Permanently delete your{"\n"}account and data.
              </Text>
            </View>
            <Pressable
              onPress={handleContactSupport}
              style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[styles.linkText, { color: colors.mutedForeground }]}>Contact Support</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      {/* ── Deactivate Confirm Modal ── */}
      <Modal
        visible={deactivateModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setDeactivateModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setDeactivateModalOpen(false)} />
          <View style={[styles.modalSheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 20 }]}>
            <View style={[styles.modalHandle, { backgroundColor: colors.border }]} />

            <View style={styles.modalTitleRow}>
              <Feather name="user-x" size={20} color="#d97706" />
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>Deactivate Your Account</Text>
            </View>
            <Text style={[styles.modalSubtitle, { color: colors.mutedForeground }]}>
              This will temporarily hide your presence on ShareSwap
            </Text>

            {/* What happens */}
            <View style={styles.infoBox}>
              <Text style={styles.infoBoxTitle}>⚠️ What happens when you deactivate?</Text>
              {[
                "Your profile will be hidden from discovery",
                "All your listings will be archived",
                "You won't be able to send or receive new requests",
                "Your trust score and reputation will be frozen",
              ].map((item) => (
                <Text key={item} style={styles.infoBoxItem}>• {item}</Text>
              ))}
            </View>

            {/* Data preserved */}
            <View style={[styles.infoBox, { backgroundColor: "#eff6ff", borderColor: "#bfdbfe" }]}>
              <Text style={[styles.infoBoxTitle, { color: "#1e40af" }]}>🛡 Your data is preserved</Text>
              <Text style={[styles.infoBoxItem, { color: "#1e40af" }]}>
                Your transaction history, messages, and reviews are retained for trust, safety, and legal compliance. Nothing is deleted.
              </Text>
            </View>

            {/* Confirm checkbox */}
            <Pressable
              style={styles.checkRow}
              onPress={() => setConfirmChecked(v => !v)}
            >
              <View style={[
                styles.checkbox,
                {
                  borderColor: confirmChecked ? "#0d9488" : colors.border,
                  backgroundColor: confirmChecked ? "#0d9488" : colors.background,
                },
              ]}>
                {confirmChecked && <Feather name="check" size={13} color="#fff" />}
              </View>
              <Text style={[styles.checkLabel, { color: colors.foreground }]}>
                I understand that deactivating my account hides my profile and listings, and that my history is retained for trust and safety.
              </Text>
            </Pressable>

            <View style={styles.modalBtns}>
              <Pressable
                style={({ pressed }) => [
                  styles.destructiveBtn,
                  {
                    opacity: (!confirmChecked || deactivateMutation.isPending || pressed) ? 0.5 : 1,
                  },
                ]}
                onPress={() => deactivateMutation.mutate()}
                disabled={!confirmChecked || deactivateMutation.isPending}
              >
                {deactivateMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.saveBtnText}>Deactivate Account</Text>
                )}
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.cancelBtn,
                  { borderColor: colors.border, backgroundColor: colors.background, opacity: pressed ? 0.7 : 1 },
                ]}
                onPress={() => setDeactivateModalOpen(false)}
              >
                <Text style={[styles.cancelBtnText, { color: colors.foreground }]}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Change Email Modal ── */}
      <Modal
        visible={emailModalVisible}
        animationType="slide"
        transparent
        onRequestClose={closeEmailModal}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable style={styles.modalBackdrop} onPress={closeEmailModal} />
          <View style={[styles.modalSheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 20 }]}>
            <View style={[styles.modalHandle, { backgroundColor: colors.border }]} />
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Change Email</Text>

            <Text style={[styles.inputLabel, { color: colors.foreground }]}>New Email Address</Text>
            <View style={[styles.pwdRow, { borderColor: colors.border, backgroundColor: colors.background }]}>
              <TextInput
                style={[styles.pwdInput, { color: colors.foreground }]}
                value={newEmail}
                onChangeText={setNewEmail}
                placeholder="Enter new email"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
              />
            </View>

            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Current Password</Text>
            <View style={[styles.pwdRow, { borderColor: colors.border, backgroundColor: colors.background }]}>
              <TextInput
                style={[styles.pwdInput, { color: colors.foreground }]}
                value={emailCurrentPwd}
                onChangeText={setEmailCurrentPwd}
                placeholder="Confirm with current password"
                placeholderTextColor={colors.mutedForeground}
                secureTextEntry={!showEmailPwd}
                autoCapitalize="none"
              />
              <Pressable onPress={() => setShowEmailPwd(v => !v)}>
                <Feather name={showEmailPwd ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>

            <View style={styles.modalBtns}>
              <Pressable
                style={({ pressed }) => [
                  styles.saveBtn,
                  { opacity: (pressed || changeEmailMutation.isPending || !newEmail || !emailCurrentPwd) ? 0.6 : 1 },
                ]}
                onPress={() => changeEmailMutation.mutate()}
                disabled={changeEmailMutation.isPending || !newEmail || !emailCurrentPwd}
              >
                {changeEmailMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.saveBtnText}>Update Email</Text>
                )}
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.cancelBtn,
                  { borderColor: colors.border, backgroundColor: colors.background, opacity: pressed ? 0.7 : 1 },
                ]}
                onPress={closeEmailModal}
              >
                <Text style={[styles.cancelBtnText, { color: colors.foreground }]}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

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
          <View style={[styles.modalSheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 20 }]}>
            <View style={[styles.modalHandle, { backgroundColor: colors.border }]} />
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Change Password</Text>

            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Current Password</Text>
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

            <Text style={[styles.inputLabel, { color: colors.foreground }]}>New Password</Text>
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

            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Confirm New Password</Text>
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
                  { opacity: (pressed || changePasswordMutation.isPending || !currentPwd || !newPwd || !confirmPwd) ? 0.6 : 1 },
                ]}
                onPress={() => changePasswordMutation.mutate()}
                disabled={changePasswordMutation.isPending || !currentPwd || !newPwd || !confirmPwd}
              >
                {changePasswordMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.saveBtnText}>Update Password</Text>
                )}
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.cancelBtn,
                  { borderColor: colors.border, backgroundColor: colors.background, opacity: pressed ? 0.7 : 1 },
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
  scroll: { paddingHorizontal: 16, gap: 16 },

  pageHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 4 },
  gearIconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  pageTitle: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  pageSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 1 },

  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 14 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },

  fieldBlock: { gap: 4 },
  fieldLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  fieldHint: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  fieldValue: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 2 },

  phoneRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  phoneInput: {
    flex: 1, borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 11,
    fontSize: 14, fontFamily: "Inter_400Regular",
  },
  registerBtn: {
    backgroundColor: "#0d9488", borderRadius: 10,
    paddingHorizontal: 18, paddingVertical: 12,
    alignItems: "center", justifyContent: "center", minWidth: 90,
  },
  registerBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },

  linkText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  sep: { height: StyleSheet.hairlineWidth },
  statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  statusBadge: { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 },
  statusBadgeText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  actionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  actionText: { flex: 1, gap: 3 },
  notifMasterRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 6, marginTop: 4, borderRadius: 8 },
  notifRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 4 },
  notifRowMuted: { opacity: 0.45 },
  notifText: { flex: 1, gap: 3 },
  notifSummaryBadge: { marginLeft: "auto", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  notifSummaryText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  outlineBtn: {
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 16, paddingVertical: 10,
    alignItems: "center", justifyContent: "center", minWidth: 100,
  },
  outlineBtnText: { fontSize: 14, fontFamily: "Inter_500Medium" },

  // Deactivated screen
  deactivatedCard: {
    width: "100%", borderRadius: 20, borderWidth: 1,
    padding: 24, gap: 16, alignItems: "center",
  },
  deactivatedIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: "#fef3c7",
    alignItems: "center", justifyContent: "center",
  },
  deactivatedTitle: { fontSize: 22, fontFamily: "Inter_700Bold", textAlign: "center" },
  deactivatedBody: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  deactivatedInfoBox: { width: "100%", borderWidth: 1, borderRadius: 12, padding: 14, gap: 6 },
  deactivatedInfoTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#1e40af" },
  deactivatedInfoBody: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#1e40af", lineHeight: 18 },

  // Modals
  modalOverlay: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 12 },
  modalHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 4 },
  modalTitleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  modalSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: -6 },

  infoBox: {
    backgroundColor: "#fffbeb", borderColor: "#fde68a",
    borderWidth: 1, borderRadius: 12, padding: 12, gap: 6,
  },
  infoBoxTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#92400e" },
  infoBoxItem: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#92400e", lineHeight: 18 },

  checkRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 4 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2,
    alignItems: "center", justifyContent: "center", marginTop: 1,
  },
  checkLabel: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },

  inputLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: -4 },
  pwdRow: {
    flexDirection: "row", alignItems: "center",
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10, gap: 8,
  },
  pwdInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },

  modalBtns: { gap: 10, marginTop: 4 },
  saveBtn: { backgroundColor: "#0d9488", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  saveBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  destructiveBtn: { backgroundColor: "#dc2626", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  cancelBtn: { borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  cancelBtnText: { fontSize: 15, fontFamily: "Inter_500Medium" },
});
