import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { apiGet } from "@/lib/api";
import { ItemCard, Item } from "@/components/ItemCard";

interface PublicProfile {
  id: number;
  username: string;
  handle?: string;
  displayName?: string;
  bio?: string;
  profilePhoto?: string;
  isVerified?: boolean;
  reputationScore?: number;
  trustScore?: number;
  location?: string;
  neighbourhood?: string;
  lastActiveAt?: string;
  createdAt?: string;
  completedShares?: number;
  referralCount?: number;
  reviewCount?: number;
  averageRating?: number | null;
  onTimeReturnRate?: number | null;
  replyRate?: number | null;
  issuesCount?: number;
  activeStatus?: { label: string; isNow: boolean } | null;
  responseTime?: string | null;
  items?: Item[];
}

export default function PublicProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isWeb = Platform.OS === "web";

  const { data: profile, isLoading } = useQuery<PublicProfile>({
    queryKey: [`/api/users/${id}/public-profile`],
    queryFn: () => apiGet<PublicProfile>(`/api/users/${id}/public-profile`),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.mutedForeground }}>Profile not found</Text>
      </View>
    );
  }

  const displayName = profile.displayName ?? profile.username;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingBottom: insets.bottom + (isWeb ? 34 : 0) + 24,
          gap: 16,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.avatarRow}>
            <View
              style={[styles.avatar, { backgroundColor: colors.primary + "30" }]}
            >
              <Text style={[styles.avatarText, { color: colors.primary }]}>
                {displayName.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.nameBlock}>
              <Text style={[styles.displayName, { color: colors.foreground }]}>
                {displayName}
              </Text>
              <Text style={[styles.username, { color: colors.mutedForeground }]}>
                @{profile.username}
              </Text>
              {profile.neighbourhood ?? profile.location ? (
                <View style={styles.locRow}>
                  <Feather name="map-pin" size={12} color={colors.mutedForeground} />
                  <Text style={[styles.locText, { color: colors.mutedForeground }]}>
                    {profile.neighbourhood ?? profile.location}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          {profile.bio ? (
            <Text style={[styles.bio, { color: colors.mutedForeground }]}>
              {profile.bio}
            </Text>
          ) : null}

          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={[styles.statVal, { color: colors.foreground }]}>
                {profile.trustScore ?? 0}
              </Text>
              <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>
                Trust
              </Text>
            </View>
            <View style={[styles.div, { backgroundColor: colors.border }]} />
            <View style={styles.stat}>
              <Text style={[styles.statVal, { color: colors.foreground }]}>
                {profile.completedShares ?? 0}
              </Text>
              <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>
                Shares
              </Text>
            </View>
            <View style={[styles.div, { backgroundColor: colors.border }]} />
            <View style={styles.stat}>
              <Text style={[styles.statVal, { color: colors.foreground }]}>
                {profile.referralCount ?? 0}
              </Text>
              <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>
                Neighbours
              </Text>
            </View>
          </View>

          {profile.isVerified ? (
            <View
              style={[
                styles.verifiedBadge,
                { backgroundColor: colors.accent, borderColor: colors.primary + "40" },
              ]}
            >
              <Feather name="check-circle" size={13} color={colors.primary} />
              <Text style={[styles.verifiedText, { color: colors.primary }]}>
                Verified Member
              </Text>
            </View>
          ) : null}
        </View>

        {profile.items && profile.items.length > 0 ? (
          <View>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              Listings
            </Text>
            {profile.items.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </View>
        ) : (
          <View style={styles.emptyListings}>
            <Feather name="package" size={32} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              No listings yet
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    gap: 14,
  },
  avatarRow: {
    flexDirection: "row",
    gap: 14,
    alignItems: "center",
  },
  avatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
  },
  nameBlock: {
    flex: 1,
    gap: 3,
  },
  displayName: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
  },
  username: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  locRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  locText: {
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
  div: {
    width: 1,
    height: 28,
  },
  statVal: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
  },
  statLbl: {
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
    marginBottom: 8,
  },
  emptyListings: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 32,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
});
