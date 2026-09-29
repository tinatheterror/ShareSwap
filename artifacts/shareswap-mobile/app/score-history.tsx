import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
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
import { useAuth } from "@/context/AuthContext";
import { fmtScoreHistoryDate } from "@/lib/dateUtils";

interface ReputationActivity {
  activityType: string;
  points: number;
  description: string;
  createdAt?: string | null;
}

interface ReputationData {
  reputationScore: number;
  reputationLevel: string;
  recentActivities: ReputationActivity[];
}

export default function ScoreHistoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const isWeb = Platform.OS === "web";
  const { data: reputation, isLoading } = useQuery<ReputationData>({
    queryKey: [`/api/users/${user?.id}/reputation`],
    queryFn: () => apiGet<ReputationData>(`/api/users/${user!.id}/reputation`),
    enabled: !!user,
  });

  const activities = (reputation?.recentActivities ?? []).filter((activity) => activity.points !== 0);
  const currentScore = reputation?.reputationScore ?? user?.trustScore ?? 0;
  const currentLevel = currentScore >= 500 ? "ShareSwap Champion"
    : currentScore >= 300 ? "Community Pillar"
    : currentScore >= 150 ? "Trusted Member"
    : currentScore >= 50 ? "Neighbour"
    : "Newcomer";

  if (!user) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Feather name="lock" size={40} color={colors.mutedForeground} />
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Sign in to view score history</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
            paddingTop: insets.top + (isWeb ? 8 : 0),
          },
        ]}
      >
        <Pressable
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back to achievements"
          hitSlop={10}
        >
          <Feather name="chevron-left" size={26} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Score History</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + (isWeb ? 34 : 0) + 30 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.intro, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.iconWrap, { backgroundColor: colors.primary + "18" }]}>
            <Feather name="shield" size={22} color={colors.primary} />
          </View>
          <View style={styles.introCopy}>
            <Text style={[styles.introLabel, { color: colors.mutedForeground }]}>Current trust score</Text>
            <Text style={[styles.introScore, { color: colors.foreground }]}>{currentScore}</Text>
          </View>
          <Text style={[styles.introLevel, { color: colors.primary }]}>{currentLevel}</Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Trust score changes</Text>
          {isLoading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Loading your score history…</Text>
            </View>
          ) : activities.length > 0 ? (
            activities.map((activity, index) => {
              const isPositive = activity.points > 0;
              const dateStr = fmtScoreHistoryDate(activity.createdAt);
              return (
                <View
                  key={`${activity.createdAt}-${activity.activityType}-${index}`}
                  style={[
                    styles.activityRow,
                    index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                  ]}
                >
                  <View style={[styles.activityIcon, { backgroundColor: isPositive ? colors.success + "18" : colors.destructive + "18" }]}>
                    <Feather name={isPositive ? "trending-up" : "trending-down"} size={16} color={isPositive ? colors.success : colors.destructive} />
                  </View>
                  <View style={styles.activityCopy}>
                    <Text style={[styles.activityDesc, { color: colors.foreground }]}>{activity.description}</Text>
                    <Text style={[styles.activityDate, { color: colors.mutedForeground }]}>{dateStr}</Text>
                  </View>
                  <Text style={[styles.pointsText, { color: isPositive ? colors.success : colors.destructive }]}>
                    {isPositive ? "+" : "−"}{Math.abs(activity.points)}
                  </Text>
                </View>
              );
            })
          ) : (
            <View style={styles.emptyState}>
              <Feather name="shield" size={30} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No score changes yet</Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Complete your first share to start building history.</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: { width: 30, alignItems: "flex-start" },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  headerSpacer: { width: 30 },
  scroll: { padding: 16, gap: 14 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  intro: { borderRadius: 20, borderWidth: 1, padding: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  iconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  introCopy: { flex: 1, gap: 2 },
  introLabel: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5 },
  introScore: { fontSize: 28, fontFamily: "Inter_700Bold" },
  introLevel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  card: { borderRadius: 20, borderWidth: 1, padding: 16 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  loadingState: { alignItems: "center", gap: 10, paddingVertical: 28 },
  activityRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12 },
  activityIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  activityCopy: { flex: 1, gap: 2 },
  activityDesc: { fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 17 },
  activityDate: { fontSize: 11, fontFamily: "Inter_400Regular" },
  pointsText: { fontSize: 13, fontFamily: "Inter_700Bold", flexShrink: 0 },
  emptyState: { alignItems: "center", gap: 8, paddingVertical: 30 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19, textAlign: "center" },
});