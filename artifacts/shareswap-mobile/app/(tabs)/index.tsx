import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { HandHeart, ArrowLeftRight, Coins } from "lucide-react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useState, useRef, useEffect } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { apiGet, apiPost, photoUrl } from "@/lib/api";

const rentalRateIcon = require("../../assets/icons/rental-rate.png");

const SCREEN_W = Dimensions.get("window").width;
const GRID_GAP = 10;
const GRID_PAD = 16;
const SUGGEST_CARD_W = SCREEN_W - GRID_PAD * 2;
const SUGGEST_IMG_H = Math.round(SUGGEST_CARD_W * 0.68);

// ─── Types ────────────────────────────────────────────────────────────────────

interface BrowseItem {
  id: number;
  name?: string;
  title?: string;
  photos?: string[] | null;
  imageUrl?: string | null;
  shareType?: string;
  conditionRating?: number | null;
  shareCoinsReward?: number | null;
  shareCoinPrice?: number | null;
  pricePerDay?: number | null;
  dollarsPrice?: string | number | null;
  city?: string | null;
  postalCode?: string | null;
  isGift?: boolean;
  isLendable?: boolean;
  isRentable?: boolean;
  isSwappable?: boolean;
  owner?: {
    id: number;
    username: string;
    displayName?: string | null;
    isVerified: boolean;
  };
  recommendationReasons?: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function iname(item: BrowseItem) {
  return item.name || item.title || "Item";
}
function iphoto(item: BrowseItem): string | undefined {
  const raw = (item.photos && item.photos.length > 0)
    ? item.photos[0]
    : item.imageUrl ?? null;
  return photoUrl(raw);
}
function coins(item: BrowseItem) {
  return Math.round(Number(item.shareCoinPrice || item.shareCoinsReward || 0));
}

const ITEM_CATEGORIES = [
  "Baby & Kids",
  "Clothing & Accessories",
  "Electronics",
  "Hobbies & Collectibles",
  "Home & Kitchen",
  "Tools & Equipment",
] as const;

function inferCategory(itemName: string): string {
  const name = itemName.toLowerCase();
  if (
    /baby|bassinet|stroller|crib|diaper|toddler|kid|child|toy|pacifier|bottle|carrier|pram|playpen|highchair|bouncer|nursery|onesie|sleepsuit|nappy/i.test(
      name,
    )
  ) {
    return "Baby & Kids";
  }
  if (
    /clothing|dress|shirt|pants|jacket|coat|shoes|boots|hat|scarf|bag|purse|accessory|jewelry|watch|crewneck|sweater|hoodie|tee|jeans|denim|leggings|bikini|swimsuit|skirt|blouse|cardigan|vest|beanie|sneaker|sandal|bra|top|bottom|romper|jumpsuit|suit|blazer|tie|socks|gloves|mittens|belt|sunglasses|glasses|cap|toque|parka|fleece|polo|shorts|tracksuit|activewear|sportswear|yoga|gym|alo|lululemon|nike|adidas/i.test(
      name,
    )
  ) {
    return "Clothing & Accessories";
  }
  if (
    /phone|tablet|laptop|computer|camera|tv|television|speaker|headphone|charger|electronic|gaming|console|monitor|keyboard|mouse|printer|projector|drone|smartwatch|earbuds|airpods|gopro|playstation|xbox|nintendo|ipad|iphone|android|router|modem/i.test(
      name,
    )
  ) {
    return "Electronics";
  }
  if (
    /camping|tent|bike|bicycle|golf|sports|game|book|guitar|instrument|hobby|collect|fishing|kayak|ski|snowboard|surfboard|skateboard|scooter|rollerblade|yoga mat|dumbbell|weight|exercise|fitness|treadmill|elliptical|rowing|badminton|tennis|racket|hockey|football|soccer|baseball|basketball|volleyball|frisbee|puzzle|board game|lego|craft|sewing|knitting/i.test(
      name,
    )
  ) {
    return "Hobbies & Collectibles";
  }
  if (
    /kitchen|blender|mixer|pot|pan|plate|utensil|furniture|chair|table|lamp|decor|vacuum|appliance|oven|microwave|fridge|toaster|coffee|couch|sofa|mattress|bed|shelf|bookcase|wardrobe|dresser|curtain|rug|pillow|duvet|towel|fan|heater|air purifier|humidifier|dehumidifier|instant pot|air fryer|waffle|rice cooker|slow cooker|juicer|kettle|dishware|cutlery/i.test(
      name,
    )
  ) {
    return "Home & Kitchen";
  }
  if (
    /drill|saw|hammer|tool|wrench|screwdriver|mower|lawn|garden|ladder|equipment|pressure washer|generator|chainsaw|sander|grinder|level|measuring|tape measure|shovel|rake|hoe|wheelbarrow|hose|sprinkler|hedge trimmer|leaf blower|snow blower/i.test(
      name,
    )
  ) {
    return "Tools & Equipment";
  }
  return "Home & Kitchen";
}

// ─── Action buttons ────────────────────────────────────────────────────────

type IconFamily = "feather" | "mci" | "lucide-hand-heart" | "lucide-arrow-lr";
interface ActionBtn { label: string; icon: string; family: IconFamily; bg: string }

function makeBtn(label: string, icon: string, family: IconFamily, bg: string): ActionBtn {
  return { label, icon, family, bg };
}

function getActionBtns(item: BrowseItem, primary: string): ActionBtn[] {
  const btns: ActionBtn[] = [];
  if (item.isGift)     btns.push(makeBtn("Claim Gift", "gift",            "feather",           "#ec4899"));
  if (item.isLendable) btns.push(makeBtn("Borrow It",  "",                "lucide-hand-heart", primary));
  if (item.isRentable) btns.push(makeBtn("Rent It",    "dollar-sign",     "feather",           primary));
  if (item.isSwappable)btns.push(makeBtn("Swap It",    "",                "lucide-arrow-lr",   primary));
  if (btns.length > 0) return btns;
  const st = (item.shareType || "borrow").toLowerCase();
  if (st === "gift")  return [makeBtn("Claim Gift", "gift",            "feather",           "#ec4899")];
  if (st === "rent")  return [makeBtn("Rent It",    "dollar-sign",     "feather",           primary)];
  if (st === "swap")  return [makeBtn("Swap It",    "",                "lucide-arrow-lr",   primary)];
  return                     [makeBtn("Borrow It",  "",                "lucide-hand-heart", primary)];
}

function ActionButtons({ item, colors, router }: { item: BrowseItem; colors: any; router: any }) {
  const btns = getActionBtns(item, colors.primary);
  return (
    <View style={ab.row}>
      {btns.map((btn) => (
        <Pressable
          key={btn.label}
          style={[ab.btn, { backgroundColor: btn.bg }]}
          onPress={() => router.push(`/item/${item.id}` as never)}
        >
          {btn.family === "lucide-hand-heart"
            ? <HandHeart size={13} color="#fff" strokeWidth={2} />
            : btn.family === "lucide-arrow-lr"
            ? <ArrowLeftRight size={13} color="#fff" strokeWidth={2} />
            : btn.family === "mci"
            ? <MaterialCommunityIcons name={btn.icon as any} size={13} color="#fff" />
            : <Feather name={btn.icon as any} size={12} color="#fff" />}
          <Text style={ab.label}>{btn.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
const ab = StyleSheet.create({
  row: { flexDirection: "row", gap: 5, marginTop: 8 },
  btn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 20, flexShrink: 1 },
  label: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#fff", flexShrink: 1 },
});

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({
  emoji,
  icon,
  label,
  count,
  accentBg,
  accentText,
  sparkle,
  line,
}: {
  emoji: string;
  icon?: React.ReactNode;
  label: string;
  count?: number;
  accentBg: string;
  accentText: string;
  sparkle?: boolean;
  line?: boolean;
}) {
  return (
    <View style={sh.row}>
      <View style={[sh.icon, { backgroundColor: accentBg }]}>
        {icon ? icon : <Text style={sh.emoji}>{sparkle ? "✦" : emoji}</Text>}
      </View>
      <Text style={sh.label}>{label}</Text>
      {count != null && (
        <View style={[sh.badge, { backgroundColor: accentBg }]}>
          <Text style={[sh.badgeText, { color: accentText }]}>
            {count} available
          </Text>
        </View>
      )}
      {line && <View style={sh.line} />}
    </View>
  );
}
const sh = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  icon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  emoji: { fontSize: 16 },
  label: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#1f2937" },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  line: { flex: 1, height: 1.5, backgroundColor: "#e5e7eb" },
});

// ─── Suggested card (full-width carousel) ─────────────────────────────────

function SuggestedCard({ item, colors, router }: { item: BrowseItem; colors: any; router: any }) {
  const photo = iphoto(item);
  const c = coins(item);
  const isAiPick = item.recommendationReasons && item.recommendationReasons.length > 0;
  const weeklyPrice =
    item.dollarsPrice && Number(item.dollarsPrice) > 0
      ? `${Number(item.dollarsPrice).toFixed(0)}/wk`
      : item.pricePerDay && Number(item.pricePerDay) > 0
      ? `${(Number(item.pricePerDay) * 7).toFixed(0)}/wk`
      : null;
  return (
    <Pressable
      style={[scard.wrap, { backgroundColor: colors.card, width: SUGGEST_CARD_W }]}
      onPress={() => router.push(`/item/${item.id}` as never)}
    >
      <View style={scard.imgWrap}>
        {photo ? (
          <Image source={{ uri: photo }} style={scard.img} resizeMode="cover" />
        ) : (
          <View style={[scard.imgPlaceholder, { backgroundColor: colors.muted }]}>
            <Feather name="package" size={40} color={colors.mutedForeground} />
          </View>
        )}
        {isAiPick && (
          <View style={scard.aiPick}>
            <Text style={scard.aiPickText}>✦ AI Pick</Text>
          </View>
        )}
      </View>
      <View style={scard.body}>
        <Text style={[scard.title, { color: colors.foreground }]} numberOfLines={1}>
          {iname(item)}
        </Text>
        <View style={scard.row}>
          <Feather name="map-pin" size={12} color={colors.mutedForeground} />
          <Text style={[scard.meta, { color: colors.mutedForeground }]}>
            {item.city || "Nearby"}
          </Text>
        </View>
        <Text style={[scard.meta, { color: colors.mutedForeground }]}>
          Condition: {item.conditionRating ?? 10}/10
        </Text>
        <View style={scard.coinsRow}>
          <Coins size={13} color="#0DCEA1" strokeWidth={2} />
          <Text style={[scard.coins, { color: colors.foreground }]}>
            {c > 0 ? `${c} ShareCoins` : "0 ShareCoins"}
          </Text>
          {weeklyPrice ? (
            <>
              <Text style={[scard.coinsSep, { color: colors.mutedForeground }]}>{"  |  "}</Text>
              <Image source={rentalRateIcon} style={scard.rateIcon} resizeMode="contain" />
              <Text style={[scard.coinsRate, { color: colors.mutedForeground }]}>{weeklyPrice}</Text>
            </>
          ) : null}
        </View>
        <ActionButtons item={item} colors={colors} router={router} />
      </View>
    </Pressable>
  );
}
const scard = StyleSheet.create({
  wrap: {
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  imgWrap: { position: "relative" },
  img: { width: SUGGEST_CARD_W, height: SUGGEST_IMG_H },
  imgPlaceholder: { width: SUGGEST_CARD_W, height: SUGGEST_IMG_H, alignItems: "center", justifyContent: "center" },
  aiPick: {
    position: "absolute",
    top: 10,
    right: 10,
    backgroundColor: "#0DCEA1",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  aiPickText: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff" },
  body: { padding: 14, gap: 4 },
  title: { fontSize: 16, fontFamily: "Inter_700Bold", lineHeight: 22 },
  row: { flexDirection: "row", alignItems: "center", gap: 4 },
  coinsRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  coinsSep: { fontSize: 13, fontFamily: "Inter_400Regular" },
  rateIcon: { width: 9, height: 13 },
  coinsRate: { fontSize: 13, fontFamily: "Inter_400Regular" },
  meta: { fontSize: 13, fontFamily: "Inter_400Regular" },
  coins: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});

// ─── Category carousel (All Items, grouped) ────────────────────────────────

function CategoryCarousel({ items, colors, router }: { items: BrowseItem[]; colors: any; router: any }) {
  const [index, setIndex] = useState(0);
  return (
    <View>
      <FlatList
        data={items}
        horizontal
        snapToInterval={SUGGEST_CARD_W}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <SuggestedCard item={item} colors={colors} router={router} />
        )}
        onMomentumScrollEnd={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / SUGGEST_CARD_W);
          setIndex(idx);
        }}
        scrollEnabled={items.length > 1}
      />
      {items.length > 1 && (
        <View style={styles.dotsRow}>
          {items.slice(0, 8).map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  backgroundColor: i === index ? colors.primary : "#d1d5db",
                  width: i === index ? 18 : 7,
                },
              ]}
            />
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Gift card (carousel) ──────────────────────────────────────────────────

function GiftCard({ item, colors, router }: { item: BrowseItem; colors: any; router: any }) {
  const photo = iphoto(item);
  return (
    <Pressable
      style={[gcard.wrap, { backgroundColor: colors.card, borderColor: "#fce7f3" }]}
      onPress={() => router.push(`/item/${item.id}` as never)}
    >
      <View style={gcard.imgWrap}>
        {photo ? (
          <Image source={{ uri: photo }} style={gcard.img} resizeMode="cover" />
        ) : (
          <View style={[gcard.imgPlaceholder, { backgroundColor: "#fce7f3" }]}>
            <Text style={{ fontSize: 40 }}>🎁</Text>
          </View>
        )}
        <View style={gcard.freeBadge}>
          <Text style={gcard.freeBadgeText}>FREE</Text>
        </View>
      </View>
      <View style={gcard.body}>
        <Text style={[gcard.title, { color: "#1f2937" }]} numberOfLines={1}>
          {iname(item)}
        </Text>
        <View style={gcard.row}>
          <Feather name="map-pin" size={11} color="#6b7280" />
          <Text style={gcard.meta}>{item.city || "Nearby"}</Text>
        </View>
        <View style={gcard.row}>
          <Text style={gcard.meta}>
            <Text style={{ fontFamily: "Inter_600SemiBold" }}>Condition:</Text>{" "}
            {item.conditionRating ?? 8}/10
          </Text>
          {item.owner?.isVerified && (
            <View style={gcard.verifiedPill}>
              <Text style={gcard.verifiedText}>Verified Owner</Text>
            </View>
          )}
        </View>
        <Pressable
          style={gcard.btn}
          onPress={() => router.push(`/item/${item.id}` as never)}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Feather name="gift" size={13} color="#fff" />
            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" }}>
              Claim Gift
            </Text>
          </View>
        </Pressable>
      </View>
    </Pressable>
  );
}
const gcard = StyleSheet.create({
  wrap: { borderRadius: 14, borderWidth: 1.5, overflow: "hidden" },
  imgWrap: { position: "relative" },
  img: { width: "100%", height: 180 },
  imgPlaceholder: { width: "100%", height: 180, alignItems: "center", justifyContent: "center" },
  freeBadge: { position: "absolute", top: 8, right: 8, backgroundColor: "#ec4899", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  freeBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff" },
  body: { padding: 12, gap: 5 },
  title: { fontSize: 15, fontFamily: "Inter_700Bold" },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#374151" },
  verifiedPill: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#0DCEA130", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  verifiedText: { fontSize: 9, color: "#0DCEA1", fontFamily: "Inter_600SemiBold" },
  btn: { backgroundColor: "#ec4899", borderRadius: 8, paddingVertical: 8, alignItems: "center", marginTop: 4 },
});

// ─── Main screen ───────────────────────────────────────────────────────────

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const router = useRouter();
  const isWeb = Platform.OS === "web";

  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [suggestedIndex, setSuggestedIndex] = useState(0);
  const suggestedRef = useRef<FlatList>(null);
  const [locationModal, setLocationModal] = useState(false);
  const [locationCity, setLocationCity] = useState("");
  const [locationRadius, setLocationRadius] = useState(25);
  const [detectLoading, setDetectLoading] = useState(false);
  const queryClient = useQueryClient();

  // Seed from saved user profile on login
  useEffect(() => {
    if (user?.defaultCity) setLocationCity(user.defaultCity);
    if (user?.locationRadius) setLocationRadius(user.locationRadius);
  }, [user?.defaultCity, user?.locationRadius]);

  async function detectLocation() {
    setDetectLoading(true);
    try {
      const geo = await apiGet<{ city: string; postalCode: string }>("/api/geo/detect");
      if (geo.city) setLocationCity(geo.city);
    } catch {}
    setDetectLoading(false);
  }

  const saveLocationMutation = useMutation({
    mutationFn: () =>
      apiPost("/api/user/location", { city: locationCity, postalCode: locationCity, radius: locationRadius }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recommendations"] });
      setLocationModal(false);
    },
  });

  const topPad = isWeb ? 67 : insets.top;

  // All items
  const { data: allItems = [], isLoading: loadingAll, refetch: refetchAll } = useQuery<BrowseItem[]>({
    queryKey: ["/api/items"],
    queryFn: () => apiGet<BrowseItem[]>("/api/items"),
  });

  // Gift items
  const { data: giftItems = [], refetch: refetchGifts } = useQuery<BrowseItem[]>({
    queryKey: ["/api/items", "gift"],
    queryFn: () => apiGet<BrowseItem[]>("/api/items?type=gift"),
  });

  // Recommended items (falls back gracefully)
  const { data: recommended = [], refetch: refetchRec } = useQuery<BrowseItem[]>({
    queryKey: ["/api/recommendations"],
    queryFn: () => apiGet<BrowseItem[]>("/api/recommendations?limit=10"),
    enabled: !!user,
  });

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([refetchAll(), refetchGifts(), refetchRec()]);
    setRefreshing(false);
  }

  // Filter by search
  const filtered = search.trim()
    ? allItems.filter((i) =>
        iname(i).toLowerCase().includes(search.toLowerCase()),
      )
    : allItems;

  const isGiftItem = (i: BrowseItem) => !!(i.isGift || (i.shareType || "").toLowerCase() === "gift");

  // Dedupe gifts (already in allItems sometimes)
  const giftList = giftItems.length
    ? giftItems
    : allItems.filter(isGiftItem);

  // Suggested = recommendations or first 10 non-gift items
  const suggestedList = recommended.length
    ? recommended
    : allItems.filter((i) => !isGiftItem(i)).slice(0, 10);

  // Group by category
  const nonGiftItems = filtered.filter((i) => !isGiftItem(i));
  const categoryGroups: [string, BrowseItem[]][] = ITEM_CATEGORIES.map(
    (cat): [string, BrowseItem[]] => [
      cat,
      nonGiftItems.filter((i) => inferCategory(iname(i)) === cat),
    ]
  ).filter(([, items]) => items.length > 0);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* ── Sticky header ── */}
      <View style={[styles.header, { paddingTop: topPad + 4, backgroundColor: colors.primary }]}>
        <View style={styles.headerTitleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle} numberOfLines={2}>Browse the community ShareChest</Text>
            <Text style={styles.headerSub} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
              A curated collection of items available near you
            </Text>
          </View>
          {user && (
            <Pressable
              onPress={() => router.push("/wallet" as never)}
              style={styles.walletCard}
            >
              <Text style={styles.walletLabel}>Total Balance</Text>
              <View style={styles.walletRow}>
                <Coins size={16} color="#0DCEA1" strokeWidth={2} />
                <Text style={styles.walletAmount}>
                  {Math.round(Number(user.shareCoins ?? 0))} ShareCoins
                </Text>
              </View>
            </Pressable>
          )}
        </View>

        {/* Search bar */}
        <View style={[styles.searchBar, { backgroundColor: "#fff" }]}>
          <Feather name="search" size={13} color="#9ca3af" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search items..."
            placeholderTextColor="#9ca3af"
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")} hitSlop={6}>
              <Feather name="x" size={13} color="#9ca3af" />
            </Pressable>
          )}
        </View>

        {/* Location pill */}
        <Pressable style={[styles.locationPill, { backgroundColor: "#fff" }]} onPress={() => setLocationModal(true)}>
          <Feather name="map-pin" size={12} color="#374151" />
          <Text style={styles.locationText}>
            {locationCity || "Nearby"} ({locationRadius}km radius)
          </Text>
          <Feather name="chevron-down" size={11} color="#9ca3af" />
        </Pressable>
      </View>

      {/* ── Scrollable body ── */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.body,
          { paddingBottom: insets.bottom + 90 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* ── Suggested for You ── */}
        {!search && suggestedList.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              emoji=""
              sparkle
              line
              label="Suggested for You"
              accentBg="#0DCEA120"
              accentText="#065f46"
            />
            <FlatList
              ref={suggestedRef}
              data={suggestedList}
              horizontal
              pagingEnabled={false}
              snapToInterval={SUGGEST_CARD_W}
              decelerationRate="fast"
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item) => String(item.id)}
              renderItem={({ item }) => (
                <SuggestedCard item={item} colors={colors} router={router} />
              )}
              onMomentumScrollEnd={(e) => {
                const idx = Math.round(
                  e.nativeEvent.contentOffset.x / SUGGEST_CARD_W
                );
                setSuggestedIndex(idx);
              }}
              scrollEnabled={suggestedList.length > 1}
            />
            {suggestedList.length > 1 && (
              <View style={styles.dotsRow}>
                {suggestedList.slice(0, 8).map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.dot,
                      {
                        backgroundColor:
                          i === suggestedIndex ? colors.primary : "#d1d5db",
                        width: i === suggestedIndex ? 18 : 7,
                      },
                    ]}
                  />
                ))}
              </View>
            )}
          </View>
        )}

        {/* ── Free Gifts ── */}
        {!search && giftList.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              emoji="🎁"
              icon={<Feather name="gift" size={16} color="#db2777" />}
              label="Free Gifts"
              count={giftList.length}
              accentBg="#fce7f3"
              accentText="#9d174d"
            />
            {/* Swipeable carousel */}
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              decelerationRate="fast"
              snapToInterval={SCREEN_W - GRID_PAD * 2}
              contentContainerStyle={{ gap: GRID_GAP }}
            >
              {giftList.slice(0, 6).map((item) => (
                <View key={item.id} style={{ width: SCREEN_W - GRID_PAD * 2 }}>
                  <GiftCard item={item} colors={colors} router={router} />
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ── All Items, grouped by category ── */}
        <View style={styles.section}>
          <SectionHeader
            emoji="🗂️"
            icon={<Feather name="grid" size={16} color="#0d9488" />}
            label={search ? `Results for "${search}"` : "All Items"}
            count={!search ? nonGiftItems.length : undefined}
            accentBg="#d1fae5"
            accentText="#065f46"
          />

          {loadingAll ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : categoryGroups.length === 0 ? (
            <View style={styles.centered}>
              <Feather name="package" size={40} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                {search ? `No results for "${search}"` : "No items yet"}
              </Text>
            </View>
          ) : (
            categoryGroups.map(([cat, items]) => (
              <View key={cat} style={styles.categoryBlock}>
                <Text style={[styles.categoryTitle, { color: colors.foreground }]}>
                  {cat}
                </Text>
                <CategoryCarousel items={items} colors={colors} router={router} />
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* ── Location picker modal ── */}
      <Modal
        visible={locationModal}
        transparent
        animationType="slide"
        onRequestClose={() => setLocationModal(false)}
      >
        <View style={lm.overlay}>
          <Pressable style={lm.backdrop} onPress={() => setLocationModal(false)} />
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={lm.sheet}>
            <View style={[lm.handle]} />
            <Text style={lm.title}>Your Location</Text>
            <Text style={lm.label}>City or neighbourhood</Text>
            <View style={[lm.inputRow, { borderColor: colors.border }]}>
              <Feather name="map-pin" size={15} color={colors.mutedForeground} style={{ flexShrink: 0 }} />
              <TextInput
                style={[lm.input, { color: colors.foreground }]}
                value={locationCity}
                onChangeText={setLocationCity}
                placeholder="e.g. Vancouver"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="words"
              />
              <Pressable onPress={detectLocation} disabled={detectLoading} hitSlop={8} style={{ flexShrink: 0 }}>
                {detectLoading
                  ? <ActivityIndicator size="small" color={colors.primary} />
                  : <Text style={[lm.detectBtn, { color: colors.primary }]}>Detect</Text>}
              </Pressable>
            </View>

            <Text style={lm.label}>Search radius</Text>
            <View style={lm.radiusRow}>
              {[5, 10, 25, 50, 100].map((r) => (
                <Pressable
                  key={r}
                  style={[lm.chip, { borderColor: locationRadius === r ? colors.primary : colors.border, backgroundColor: locationRadius === r ? colors.primary : "transparent" }]}
                  onPress={() => setLocationRadius(r)}
                >
                  <Text style={[lm.chipText, { color: locationRadius === r ? "#fff" : colors.foreground }]}>{r}km</Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              style={[lm.saveBtn, { backgroundColor: colors.primary, opacity: saveLocationMutation.isPending ? 0.7 : 1 }]}
              onPress={() => { setLocationModal(false); saveLocationMutation.mutate(); }}
              disabled={saveLocationMutation.isPending}
            >
              {saveLocationMutation.isPending
                ? <ActivityIndicator color="#fff" />
                : <Text style={lm.saveBtnText}>Save Location</Text>}
            </Pressable>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const lm = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36, gap: 12, maxHeight: "85%" },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#d1d5db", alignSelf: "center", marginBottom: 4 },
  title: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#1f2937" },
  label: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#6b7280", marginTop: 4 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", padding: 0 },
  detectBtn: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  radiusRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5 },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  saveBtn: { borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 4 },
  saveBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
});

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    gap: 10,
  },
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  walletCard: {
    backgroundColor: "rgba(255,255,255,0.95)",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignItems: "flex-start",
    gap: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  walletLabel: {
    fontSize: 9,
    fontFamily: "Inter_400Regular",
    color: "#6b7280",
    letterSpacing: 0.2,
  },
  walletRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  walletAmount: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: "#111827",
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    color: "#000000",
    lineHeight: 26,
  },
  headerSub: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "rgba(0,0,0,0.6)",
    marginTop: 2,
  },
  locationPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 4,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  locationText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: "#374151",
  },
  searchBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 4,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#1f2937",
    padding: 0,
  },

  body: { paddingTop: 16, gap: 0 },
  section: { paddingHorizontal: 16, marginBottom: 24 },
  hscroll: { gap: 10, paddingRight: 4 },
  categoryBlock: { marginBottom: 22 },
  categoryTitle: { fontSize: 16, fontFamily: "Inter_700Bold", marginBottom: 12 },
  centered: { paddingVertical: 40, alignItems: "center", gap: 12 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  dotsRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 5, marginTop: 12 },
  dot: { height: 7, borderRadius: 4 },
});
