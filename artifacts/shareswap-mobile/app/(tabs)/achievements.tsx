import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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

// ── Types ────────────────────────────────────────────────────────────────────

interface UserStats {
  totalBorrowed: number;
  totalLent: number;
  totalSwaps: number;
  totalGifts: number;
  successfulHandoffs: number;
  referrals: number;
  helpedUrgent: number;
  reviewsLeft: number;
  reviewsReceived: number;
  itemsListed: number;
  weeklyActivity: number;
  fastResponder: boolean;
  fiveStarNeighbour: boolean;
  earlyMember: boolean;
  courierDeliveries: number;
  totalShareCoinsEarned: number;
  wishlistCount: number;
  goodNeighbour: boolean;
  photoPro: boolean;
  welcomeWagon: boolean;
}

interface TrustData {
  score: number;
  level: string;
  nextLevelScore?: number;
}

interface Review {
  id: number;
  rating: number;
  comment: string | null;
  createdAt: string;
  reviewer: {
    id: number;
    username: string;
    displayName?: string;
    handle?: string;
    profilePhoto?: string;
  };
}

interface BadgeItem {
  id: string;
  name: string;
  icon: string;
  earned: boolean;
  earnedBg: string;
  earnedFg: string;
  description: string;
  requirement: string;
}

// ── Level definitions (mirrors web LEVELS array) ─────────────────────────────

const LEVELS = [
  { name: "Newcomer",           minScore: 0,   perks: ["Access to community ShareChest", "Browse and request items"] },
  { name: "Neighbour",          minScore: 50,  perks: ["10% off trust deposits", "Priority in item requests"] },
  { name: "Trusted Member",     minScore: 150, perks: ["20% off trust deposits", "Access to premium items"] },
  { name: "Community Pillar",   minScore: 300, perks: ["30% off trust deposits"] },
  { name: "ShareSwap Champion", minScore: 500, perks: ["No deposits required", "Verified badge", "Community ambassador status"] },
];

const LEVEL_COLORS: Record<string, string> = {
  Newcomer:           "#94a3b8",
  Neighbour:          "#0DCEA1",
  "Trusted Member":   "#10b981",
  "Community Pillar": "#059669",
  "ShareSwap Champion": "#f59e0b",
};

const LEVEL_EMOJIS: Record<string, string> = {
  Newcomer:           "🌱",
  Neighbour:          "🤝",
  "Trusted Member":   "⭐",
  "Community Pillar": "🌟",
  "ShareSwap Champion": "🏆",
};

// ── Badge factory (mirrors web badges array) ──────────────────────────────────

function buildBadges(stats: UserStats | undefined, reputationScore: number, isVerified: boolean): BadgeItem[] {
  const s = stats;
  return [
    // Verification & identity
    { id: "verified",           name: "Verified Neighbour",    icon: "✅", earned: isVerified,                                  earnedBg: "#ccfbf1", earnedFg: "#0f766e", description: "A confirmed member of the ShareSwap community.",                                                         requirement: "Complete identity verification — selfie + government ID." },
    { id: "early-member",       name: "Early Member",          icon: "👑", earned: s?.earlyMember || false,                     earnedBg: "#ede9fe", earnedFg: "#6d28d9", description: "You were here from the beginning — a founding member of the ShareSwap neighbourhood.",               requirement: "Joined during the ShareSwap beta period." },

    // First steps
    { id: "first-share",        name: "First Share",           icon: "🌱", earned: (s?.totalLent || 0) >= 1,                    earnedBg: "#dcfce7", earnedFg: "#15803d", description: "You opened your ShareChest and shared with a neighbour for the first time.",                          requirement: "Complete 1 item lending transaction." },
    { id: "first-borrow",       name: "First Borrow",          icon: "💙", earned: (s?.totalBorrowed || 0) >= 1,                earnedBg: "#e0f2fe", earnedFg: "#0369a1", description: "You experienced the joy of borrowing from your community.",                                             requirement: "Complete 1 borrow transaction." },
    { id: "first-swap",         name: "Swap Starter",          icon: "🔄", earned: (s?.totalSwaps || 0) >= 1,                   earnedBg: "#e0e7ff", earnedFg: "#4338ca", description: "You made your first trade — giving something to get something.",                                         requirement: "Complete 1 item swap." },
    { id: "generous",           name: "Generous Gifter",       icon: "🎁", earned: (s?.totalGifts || 0) >= 3,                   earnedBg: "#fce7f3", earnedFg: "#be185d", description: "You give freely and often — a true spirit of generosity.",                                              requirement: "Complete at least 3 gift transactions." },
    { id: "urgent",             name: "Urgent Helper",         icon: "⚡", earned: (s?.helpedUrgent || 0) >= 1,                 earnedBg: "#fef3c7", earnedFg: "#b45309", description: "You stepped up when a neighbour needed something urgently.",                                             requirement: "Fulfil at least 1 urgent wishlist request." },
    { id: "wish-maker",         name: "Wish Maker",            icon: "📖", earned: (s?.wishlistCount || 0) >= 3,                earnedBg: "#ffe4e6", earnedFg: "#be123c", description: "You know what you want — your wishlist is growing.",                                                     requirement: "Add 3 or more items to your wishlist." },

    // Growing activity
    { id: "active-borrower",    name: "Active Borrower",       icon: "🛍️", earned: (s?.totalBorrowed || 0) >= 5,                earnedBg: "#cffafe", earnedFg: "#0e7490", description: "You make the most of what your community has to offer.",                                               requirement: "Complete 5 borrow transactions." },
    { id: "swap-star",          name: "Swap Star",             icon: "🌠", earned: (s?.totalSwaps || 0) >= 5,                   earnedBg: "#e0e7ff", earnedFg: "#4338ca", description: "You've mastered the art of the swap — trading fairly and often.",                                      requirement: "Complete 5 item swaps." },
    { id: "generous-soul",      name: "Generous Soul",         icon: "🤝", earned: (s?.totalGifts || 0) >= 10,                  earnedBg: "#ffe4e6", earnedFg: "#be123c", description: "Your generosity is legendary — you give freely and often.",                                             requirement: "Complete 10 gift transactions." },
    { id: "sharechest-curator", name: "ShareChest Curator",    icon: "🔑", earned: (s?.itemsListed || 0) >= 5,                  earnedBg: "#ccfbf1", earnedFg: "#0f766e", description: "Your ShareChest is open for business — you've built a real lending library.",                          requirement: "List 5 or more items." },
    { id: "power-lister",       name: "Power Lister",          icon: "📦", earned: (s?.itemsListed || 0) >= 10,                 earnedBg: "#d1fae5", earnedFg: "#065f46", description: "Your ShareChest is stocked — 10 items ready for the neighbourhood.",                                   requirement: "List 10 or more items." },
    { id: "photo-pro",          name: "Photo Pro",             icon: "📷", earned: s?.photoPro || false,                         earnedBg: "#ede9fe", earnedFg: "#6d28d9", description: "You made a listing impossible to scroll past — perfect photos, real trust.",                           requirement: "List any item with 5 or more photos." },
    { id: "courier-rider",      name: "Courier Rider",         icon: "🚚", earned: (s?.courierDeliveries || 0) >= 1,             earnedBg: "#cffafe", earnedFg: "#0e7490", description: "You went the extra distance — used courier delivery for a transaction.",                                requirement: "Complete at least 1 transaction using courier delivery." },
    { id: "weekly-warrior",     name: "Weekly Warrior",        icon: "🔥", earned: (s?.weeklyActivity || 0) >= 3,               earnedBg: "#fee2e2", earnedFg: "#b91c1c", description: "You're on a sharing streak — active and engaged every week.",                                           requirement: "Complete 3 transactions in a single week." },
    { id: "community-builder",  name: "Community Builder",     icon: "👥", earned: (s?.referrals || 0) >= 1,                    earnedBg: "#dbeafe", earnedFg: "#1d4ed8", description: "You've started growing the ShareSwap community — your first referral is in.",                          requirement: "Refer 1 friend who completes their first transaction." },
    { id: "welcome-wagon",      name: "Welcome Wagon",         icon: "🎉", earned: s?.welcomeWagon || false,                     earnedBg: "#cffafe", earnedFg: "#0e7490", description: "You helped a new neighbour take their first step into the sharing economy.",                            requirement: "Complete a transaction with a user who joined in the last 30 days." },
    { id: "neighbour-connector",name: "Neighbour Connector",   icon: "🌟", earned: (s?.referrals || 0) >= 5,                    earnedBg: "#dbeafe", earnedFg: "#1d4ed8", description: "You're actively growing the ShareSwap community around you.",                                           requirement: "Refer 5 friends who each complete their first transaction." },

    // Lending & handoffs
    { id: "reliable",           name: "Reliable Borrower",     icon: "🤲", earned: (s?.successfulHandoffs || 0) >= 5,           earnedBg: "#dbeafe", earnedFg: "#1d4ed8", description: "You return items on time and treat neighbours' belongings with care.",                                  requirement: "Complete 5 successful item exchanges." },
    { id: "trusted-exchanger",  name: "Trusted Exchanger",     icon: "🛡️", earned: (s?.successfulHandoffs || 0) >= 10,          earnedBg: "#e0f2fe", earnedFg: "#0369a1", description: "Neighbours know they can trust you to follow through every time.",                                     requirement: "Complete 10 successful item exchanges." },
    { id: "super-lender",       name: "Super Lender",          icon: "📫", earned: (s?.totalLent || 0) >= 10,                   earnedBg: "#f3e8ff", earnedFg: "#7c3aed", description: "Your ShareChest is a community staple — neighbours borrow from you regularly.",                         requirement: "Lend out items in 10 completed transactions." },
    { id: "good-neighbour",     name: "Good Neighbour",        icon: "🏠", earned: s?.goodNeighbour || false,                    earnedBg: "#dcfce7", earnedFg: "#15803d", description: "One item, three different neighbours — your sharing efficiency is unmatched.",                          requirement: "Lend the same item to 3 different people." },
    { id: "rising-star",        name: "Rising Star",           icon: "📈", earned: (s?.successfulHandoffs || 0) >= 20,          earnedBg: "#ffedd5", earnedFg: "#c2410c", description: "You're on a roll — an exchange veteran that neighbours rely on.",                                        requirement: "Complete 20 successful item exchanges." },
    { id: "exchange-veteran",   name: "Exchange Veteran",      icon: "🏆", earned: (s?.successfulHandoffs || 0) >= 25,          earnedBg: "#fef3c7", earnedFg: "#92400e", description: "25 exchanges — you've built something most people only dream about.",                                    requirement: "Complete 25 successful item exchanges." },

    // Reviews
    { id: "community-voice",    name: "Community Voice",       icon: "💬", earned: (s?.reviewsLeft || 0) >= 5,                  earnedBg: "#ffedd5", earnedFg: "#c2410c", description: "Your feedback helps neighbours make great decisions.",                                                   requirement: "Leave 5 reviews for other members." },
    { id: "well-loved",         name: "Well Loved",            icon: "💜", earned: (s?.reviewsReceived || 0) >= 10,             earnedBg: "#f3e8ff", earnedFg: "#7c3aed", description: "A well-known and trusted face in the community.",                                                        requirement: "Receive 10 or more reviews." },

    // Performance & prestige
    { id: "fast-responder",     name: "Fast Responder",        icon: "⏱️", earned: s?.fastResponder || false,                   earnedBg: "#ecfccb", earnedFg: "#3f6212", description: "Neighbours know they can count on you to move quickly.",                                                requirement: "Complete 5 exchanges as a lender within 48 hours of the request." },
    { id: "five-star-neighbour",name: "Five-Star Neighbour",   icon: "⭐", earned: s?.fiveStarNeighbour || false,               earnedBg: "#fef9c3", earnedFg: "#713f12", description: "Your neighbours consistently rate their experience with you at the highest level.",                     requirement: "Receive 5+ reviews with an average rating of 4.8 stars or above." },
    { id: "neighbourhood-hero", name: "Neighbourhood Hero",    icon: "🥇", earned: reputationScore >= 300,                      earnedBg: "#fef3c7", earnedFg: "#92400e", description: "Your reputation speaks for itself — a pillar of the local sharing community.",                          requirement: "Reach a trust score of 300 or above." },
    { id: "coin-collector",     name: "Coin Collector",        icon: "🪙", earned: (s?.totalShareCoinsEarned || 0) >= 50,       earnedBg: "#fef3c7", earnedFg: "#b45309", description: "You've earned 50 ShareCoins through sharing.",                                                           requirement: "Earn 50 or more ShareCoins in total." },
    { id: "shareswap-legend",   name: "ShareSwap Legend",      icon: "💎", earned: reputationScore >= 500 && (s?.totalLent || 0) >= 20, earnedBg: "#fef3c7", earnedFg: "#92400e", description: "The rarest badge on the platform. You've built something extraordinary.",             requirement: "Reach a trust score of 500 and lend out 20+ items." },
    { id: "shareswap-ambassador",name: "ShareSwap Ambassador", icon: "🌐", earned: (s?.referrals || 0) >= 20,                  earnedBg: "#e0e7ff", earnedFg: "#4338ca", description: "You've brought 20 neighbours into the ShareSwap community — a true ambassador.",                       requirement: "Refer 20 friends who each complete their first transaction." },
  ];
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function TrustRing({ score, color }: { score: number; color: string }) {
  const size = 120;
  const stroke = 10;
  return (
    <View style={[styles.ringBg, { width: size, height: size, borderRadius: size / 2, borderWidth: stroke, borderColor: color + "25" }]}>
      <Text style={[styles.ringScore, { color }]}>{score}</Text>
      <Text style={[styles.ringLabel, { color: color + "99" }]}>/ 500</Text>
    </View>
  );
}

function BadgeTile({ badge, onPress }: { badge: BadgeItem; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.badgeTile,
        {
          backgroundColor: badge.earned ? badge.earnedBg : colors.muted,
          borderColor: badge.earned ? badge.earnedFg + "40" : colors.border,
          opacity: badge.earned ? (pressed ? 0.8 : 1) : 0.45,
        },
      ]}
    >
      <Text style={styles.badgeEmoji}>{badge.icon}</Text>
      <Text
        style={[styles.badgeTitle, { color: badge.earned ? badge.earnedFg : colors.mutedForeground }]}
        numberOfLines={2}
      >
        {badge.name}
      </Text>
    </Pressable>
  );
}

function StarRow({ rating }: { rating: number }) {
  return (
    <View style={{ flexDirection: "row", gap: 1 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Text key={i} style={{ fontSize: 11, color: i <= rating ? "#f59e0b" : "#e2e8f0" }}>★</Text>
      ))}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function AchievementsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const isWeb = Platform.OS === "web";
  const { from } = useLocalSearchParams<{ from?: string }>();

  // Trust score + level (kept for score/level data)
  const { data, isLoading } = useQuery<TrustData>({
    queryKey: ["/api/achievements"],
    queryFn: () => apiGet<TrustData>("/api/achievements"),
    enabled: !!user,
  });

  // User stats — used for client-side badge computation, mirrors web
  const { data: stats } = useQuery<UserStats>({
    queryKey: ["/api/user-stats"],
    queryFn: () => apiGet<UserStats>("/api/user-stats"),
    enabled: !!user,
  });

  // Reviews — "What Neighbours Say"
  const { data: reviews = [] } = useQuery<Review[]>({
    queryKey: [`/api/users/username/${user?.username}/reviews`],
    queryFn: () => apiGet<Review[]>(`/api/users/username/${user!.username}/reviews`),
    enabled: !!user?.username,
  });

  // ── Score animation (same ease-out cubic as web) ──────────────────────────
  const reputationScore = data?.score ?? 0;
  const fromScore = from ? parseInt(from, 10) : null;
  const [displayScore, setDisplayScore] = useState(fromScore ?? reputationScore);
  const animFrameRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (fromScore === null || isNaN(fromScore) || data === undefined) {
      setDisplayScore(reputationScore);
      return;
    }
    const start = fromScore;
    const end = reputationScore;
    const duration = 1400;
    const stepMs = 16;
    const steps = Math.ceil(duration / stepMs);
    let step = 0;
    const delay = setTimeout(() => {
      animFrameRef.current = setInterval(() => {
        step++;
        const eased = 1 - Math.pow(1 - step / steps, 3);
        setDisplayScore(Math.round(start + (end - start) * eased));
        if (step >= steps) {
          clearInterval(animFrameRef.current!);
          setDisplayScore(end);
        }
      }, stepMs);
    }, 300);
    return () => { clearTimeout(delay); if (animFrameRef.current) clearInterval(animFrameRef.current); };
  }, [data?.score]);

  // ── Level computation (matches web LEVELS array exactly) ─────────────────
  const currentLevelIndex = LEVELS.findIndex((level, index) => {
    const next = LEVELS[index + 1];
    return !next || reputationScore < next.minScore;
  });
  const currentLevel = LEVELS[Math.max(0, currentLevelIndex)];
  const nextLevel = LEVELS[currentLevelIndex + 1];
  const progressToNext = nextLevel
    ? Math.min(((reputationScore - currentLevel.minScore) / (nextLevel.minScore - currentLevel.minScore)) * 100, 100)
    : 100;

  const levelColor = LEVEL_COLORS[currentLevel.name] ?? colors.primary;

  // ── Trust score contextual message (mirrors web) ──────────────────────────
  const trustPct = Math.min(100, Math.round((reputationScore / 500) * 100));
  const trustMsg = trustPct >= 80 ? "You're a trusted neighbour!"
    : trustPct >= 50 ? "You're doing great!"
    : trustPct >= 25 ? "You're on your way!"
    : "You're new here!";
  const trustSub = trustPct >= 80 ? "Your neighbours trust you with their items."
    : trustPct >= 50 ? "Building a solid reputation."
    : trustPct >= 25 ? "Each exchange builds more trust."
    : "Start sharing to build your trust score.";

  // ── Badges — computed client-side from stats (matches web exactly) ────────
  const badges = buildBadges(stats, reputationScore, user?.isVerified ?? false);
  const earnedBadges = badges.filter((b) => b.earned);
  const unearnedBadges = badges.filter((b) => !b.earned);

  const handleBadgePress = (badge: BadgeItem) => {
    Alert.alert(
      `${badge.icon} ${badge.name}`,
      `${badge.description}\n\nHow to earn:\n${badge.requirement}`,
      [{ text: badge.earned ? "✓ Earned" : "Got it" }]
    );
  };

  if (!user) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Feather name="lock" size={40} color={colors.mutedForeground} />
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Sign in to view achievements</Text>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
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
        <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={10}>
          <Feather name="chevron-left" size={26} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Achievements</Text>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + (isWeb ? 34 : 0) + 90 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Trust Score Card ─────────────────────────────────────────────── */}
        <Pressable
          onPress={() => router.push("/score-history" as never)}
          accessibilityRole="button"
          accessibilityLabel="View score history"
          style={({ pressed }) => [
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <View style={styles.trustCardTop}>
            <TrustRing score={displayScore} color={levelColor} />
            <View style={styles.trustInfo}>
              <Text style={[styles.trustScoreLabel, { color: colors.mutedForeground }]}>Trust Score</Text>
              <Text style={[styles.trustMsg, { color: colors.foreground }]}>{trustMsg}</Text>
              <Text style={[styles.trustSub, { color: colors.mutedForeground }]}>{trustSub}</Text>
            </View>
            <Feather name="chevron-right" size={22} color={colors.mutedForeground} />
          </View>
        </Pressable>

        {/* ── Level Card ───────────────────────────────────────────────────── */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* Level name + badge */}
          <View style={styles.levelHeaderRow}>
            <View style={[styles.levelPill, { backgroundColor: levelColor + "20", borderColor: levelColor + "40" }]}>
              <Text style={styles.levelEmoji}>{LEVEL_EMOJIS[currentLevel.name] ?? "🌱"}</Text>
              <Text style={[styles.levelText, { color: levelColor }]}>{currentLevel.name}</Text>
            </View>
            <Text style={[styles.levelNum, { color: colors.mutedForeground }]}>Level {currentLevelIndex + 1}</Text>
            {user.isVerified && (
              <View style={styles.verifiedPill}>
                <Text style={styles.verifiedText}>✓ Verified</Text>
              </View>
            )}
          </View>

          {/* Perks */}
          <View style={styles.perksList}>
            {currentLevel.perks.map((perk, i) => (
              <View key={i} style={styles.perkRow}>
                <Text style={{ color: colors.primary, fontSize: 13 }}>✓</Text>
                <Text style={[styles.perkText, { color: colors.mutedForeground }]}>{perk}</Text>
              </View>
            ))}
          </View>

          {/* Progress to next level */}
          {nextLevel && (
            <View style={styles.progressContainer}>
              <View style={[styles.progressBg, { backgroundColor: colors.muted }]}>
                <View style={[styles.progressFill, { backgroundColor: levelColor, width: `${progressToNext}%` as any }]} />
              </View>
              <Text style={[styles.progressText, { color: colors.mutedForeground }]}>
                {reputationScore}/{nextLevel.minScore} — Next: {nextLevel.name}
              </Text>
            </View>
          )}

          {/* Mini earned badge icons */}
          {earnedBadges.length > 0 && (
            <View style={[styles.miniBadgeRow, { borderTopColor: colors.border }]}>
              {earnedBadges.map((b) => (
                <View key={b.id} style={[styles.miniBadge, { backgroundColor: b.earnedBg, borderColor: b.earnedFg + "40" }]}>
                  <Text style={{ fontSize: 12 }}>{b.icon}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* ── What Neighbours Say ──────────────────────────────────────────── */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionIcon}>💬</Text>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>What Neighbours Say</Text>
            {(stats?.reviewsLeft || 0) > 0 && (
              <View style={[styles.reviewsLeftPill, { backgroundColor: colors.muted }]}>
                <Text style={[styles.reviewsLeftText, { color: colors.mutedForeground }]}>
                  {stats!.reviewsLeft} review{stats!.reviewsLeft !== 1 ? "s" : ""} left for others
                </Text>
              </View>
            )}
          </View>
          {reviews.length > 0 ? (
            reviews.slice(0, 3).map((review) => (
              <View key={review.id} style={[styles.reviewCard, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                <View style={styles.reviewHeader}>
                  <View style={[styles.reviewAvatar, { backgroundColor: levelColor }]}>
                    <Text style={styles.reviewAvatarText}>
                      {(review.reviewer.displayName || review.reviewer.username).charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.reviewName, { color: colors.foreground }]}>
                      {review.reviewer.displayName || review.reviewer.handle || review.reviewer.username}
                    </Text>
                    <StarRow rating={review.rating} />
                  </View>
                </View>
                {review.comment ? (
                  <Text style={[styles.reviewComment, { color: colors.mutedForeground }]} numberOfLines={3}>
                    "{review.comment}"
                  </Text>
                ) : null}
              </View>
            ))
          ) : (
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              No reviews yet. Complete transactions to receive feedback from neighbours!
            </Text>
          )}
        </View>

        {/* ── Your Badges ─────────────────────────────────────────────────── */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionIcon}>⭐</Text>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Your Badges</Text>
            <Text style={[styles.badgeHint, { color: colors.mutedForeground }]}>Tap any badge to learn more</Text>
          </View>

          {earnedBadges.length > 0 && (
            <>
              <Text style={[styles.subSectionLabel, { color: colors.foreground }]}>
                Earned ({earnedBadges.length})
              </Text>
              <View style={styles.badgesGrid}>
                {earnedBadges.map((b) => (
                  <BadgeTile key={b.id} badge={b} onPress={() => handleBadgePress(b)} />
                ))}
              </View>
            </>
          )}

          {unearnedBadges.length > 0 && (
            <>
              <Text style={[styles.subSectionLabel, { color: colors.mutedForeground, marginTop: earnedBadges.length > 0 ? 12 : 0 }]}>
                Locked ({unearnedBadges.length})
              </Text>
              <View style={styles.badgesGrid}>
                {unearnedBadges.map((b) => (
                  <BadgeTile key={b.id} badge={b} onPress={() => handleBadgePress(b)} />
                ))}
              </View>
            </>
          )}
        </View>

        <Text style={[styles.footer, { color: colors.mutedForeground }]}>
          You're part of a growing community of sharers.
        </Text>
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
  headerTitle: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.3,
  },
  headerSpacer: { width: 30 },
  scroll: { padding: 16, gap: 14 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  badgeRow: { flexDirection: "row", justifyContent: "flex-end" },

  // Cards
  card: { borderRadius: 20, borderWidth: 1, padding: 16, gap: 12 },

  // Trust score
  trustCardTop: { flexDirection: "row", gap: 16, alignItems: "center" },
  ringBg: { alignItems: "center", justifyContent: "center" },
  ringScore: { fontSize: 28, fontFamily: "Inter_700Bold" },
  ringLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  trustInfo: { flex: 1, gap: 4 },
  trustScoreLabel: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5 },
  trustMsg: { fontSize: 14, fontFamily: "Inter_600SemiBold", lineHeight: 19 },
  trustSub: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },

  // Level card
  levelHeaderRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  levelPill: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 20, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  levelEmoji: { fontSize: 14 },
  levelText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  levelNum: { fontSize: 12, fontFamily: "Inter_400Regular" },
  verifiedPill: { marginLeft: "auto", backgroundColor: "#ccfbf1", borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 },
  verifiedText: { color: "#0f766e", fontSize: 11, fontFamily: "Inter_600SemiBold" },
  perksList: { gap: 4 },
  perkRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  perkText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  progressContainer: { gap: 5 },
  progressBg: { height: 6, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3 },
  progressText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  miniBadgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 4 },
  miniBadge: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1 },

  // Reviews
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  sectionIcon: { fontSize: 16 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  reviewsLeftPill: { marginLeft: "auto", borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 },
  reviewsLeftText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  reviewCard: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 8 },
  reviewHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  reviewAvatar: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  reviewAvatarText: { color: "#fff", fontSize: 13, fontFamily: "Inter_700Bold" },
  reviewName: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  reviewComment: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18, fontStyle: "italic" },

  // Badges
  badgeHint: { fontSize: 11, fontFamily: "Inter_400Regular", marginLeft: "auto" },
  subSectionLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  badgesGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  badgeTile: { width: "30%", borderRadius: 12, borderWidth: 1, padding: 10, alignItems: "center", gap: 4 },
  badgeEmoji: { fontSize: 22 },
  badgeTitle: { fontSize: 10, fontFamily: "Inter_500Medium", textAlign: "center", lineHeight: 13 },

  // Misc
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  footer: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 4 },
});
