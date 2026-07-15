import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
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

const SCREEN_W = Dimensions.get("window").width;
const CARD_W = SCREEN_W - 48;

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
}

interface ProfileItem {
  id: number;
  name: string;
  photos: string[];
  conditionRating: number;
  shareCoinPrice?: string | null;
  dollarsPrice?: string | null;
  isLendable?: boolean;
  isSwappable?: boolean;
  isRentable?: boolean;
  isGift?: boolean;
}

interface Review {
  id: number;
  rating: number;
  comment?: string | null;
  createdAt: string;
  reviewer: {
    id: number;
    username: string;
    displayName?: string | null;
    profilePhoto?: string | null;
    handle?: string | null;
    isVerified?: boolean;
    reputationLevel?: string | null;
  };
}

type Colors = ReturnType<typeof useColors>;

function memberSince(createdAt?: string): string {
  if (!createdAt) return "";
  return new Date(createdAt).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

function PaginationDots({
  count,
  active,
  colors,
}: {
  count: number;
  active: number;
  colors: Colors;
}) {
  return (
    <View style={dotStyles.row}>
      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          style={[
            dotStyles.dot,
            {
              backgroundColor: i === active ? colors.primary : colors.border,
              width: i === active ? 16 : 6,
            },
          ]}
        />
      ))}
    </View>
  );
}

const dotStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 5,
    marginTop: 10,
  },
  dot: { height: 6, borderRadius: 3 },
});

function ItemsCarousel({
  items,
  colors,
  router,
}: {
  items: ProfileItem[];
  colors: Colors;
  router: ReturnType<typeof useRouter>;
}) {
  const [activeIdx, setActiveIdx] = useState(0);

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const idx = Math.round(
      e.nativeEvent.contentOffset.x / (CARD_W + 12)
    );
    setActiveIdx(idx);
  }

  return (
    <>
      <FlatList
        data={items}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={CARD_W + 12}
        decelerationRate="fast"
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ gap: 12, paddingHorizontal: 16 }}
        style={{ marginHorizontal: -16 }}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => {
          const shareTypes: string[] = [];
          if (item.isLendable) shareTypes.push("Lend");
          if (item.isRentable) shareTypes.push("Rent");
          if (item.isSwappable) shareTypes.push("Swap");
          if (item.isGift) shareTypes.push("Gift");
          const photo = item.photos?.[0];

          return (
            <Pressable
              style={[
                styles.itemCard,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  width: CARD_W,
                },
              ]}
              onPress={() => router.push(`/item/${item.id}` as never)}
            >
              {photo ? (
                <Image
                  source={{ uri: photo }}
                  style={styles.itemPhoto}
                />
              ) : (
                <View
                  style={[
                    styles.itemPhoto,
                    {
                      backgroundColor: colors.accent,
                      alignItems: "center",
                      justifyContent: "center",
                    },
                  ]}
                >
                  <Feather
                    name="image"
                    size={32}
                    color={colors.mutedForeground}
                  />
                </View>
              )}
              <View style={styles.itemBody}>
                <Text
                  style={[styles.itemName, { color: colors.foreground }]}
                  numberOfLines={1}
                >
                  {item.name}
                </Text>
                <Text
                  style={[
                    styles.itemCondition,
                    { color: colors.mutedForeground },
                  ]}
                >
                  Condition: {item.conditionRating}/10
                </Text>
                <View style={styles.itemPricing}>
                  {item.shareCoinPrice ? (
                    <View style={styles.pricingChip}>
                      <Feather
                        name="codepen"
                        size={12}
                        color={colors.primary}
                      />
                      <Text
                        style={[
                          styles.pricingText,
                          { color: colors.foreground },
                        ]}
                      >
                        {Number(item.shareCoinPrice).toFixed(0)} ShareCoins
                      </Text>
                    </View>
                  ) : null}
                  {item.shareCoinPrice && item.dollarsPrice ? (
                    <Text
                      style={[
                        styles.pricingSep,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      |
                    </Text>
                  ) : null}
                  {item.dollarsPrice ? (
                    <View style={styles.pricingChip}>
                      <Feather
                        name="dollar-sign"
                        size={12}
                        color={colors.mutedForeground}
                      />
                      <Text
                        style={[
                          styles.pricingText,
                          { color: colors.foreground },
                        ]}
                      >
                        ${Number(item.dollarsPrice).toFixed(0)}/wk
                      </Text>
                    </View>
                  ) : null}
                </View>
                {shareTypes.length > 0 ? (
                  <View style={styles.itemActions}>
                    {shareTypes.map((t) => (
                      <Pressable
                        key={t}
                        style={[
                          styles.actionBtn,
                          { backgroundColor: colors.primary },
                        ]}
                        onPress={() => router.push(`/item/${item.id}` as never)}
                      >
                        <Feather
                          name={
                            t === "Lend"
                              ? "clock"
                              : t === "Rent"
                              ? "dollar-sign"
                              : t === "Swap"
                              ? "repeat"
                              : "gift"
                          }
                          size={13}
                          color="#fff"
                        />
                        <Text style={styles.actionBtnText}>{t}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            </Pressable>
          );
        }}
      />
      {items.length > 1 ? (
        <PaginationDots count={items.length} active={activeIdx} colors={colors} />
      ) : null}
    </>
  );
}

function ReviewsCarousel({
  reviews,
  totalCount,
  colors,
}: {
  reviews: Review[];
  totalCount: number;
  colors: Colors;
}) {
  const [activeIdx, setActiveIdx] = useState(0);

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const idx = Math.round(
      e.nativeEvent.contentOffset.x / (CARD_W + 12)
    );
    setActiveIdx(idx);
  }

  return (
    <>
      <FlatList
        data={reviews}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={CARD_W + 12}
        decelerationRate="fast"
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ gap: 12, paddingHorizontal: 16 }}
        style={{ marginHorizontal: -16 }}
        keyExtractor={(r) => String(r.id)}
        renderItem={({ item: review }) => {
          const reviewerName =
            review.reviewer.displayName ?? review.reviewer.username;
          const initial = reviewerName.charAt(0).toUpperCase();
          return (
            <View
              style={[
                styles.reviewCard,
                {
                  backgroundColor: colors.accent,
                  borderColor: colors.border,
                  width: CARD_W,
                },
              ]}
            >
              <View style={styles.reviewerRow}>
                {review.reviewer.profilePhoto ? (
                  <Image
                    source={{ uri: review.reviewer.profilePhoto }}
                    style={styles.reviewerAvatar}
                  />
                ) : (
                  <View
                    style={[
                      styles.reviewerAvatar,
                      {
                        backgroundColor: colors.primary,
                        alignItems: "center",
                        justifyContent: "center",
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color: "#fff",
                        fontSize: 15,
                        fontFamily: "Inter_700Bold",
                      }}
                    >
                      {initial}
                    </Text>
                  </View>
                )}
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={styles.reviewerNameRow}>
                    <Text
                      style={[
                        styles.reviewerName,
                        { color: colors.primary },
                      ]}
                      numberOfLines={1}
                    >
                      {reviewerName}
                    </Text>
                    {review.reviewer.isVerified ? (
                      <View
                        style={[
                          styles.verifiedDot,
                          { backgroundColor: colors.primary },
                        ]}
                      >
                        <Feather name="check" size={7} color="#fff" />
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.reviewStarsRow}>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Feather
                        key={i}
                        name="star"
                        size={11}
                        color={i < review.rating ? "#f59e0b" : colors.border}
                      />
                    ))}
                    <Text
                      style={[
                        styles.reviewMeta,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      {Number(review.rating).toFixed(1)} · {totalCount} transactions
                    </Text>
                  </View>
                </View>
              </View>
              {review.comment ? (
                <Text
                  style={[styles.reviewQuote, { color: colors.foreground }]}
                  numberOfLines={3}
                >
                  "{review.comment}"
                </Text>
              ) : null}
              <Text style={[styles.viewAllLink, { color: colors.primary }]}>
                ∨ View all {totalCount} reviews
              </Text>
            </View>
          );
        }}
      />
      {reviews.length > 1 ? (
        <PaginationDots count={reviews.length} active={activeIdx} colors={colors} />
      ) : null}
    </>
  );
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

  const { data: items = [] } = useQuery<ProfileItem[]>({
    queryKey: [`/api/users/username/${profile?.username}/items`],
    queryFn: () =>
      apiGet<ProfileItem[]>(
        `/api/users/username/${profile!.username}/items`
      ),
    enabled: !!profile?.username,
  });

  const { data: reviews = [] } = useQuery<Review[]>({
    queryKey: [`/api/users/username/${profile?.username}/reviews`],
    queryFn: () =>
      apiGet<Review[]>(
        `/api/users/username/${profile!.username}/reviews`
      ),
    enabled: !!profile?.username,
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
  const handle = profile.handle ?? profile.username;
  const activeStatus = profile.activeStatus;
  const hasIssues = (profile.issuesCount ?? 0) > 0;
  const memberSinceStr = memberSince(profile.createdAt);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: insets.bottom + (isWeb ? 34 : 0) + 24,
          gap: 24,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header card */}
        <View style={[styles.headerCard, { backgroundColor: colors.accent }]}>
          <View style={styles.avatarRow}>
            <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
              {profile.profilePhoto ? (
                <Image
                  source={{ uri: profile.profilePhoto }}
                  style={styles.avatarImg}
                />
              ) : (
                <Text style={styles.avatarInitial}>
                  {displayName.charAt(0).toUpperCase()}
                </Text>
              )}
            </View>
            <View style={styles.nameBlock}>
              <View style={styles.nameRow}>
                <Text
                  style={[styles.displayName, { color: colors.foreground }]}
                  numberOfLines={1}
                >
                  {displayName}
                </Text>
                {profile.isVerified ? (
                  <View
                    style={[
                      styles.verifiedDot,
                      { backgroundColor: colors.primary },
                    ]}
                  >
                    <Feather name="check" size={9} color="#fff" />
                  </View>
                ) : null}
              </View>
              <Text style={[styles.handle, { color: colors.mutedForeground }]}>
                @{handle}
              </Text>
              {activeStatus ? (
                <Text
                  style={[
                    styles.activeText,
                    {
                      color: activeStatus.isNow
                        ? "#16a34a"
                        : colors.mutedForeground,
                    },
                  ]}
                >
                  {activeStatus.label}
                </Text>
              ) : null}
            </View>
          </View>

          {/* Stats */}
          <View
            style={[
              styles.statsRow,
              { borderTopColor: colors.border + "60" },
            ]}
          >
            <View style={styles.statCol}>
              <View style={styles.statInner}>
                <Feather name="star" size={16} color="#f59e0b" />
                <Text style={[styles.statVal, { color: colors.foreground }]}>
                  {profile.averageRating != null
                    ? Number(profile.averageRating).toFixed(1)
                    : "—"}
                </Text>
              </View>
              <Text style={[styles.statSub, { color: colors.mutedForeground }]}>
                ({profile.reviewCount ?? 0} reviews)
              </Text>
            </View>
            <View
              style={[
                styles.statDivider,
                { backgroundColor: colors.border },
              ]}
            />
            <View style={styles.statCol}>
              <View style={styles.statInner}>
                <Feather name="package" size={16} color={colors.primary} />
                <Text style={[styles.statVal, { color: colors.foreground }]}>
                  {profile.completedShares ?? 0}
                </Text>
              </View>
              <Text style={[styles.statSub, { color: colors.mutedForeground }]}>
                completed shares
              </Text>
            </View>
          </View>

          {/* Info rows */}
          <View style={styles.infoRows}>
            <View style={styles.infoRow}>
              <Feather
                name="alert-triangle"
                size={13}
                color={hasIssues ? "#ef4444" : "#16a34a"}
              />
              <Text
                style={[
                  styles.infoText,
                  { color: hasIssues ? "#ef4444" : "#16a34a" },
                ]}
              >
                {hasIssues
                  ? `${profile.issuesCount} issue${profile.issuesCount! > 1 ? "s" : ""} reported`
                  : "No issues reported"}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Feather name="shield" size={13} color={colors.primary} />
              <Text
                style={[styles.infoText, { color: colors.mutedForeground }]}
              >
                Trust Score: {profile.trustScore ?? profile.reputationScore ?? 0}
              </Text>
            </View>
            {memberSinceStr ? (
              <View style={styles.infoRow}>
                <Feather
                  name="calendar"
                  size={13}
                  color={colors.mutedForeground}
                />
                <Text
                  style={[styles.infoText, { color: colors.mutedForeground }]}
                >
                  Member since {memberSinceStr}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Shared Items */}
        <View>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Shared Items
          </Text>
          {items.length > 0 ? (
            <ItemsCarousel items={items} colors={colors} router={router} />
          ) : (
            <View
              style={[
                styles.emptyBox,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
            >
              <Feather name="package" size={28} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                No items shared yet
              </Text>
            </View>
          )}
        </View>

        {/* Reviews */}
        <View>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Reviews
          </Text>
          {reviews.length > 0 ? (
            <ReviewsCarousel
              reviews={reviews}
              totalCount={profile.reviewCount ?? reviews.length}
              colors={colors}
            />
          ) : (
            <View
              style={[
                styles.emptyBox,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
            >
              <Feather
                name="message-square"
                size={28}
                color={colors.mutedForeground}
              />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                No reviews yet
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },

  headerCard: { borderRadius: 20, padding: 18, gap: 16 },

  avatarRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImg: { width: 72, height: 72, borderRadius: 36 },
  avatarInitial: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    color: "#fff",
  },
  nameBlock: { flex: 1, gap: 3 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  displayName: { fontSize: 20, fontFamily: "Inter_700Bold", flexShrink: 1 },
  verifiedDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  handle: { fontSize: 13, fontFamily: "Inter_400Regular" },
  activeText: { fontSize: 12, fontFamily: "Inter_400Regular" },

  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    paddingTop: 14,
  },
  statCol: { flex: 1, alignItems: "center", gap: 3 },
  statInner: { flexDirection: "row", alignItems: "center", gap: 5 },
  statVal: { fontSize: 18, fontFamily: "Inter_700Bold" },
  statSub: { fontSize: 11, fontFamily: "Inter_400Regular" },
  statDivider: { width: 1, height: 36, marginHorizontal: 8 },

  infoRows: { gap: 8 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  infoText: { fontSize: 13, fontFamily: "Inter_400Regular" },

  sectionTitle: { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 12 },

  itemCard: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  itemPhoto: { width: "100%", height: 180 },
  itemBody: { padding: 12, gap: 6 },
  itemName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  itemCondition: { fontSize: 12, fontFamily: "Inter_400Regular" },
  itemPricing: { flexDirection: "row", alignItems: "center", gap: 6 },
  pricingChip: { flexDirection: "row", alignItems: "center", gap: 3 },
  pricingText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  pricingSep: { fontSize: 12 },
  itemActions: { flexDirection: "row", gap: 8, marginTop: 4, flexWrap: "wrap" },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 20,
  },
  actionBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },

  reviewCard: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 10 },
  reviewerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  reviewerAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    overflow: "hidden",
  },
  reviewerNameRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  reviewerName: { fontSize: 14, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
  reviewStarsRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  reviewMeta: { fontSize: 11, fontFamily: "Inter_400Regular", marginLeft: 4 },
  reviewQuote: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
    fontStyle: "italic",
  },
  viewAllLink: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  emptyBox: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 28,
    borderRadius: 16,
    borderWidth: 1,
  },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
