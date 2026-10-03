import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
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
import { ScreenHeader } from "@/components/ScreenHeader";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { ShareCoinBadge } from "@/components/ShareCoinBadge";

interface Game {
  id: number;
  title: string;
  description?: string;
  provider?: string;
  rewardAmount?: number;
  isActive?: boolean;
  dailyLimit?: number;
  monthlyLimit?: number;
}

interface GameSession {
  id: number;
  game: Game;
  status: string;
  rewardEarned?: number;
  completedAt?: string;
}

export default function GamesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const isWeb = Platform.OS === "web";

  const { data: games, isLoading } = useQuery<Game[]>({
    queryKey: ["/api/games"],
    queryFn: () => apiGet<Game[]>("/api/games"),
    enabled: !!user,
  });

  const { data: sessions } = useQuery<GameSession[]>({
    queryKey: ["/api/game-sessions"],
    queryFn: () => apiGet<GameSession[]>("/api/game-sessions"),
    enabled: !!user,
  });

  const todayEarned =
    sessions
      ?.filter((s) => {
        if (!s.completedAt) return false;
        const today = new Date().toDateString();
        const d = s.completedAt.includes("T") ? s.completedAt : `${s.completedAt}T00:00:00`;
        return new Date(d).toDateString() === today;
      })
      .reduce((a, s) => a + (s.rewardEarned ?? 0), 0) ?? 0;

  const monthEarned =
    sessions
      ?.filter((s) => {
        if (!s.completedAt) return false;
        const now = new Date();
        const raw = s.completedAt.includes("T") ? s.completedAt : `${s.completedAt}T00:00:00`;
        const d = new Date(raw);
        return (
          d.getFullYear() === now.getFullYear() &&
          d.getMonth() === now.getMonth()
        );
      })
      .reduce((a, s) => a + (s.rewardEarned ?? 0), 0) ?? 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Play Games" />
      {!user ? (
        <View style={styles.centered}>
          <Feather name="lock" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            Sign in to earn ShareCoins
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
            {
              paddingBottom: insets.bottom + (isWeb ? 34 : 0) + 90,
            },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.badgeRow}>
            <ShareCoinBadge />
          </View>

          <View style={styles.statsRow}>
            <View
              style={[
                styles.statCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Feather name="dollar-sign" size={20} color={colors.coin} />
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {user.shareCoins ?? 0}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                Balance
              </Text>
            </View>
            <View
              style={[
                styles.statCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Feather name="sun" size={20} color={colors.primary} />
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {todayEarned}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                Today
              </Text>
            </View>
            <View
              style={[
                styles.statCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Feather name="calendar" size={20} color={colors.info} />
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {monthEarned}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                This month
              </Text>
            </View>
          </View>

          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Available Offers
          </Text>

          {!games?.length ? (
            <View style={styles.emptyOffers}>
              <Feather name="gift" size={36} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                No offers right now
              </Text>
              <Text
                style={[styles.emptyText, { color: colors.mutedForeground }]}
              >
                Check back soon for new ways to earn
              </Text>
            </View>
          ) : (
            games
              .filter((g) => g.isActive)
              .map((game) => <GameCard key={game.id} game={game} colors={colors} />)
          )}

          <View
            style={[
              styles.infoBox,
              { backgroundColor: colors.accent, borderColor: colors.primary + "30" },
            ]}
          >
            <Feather name="info" size={16} color={colors.primary} />
            <Text style={[styles.infoText, { color: colors.accentForeground }]}>
              Earn up to 1 SC/day and 20 SC/month from offers. ShareCoins can be
              spent on premium features and community perks.
            </Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function GameCard({
  game,
  colors,
}: {
  game: Game;
  colors: ReturnType<typeof useColors>;
}) {
  const [loading, setLoading] = React.useState(false);
  const [done, setDone] = React.useState(false);

  async function handlePlay() {
    if (loading || done) return;
    setLoading(true);
    try {
      await apiPost(`/api/games/${game.id}/start`);
      setDone(true);
    } catch {}
    setLoading(false);
  }

  return (
    <View
      style={[
        styles.gameCard,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={[styles.gameIcon, { backgroundColor: colors.primary + "20" }]}>
        <Feather name="gift" size={24} color={colors.primary} />
      </View>
      <View style={styles.gameContent}>
        <Text style={[styles.gameName, { color: colors.foreground }]}>
          {game.title}
        </Text>
        {game.description ? (
          <Text
            style={[styles.gameDesc, { color: colors.mutedForeground }]}
            numberOfLines={2}
          >
            {game.description}
          </Text>
        ) : null}
        <View style={styles.gameReward}>
          <Feather name="dollar-sign" size={13} color={colors.coin} />
          <Text style={[styles.rewardText, { color: colors.coin }]}>
            +{game.rewardAmount ?? 1} SC
          </Text>
        </View>
      </View>
      <Pressable
        style={({ pressed }) => [
          styles.playButton,
          {
            backgroundColor: done
              ? colors.muted
              : colors.primary,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
        onPress={handlePlay}
        disabled={loading || done}
      >
        {loading ? (
          <ActivityIndicator size="small" color={colors.primaryForeground} />
        ) : done ? (
          <Feather name="check" size={16} color={colors.mutedForeground} />
        ) : (
          <Feather name="play" size={16} color={colors.primaryForeground} />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 6,
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
  subtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  scroll: {
    padding: 16,
    gap: 16,
  },
  badgeRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  statsRow: {
    flexDirection: "row",
    gap: 10,
  },
  statCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    alignItems: "center",
    gap: 4,
  },
  statValue: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
  },
  statLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  sectionTitle: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    marginTop: 4,
  },
  gameCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  gameIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  gameContent: {
    flex: 1,
    gap: 4,
  },
  gameName: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  gameDesc: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 16,
  },
  gameReward: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 2,
  },
  rewardText: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
  },
  playButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  infoBox: {
    flexDirection: "row",
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    alignItems: "flex-start",
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 32,
  },
  emptyOffers: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 32,
  },
  emptyTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
});
