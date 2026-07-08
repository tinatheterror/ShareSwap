import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { apiGet } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { ShareCoinBadge } from "@/components/ShareCoinBadge";
import { ItemCard, Item } from "@/components/ItemCard";

interface ProfileStats {
  completedShares: number;
  activeListings: number;
  referralCount?: number;
}

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, logout, refetchUser } = useAuth();
  const router = useRouter();
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

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([refetchUser(), refetchItems(), refetchStats()]);
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
            <Text style={styles.signInBtnText}>Sign In</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const displayName = user.displayName ?? user.username;
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
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
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Profile
          </Text>
          <View style={styles.headerActions}>
            <ShareCoinBadge />
            <Pressable
              onPress={() => router.push("/settings")}
              hitSlop={12}
            >
              <Feather name="settings" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>
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
        <View
          style={[
            styles.profileCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.profileTop}>
            <View
              style={[
                styles.avatar,
                { backgroundColor: colors.primary + "30" },
              ]}
            >
              <Text style={[styles.avatarText, { color: colors.primary }]}>
                {initial}
              </Text>
            </View>
            <View style={styles.profileInfo}>
              <Text style={[styles.displayName, { color: colors.foreground }]}>
                {displayName}
              </Text>
              <Text
                style={[styles.username, { color: colors.mutedForeground }]}
              >
                @{user.username}
              </Text>
              {user.neighbourhood ?? user.location ? (
                <View style={styles.locationRow}>
                  <Feather
                    name="map-pin"
                    size={12}
                    color={colors.mutedForeground}
                  />
                  <Text
                    style={[
                      styles.locationText,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {user.neighbourhood ?? user.location}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          {user.bio ? (
            <Text style={[styles.bio, { color: colors.mutedForeground }]}>
              {user.bio}
            </Text>
          ) : null}

          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {user.trustScore ?? 0}
              </Text>
              <Text
                style={[styles.statLabel, { color: colors.mutedForeground }]}
              >
                Trust Score
              </Text>
            </View>
            <View
              style={[styles.statDivider, { backgroundColor: colors.border }]}
            />
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {stats?.completedShares ?? 0}
              </Text>
              <Text
                style={[styles.statLabel, { color: colors.mutedForeground }]}
              >
                Shares
              </Text>
            </View>
            <View
              style={[styles.statDivider, { backgroundColor: colors.border }]}
            />
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {stats?.activeListings ?? items?.length ?? 0}
              </Text>
              <Text
                style={[styles.statLabel, { color: colors.mutedForeground }]}
              >
                Listings
              </Text>
            </View>
          </View>

          {user.isVerified ? (
            <View
              style={[
                styles.verifiedBadge,
                { backgroundColor: colors.accent, borderColor: colors.primary + "40" },
              ]}
            >
              <Feather name="check-circle" size={14} color={colors.primary} />
              <Text style={[styles.verifiedText, { color: colors.primary }]}>
                Verified Member
              </Text>
            </View>
          ) : null}
        </View>

        <View
          style={[
            styles.menuCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Pressable
            style={styles.menuRow}
            onPress={() => router.push("/games")}
          >
            <View style={[styles.menuIcon, { backgroundColor: colors.coin + "20" }]}>
              <Feather name="dollar-sign" size={18} color={colors.coin} />
            </View>
            <View style={styles.menuTextGroup}>
              <Text style={[styles.menuLabel, { color: colors.foreground }]}>
                ShareCoins Wallet
              </Text>
              <Text style={[styles.menuSubtext, { color: colors.mutedForeground }]}>
                {user.shareCoins ?? 0} SC · Earn more
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </Pressable>

          <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />

          <Pressable
            style={styles.menuRow}
            onPress={() => router.push("/achievements")}
          >
            <View style={[styles.menuIcon, { backgroundColor: colors.primary + "20" }]}>
              <Feather name="award" size={18} color={colors.primary} />
            </View>
            <View style={styles.menuTextGroup}>
              <Text style={[styles.menuLabel, { color: colors.foreground }]}>
                Achievements & Trust
              </Text>
              <Text style={[styles.menuSubtext, { color: colors.mutedForeground }]}>
                Badges and trust score
              </Text>
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
              <Text style={[styles.menuLabel, { color: colors.foreground }]}>
                Settings
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {items && items.length > 0 ? (
          <View>
            <Text
              style={[styles.sectionTitle, { color: colors.foreground }]}
            >
              My Listings
            </Text>
            {items.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </View>
        ) : items !== undefined ? (
          <View style={styles.emptyListings}>
            <Feather name="package" size={36} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              No listings yet
            </Text>
            <Text
              style={[styles.emptyText, { color: colors.mutedForeground }]}
            >
              Add your first item to start sharing with neighbours
            </Text>
          </View>
        ) : null}

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
    paddingHorizontal: 20,
    paddingBottom: 16,
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
    borderWidth: 1,
    padding: 20,
    gap: 14,
  },
  profileTop: {
    flexDirection: "row",
    gap: 14,
    alignItems: "center",
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
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
    color: "#fff",
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
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
});
