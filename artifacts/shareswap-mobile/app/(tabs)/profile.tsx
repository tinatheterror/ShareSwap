import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { apiGet, photoUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { ItemCard, Item } from "@/components/ItemCard";
import { NotificationBell } from "@/components/NotificationBell";

interface ProfileStats {
  completedShares: number;
  activeListings: number;
  referralCount?: number;
}

interface UserProfile {
  shareCoins?: number;
  completedShares?: number;
  averageRating?: number | null;
  reviewCount?: number;
  onTimeReturnRate?: number | null;
  reputationLevel?: string;
  paymentMethodLast4?: string | null;
  idVerified?: boolean;
  isVerified?: boolean;
  profilePhoto?: string | null;
}

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, logout, refetchUser } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isWeb = Platform.OS === "web";
  const [refreshing, setRefreshing] = useState(false);


  const { data: items, refetch: refetchItems } = useQuery<Item[]>({
    queryKey: ["/api/my-items"],
    queryFn: () => apiGet<Item[]>("/api/my-items"),
    enabled: !!user,
  });

  const { data: stats, refetch: refetchStats } = useQuery<ProfileStats>({
    queryKey: ["/api/profile/stats"],
    queryFn: () => apiGet<ProfileStats>("/api/profile/stats"),
    enabled: !!user,
  });

  const { data: userProfile, refetch: refetchProfile } = useQuery<UserProfile>({
    queryKey: ["/api/user-profile"],
    queryFn: () => apiGet<UserProfile>("/api/user-profile"),
    enabled: !!user,
  });


  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([refetchUser(), refetchItems(), refetchStats(), refetchProfile()]);
    setRefreshing(false);
  }

  async function handleLogout() {
    Alert.alert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          await logout();
        },
      },
    ]);
  }

  const topPad = isWeb ? 67 : insets.top;

  if (!user) {
    return (
      <View
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        <View
          style={[
            styles.header,
            {
              paddingTop: topPad + 12,
              borderBottomColor: colors.border,
              backgroundColor: colors.background,
            },
          ]}
        >
          <Text style={[styles.title, { color: colors.foreground }]}>
            Profile
          </Text>
        </View>
        <View style={styles.centered}>
          <Feather name="user" size={48} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            Not signed in
          </Text>
          <Pressable
            style={[styles.signInBtn, { backgroundColor: colors.primary }]}
            onPress={() => router.push("/login")}
          >
            <Text style={[styles.signInBtnText, { color: colors.primaryForeground }]}>Sign In</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const displayName = user.displayName ?? user.handle ?? user.username;
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad + 12,
            borderBottomColor: "transparent",
            backgroundColor: colors.primary,
          },
        ]}
      >
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: colors.foreground, flex: 1 }]}>
            Profile
          </Text>
          <NotificationBell />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + (isWeb ? 34 : 0) + 90 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          style={({ pressed }) => [
            styles.profileCard,
            { backgroundColor: "#D4F7F1", opacity: pressed ? 0.85 : 1 },
          ]}
          onPress={() => router.push(`/profile/${user.id}` as never)}
        >
          <View style={styles.profileTop}>
            {/* Avatar column: circle + Add photo nudge */}
            <View style={styles.avatarCol}>
              <View style={[styles.avatar, { backgroundColor: "#0d9488" }]}>
                {userProfile?.profilePhoto ? (
                  <Image
                    source={{ uri: photoUrl(userProfile.profilePhoto) }}
                    style={styles.avatarImg}
                    resizeMode="cover"
                  />
                ) : (
                  <Text style={[styles.avatarText, { color: "#fff" }]}>{initial}</Text>
                )}
              </View>
              {!userProfile?.profilePhoto && (
                <Pressable
                  style={styles.addPhotoNudge}
                  onPress={() => router.push("/edit-profile" as never)}
                  hitSlop={6}
                >
                  <Text style={styles.addPhotoText}>+1 🪙 · Add photo</Text>
                </Pressable>
              )}
            </View>
            <View style={styles.profileInfo}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={[styles.displayName, { color: colors.foreground }]}>
                  {displayName}
                </Text>
                {user.isVerified ? (
                  <MaterialCommunityIcons name="check-decagram" size={18} color={colors.primary} />
                ) : null}
              </View>
              <Text
                style={[styles.username, { color: colors.mutedForeground }]}
              >
                @{user.handle ?? user.username}
              </Text>
            </View>
            <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
          </View>
        </Pressable>

        <View
          style={[
            styles.menuCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Pressable
            style={styles.menuRow}
            onPress={() => router.push("/wallet")}
          >
            <View style={[styles.menuIcon, { backgroundColor: colors.muted }]}>
              <Feather name="credit-card" size={18} color={colors.mutedForeground} />
            </View>
            <View style={styles.menuTextGroup}>
              <Text style={[styles.menuLabel, { color: colors.foreground }]}>My Balance</Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </Pressable>

          <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />

          <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />

          <Pressable
            style={styles.menuRow}
            onPress={() => router.push("/subscription" as any)}
          >
            <View style={[styles.menuIcon, { backgroundColor: "#D4F7F1" }]}>
              <Feather name="award" size={18} color="#0d9488" />
            </View>
            <View style={styles.menuTextGroup}>
              <Text style={[styles.menuLabel, { color: colors.foreground }]}>Subscription</Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </Pressable>

          <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />

          <Pressable
            style={styles.menuRow}
            onPress={() => router.push("/settings")}
          >
            <View style={[styles.menuIcon, { backgroundColor: colors.muted }]}>
              <Feather name="settings" size={18} color={colors.mutedForeground} />
            </View>
            <View style={styles.menuTextGroup}>
              <Text style={[styles.menuLabel, { color: colors.foreground }]}>Account Settings</Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {/* Verification Status card */}
        <View style={[
          styles.sectionCard,
          user.isVerified
            ? { backgroundColor: "#D4F7F1" }
            : { backgroundColor: "#FFFBEB" },
        ]}>
          <View style={styles.sectionCardHeader}>
            <View style={styles.sectionCardTitleRow}>
              <Feather
                name="shield"
                size={18}
                color={user.isVerified ? "#16a34a" : "#d97706"}
              />
              <Text style={[styles.sectionCardTitle, { color: colors.foreground }]}>
                Verification Status
              </Text>
            </View>
            <View style={[
              styles.verifiedChip,
              { backgroundColor: user.isVerified ? "#dcfce7" : "#fef3c7",
                borderColor: user.isVerified ? "#86efac" : "#fcd34d" },
            ]}>
              <Text style={[styles.verifiedChipText, { color: user.isVerified ? "#15803d" : "#92400e" }]}>
                {user.isVerified ? "Verified" : "Unverified"}
              </Text>
            </View>
          </View>

          <Pressable
            style={[styles.verifyRow, { backgroundColor: "rgba(255,255,255,0.8)", borderColor: colors.border }]}
            onPress={() => router.push("/payment-methods" as any)}
          >
            <Feather
              name={userProfile?.paymentMethodLast4 ? "check" : "x"}
              size={15}
              color={userProfile?.paymentMethodLast4 ? "#16a34a" : "#9ca3af"}
            />
            <Feather name="credit-card" size={15} color={colors.mutedForeground} />
            <Text style={[styles.verifyRowText, { color: colors.foreground }]}>Payment Methods</Text>
          </Pressable>

          <Pressable
            style={[styles.verifyRow, { backgroundColor: "rgba(255,255,255,0.8)", borderColor: colors.border }]}
            onPress={() => router.push("/verification" as any)}
          >
            <Feather
              name={userProfile?.idVerified ? "check" : "x"}
              size={15}
              color={userProfile?.idVerified ? "#16a34a" : "#9ca3af"}
            />
            <Feather name="shield" size={15} color={colors.mutedForeground} />
            <Text style={[styles.verifyRowText, { color: colors.foreground }]}>Identity Verification</Text>
          </Pressable>
        </View>

        {/* Account Statistics card */}
        <View style={[styles.sectionCard, { backgroundColor: "#D4F7F1" }]}>
          <View style={styles.sectionCardHeader}>
            <View style={styles.sectionCardTitleRow}>
              <Feather name="trending-up" size={18} color="#0d9488" />
              <Text style={[styles.sectionCardTitle, { color: colors.foreground }]}>Account Statistics</Text>
            </View>
          </View>

          {[
            { label: "Level", icon: "award", value: userProfile?.reputationLevel ?? user.reputationLevel ?? "Newcomer" },
            { label: "ShareCoins", icon: "dollar-sign", value: String(Math.round(Number(userProfile?.shareCoins ?? user.shareCoins ?? 0))) },
            { label: "Completed Shares", icon: "package", value: String(userProfile?.completedShares ?? stats?.completedShares ?? 0) },
            {
              label: "Rating",
              icon: "star",
              value: userProfile?.averageRating != null
                ? `${Number(userProfile.averageRating).toFixed(1)} ★ · ${userProfile.reviewCount ?? 0} reviews`
                : `— · ${userProfile?.reviewCount ?? 0} reviews`,
            },
            { label: "Trust Score", icon: "shield", value: String(user.trustScore ?? 0) },
            {
              label: "On-time Returns",
              icon: "clock",
              value: userProfile?.onTimeReturnRate != null ? `${userProfile.onTimeReturnRate}%` : "—",
            },
          ].map(({ label, icon, value }) => (
            <View key={label} style={styles.statRow}>
              <View style={styles.statRowLeft}>
                <Feather name={icon as any} size={15} color="#0d9488" />
                <Text style={[styles.statRowLabel, { color: "#475569" }]}>{label}</Text>
              </View>
              <Text style={[styles.statRowValue, { color: "#0f766e" }]}>{value}</Text>
            </View>
          ))}
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.logoutBtn,
            {
              borderColor: colors.border,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
          onPress={handleLogout}
        >
          <Feather name="log-out" size={16} color={colors.destructive} />
          <Text style={[styles.logoutText, { color: colors.destructive }]}>
            Sign out
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  scroll: {
    padding: 16,
    gap: 16,
  },
  profileCard: {
    borderRadius: 20,
    padding: 20,
    gap: 14,
  },
  profileTop: {
    flexDirection: "row",
    gap: 14,
    alignItems: "center",
  },
  avatarCol: {
    alignItems: "center",
    gap: 6,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImg: {
    width: 72,
    height: 72,
  },
  avatarText: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
  },
  addPhotoNudge: {},
  addPhotoText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: "#f59e0b",
  },
  profileInfo: {
    flex: 1,
    gap: 4,
  },
  displayName: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
  },
  username: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  locationText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  bio: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  stat: {
    flex: 1,
    alignItems: "center",
    gap: 2,
  },
  statDivider: {
    width: 1,
    height: 32,
  },
  statValue: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
  },
  statLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  verifiedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  verifiedText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  sectionTitle: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    marginTop: 4,
    marginBottom: 4,
  },
  menuCard: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: "hidden",
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
  },
  menuIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  menuTextGroup: {
    flex: 1,
    gap: 2,
  },
  menuLabel: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  menuSubtext: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 64,
  },
  emptyListings: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 32,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    padding: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  signInBtn: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 14,
  },
  signInBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  plansSection: {
    gap: 12,
  },
  plansSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  plansSectionTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.3,
  },
  plansSectionSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: -4,
    marginBottom: 4,
  },
  planCard: {
    borderRadius: 16,
    borderWidth: 2,
    padding: 16,
    gap: 12,
  },
  planCardActive: {
    shadowColor: "#000",
    shadowOpacity: 0.07,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  popularBadge: {
    alignSelf: "center",
    backgroundColor: "#0d9488",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 3,
    marginTop: -8,
  },
  popularBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  planCurrentBanner: {
    borderBottomWidth: 1,
    paddingBottom: 10,
    gap: 4,
  },
  planCurrentLabel: {
    fontSize: 10,
    color: "#94a3b8",
    fontFamily: "Inter_400Regular",
  },
  planBorrowCount: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  activePill: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 20,
    borderWidth: 1,
  },
  planRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  planIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  planName: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    lineHeight: 18,
  },
  planBillingNote: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  planPrice: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
  },
  planFeatures: {
    gap: 8,
  },
  planFeatureRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  planDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#cbd5e1",
    marginTop: 4,
  },
  planFeatureText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
  planBtn: {
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 9,
    alignItems: "center",
  },
  planBtnGhost: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
  },
  planBtnFilled: {
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  plansFooter: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 16,
    marginTop: 4,
  },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    marginTop: 8,
  },
  logoutText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  sectionCard: {
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  sectionCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  sectionCardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionCardTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  verifiedChip: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
  },
  verifiedChipText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  verifyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  verifyRowText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  statRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statRowLabel: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  statRowValue: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
});
