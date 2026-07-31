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

interface Achievement {
  id: number;
  title: string;
  description: string;
  badgeIcon: string;
  category?: string;
  earned: boolean;
  earnedAt?: string;
}

interface TrustData {
  score: number;
  level: string;
  nextLevelScore?: number;
  badges: Achievement[];
}

const LEVEL_COLORS: Record<string, string> = {
  Newcomer: "#94a3b8",
  Neighbour: "#0DCEA1",
  Trusted: "#10b981",
  Community: "#059669",
  Champion: "#f59e0b",
};

const LEVEL_EMOJIS: Record<string, string> = {
  Newcomer: "🌱",
  Neighbour: "🤝",
  Trusted: "⭐",
  Community: "🌟",
  Champion: "🏆",
};

function TrustRing({
  score,
  color,
}: {
  score: number;
  color: string;
}) {
  const pct = Math.min(score / 100, 1);
  const size = 120;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;

  return (
    <View style={styles.ringContainer}>
      <View
        style={[
          styles.ringBg,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: stroke,
            borderColor: color + "20",
          },
        ]}
      >
        <Text style={[styles.ringScore, { color }]}>{score}</Text>
        <Text style={[styles.ringLabel, { color: color + "99" }]}>/ 100</Text>
      </View>
    </View>
  );
}

function BadgeTile({
  achievement,
}: {
  achievement: Achievement;
}) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.badgeTile,
        {
          backgroundColor: achievement.earned
            ? colors.primary + "15"
            : colors.muted,
          borderColor: achievement.earned ? colors.primary + "40" : colors.border,
          opacity: achievement.earned ? 1 : 0.5,
        },
      ]}
    >
      <Text style={styles.badgeEmoji}>{achievement.badgeIcon || "🏅"}</Text>
      <Text
        style={[
          styles.badgeTitle,
          { color: achievement.earned ? colors.foreground : colors.mutedForeground },
        ]}
        numberOfLines={2}
      >
        {achievement.title}
      </Text>
    </View>
  );
}

export default function AchievementsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const router = useRouter();
  const isWeb = Platform.OS === "web";

  const { data, isLoading } = useQuery<TrustData>({
    queryKey: ["/api/achievements"],
    queryFn: () => apiGet<TrustData>("/api/achievements"),
    enabled: !!user,
  });

  const levelColor = data?.level
    ? LEVEL_COLORS[data.level] ?? colors.primary
    : colors.primary;

  const earnedBadges = data?.badges.filter((b) => b.earned) ?? [];
  const unearnedBadges = data?.badges.filter((b) => !b.earned) ?? [];

  const progressPct =
    data?.score && data?.nextLevelScore
      ? Math.min((data.score / data.nextLevelScore) * 100, 100)
      : 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.primary,
            paddingTop: insets.top + (isWeb ? 8 : 0),
          },
        ]}
      >
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={10}>
          <Feather name="chevron-left" size={26} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Achievements</Text>
        <View style={{ width: 30 }} />
      </View>
      {!user ? (
        <View style={styles.centered}>
          <Feather name="lock" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            Sign in to view achievements
          </Text>
        </View>
      ) : isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: insets.bottom + (isWeb ? 34 : 0) + 90 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View
            style={[
              styles.trustCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.trustCardTop}>
              <TrustRing score={data?.score ?? 0} color={levelColor} />
              <View style={styles.trustInfo}>
                <Text style={[styles.trustScoreLabel, { color: colors.mutedForeground }]}>
                  Trust Score
                </Text>
                <View style={styles.levelRow}>
                  <View
                    style={[
                      styles.levelPill,
                      { backgroundColor: levelColor + "20", borderColor: levelColor + "40" },
                    ]}
                  >
                    <Text style={[styles.levelEmoji]}>
                      {LEVEL_EMOJIS[data?.level ?? "Newcomer"] ?? "🌱"}
                    </Text>
                    <Text style={[styles.levelText, { color: levelColor }]}>
                      {data?.level ?? "Newcomer"}
                    </Text>
                  </View>
                </View>
                <Text
                  style={[styles.trustMessage, { color: colors.mutedForeground }]}
                >
                  Keep sharing to level up!
                </Text>
                {data?.nextLevelScore ? (
                  <View style={styles.progressBarContainer}>
                    <View
                      style={[
                        styles.progressBarBg,
                        { backgroundColor: colors.muted },
                      ]}
                    >
                      <View
                        style={[
                          styles.progressBarFill,
                          {
                            backgroundColor: levelColor,
                            width: `${progressPct}%` as `${number}%`,
                          },
                        ]}
                      />
                    </View>
                    <Text
                      style={[styles.progressText, { color: colors.mutedForeground }]}
                    >
                      {data.score}/{data.nextLevelScore} to next level
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>

          {earnedBadges.length > 0 ? (
            <View
              style={[
                styles.badgesCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Earned Badges ({earnedBadges.length})
              </Text>
              <View style={styles.badgesGrid}>
                {earnedBadges.map((b) => (
                  <BadgeTile key={b.id} achievement={b} />
                ))}
              </View>
            </View>
          ) : null}

          {unearnedBadges.length > 0 ? (
            <View
              style={[
                styles.badgesCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
                Locked ({unearnedBadges.length})
              </Text>
              <View style={styles.badgesGrid}>
                {unearnedBadges.map((b) => (
                  <BadgeTile key={b.id} achievement={b} />
                ))}
              </View>
            </View>
          ) : null}

          {!data?.badges?.length ? (
            <View style={styles.emptyBadges}>
              <Feather name="award" size={48} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                No badges yet
              </Text>
              <Text
                style={[styles.emptyText, { color: colors.mutedForeground }]}
              >
                Complete your first share to start earning badges
              </Text>
            </View>
          ) : null}
        </ScrollView>
      )}
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
    paddingBottom: 14,
  },
  backBtn: { width: 30, alignItems: "flex-start" },
  headerTitle: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    color: "#fff",
    letterSpacing: -0.3,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  scroll: {
    padding: 16,
    gap: 14,
  },
  badgeRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  trustCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
  },
  trustCardTop: {
    flexDirection: "row",
    gap: 20,
    alignItems: "center",
  },
  ringContainer: {
    alignItems: "center",
  },
  ringBg: {
    alignItems: "center",
    justifyContent: "center",
  },
  ringScore: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
  },
  ringLabel: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  trustInfo: {
    flex: 1,
    gap: 8,
  },
  trustScoreLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  levelRow: {
    flexDirection: "row",
  },
  levelPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  levelEmoji: {
    fontSize: 14,
  },
  levelText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  trustMessage: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  progressBarContainer: {
    gap: 4,
  },
  progressBarBg: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressBarFill: {
    height: 6,
    borderRadius: 3,
  },
  progressText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  badgesCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  badgesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  badgeTile: {
    width: "30%",
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    alignItems: "center",
    gap: 4,
  },
  badgeEmoji: {
    fontSize: 24,
  },
  badgeTitle: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
    lineHeight: 13,
  },
  emptyBadges: {
    alignItems: "center",
    gap: 12,
    paddingVertical: 48,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
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
});
