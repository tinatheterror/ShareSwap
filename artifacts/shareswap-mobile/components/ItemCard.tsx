import { Feather } from "@expo/vector-icons";
import { HandHeart, ArrowLeftRight, Coins } from "lucide-react-native";
import { useRouter } from "expo-router";
import React from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { photoUrl } from "@/lib/api";

export interface Item {
  id: number;
  name?: string;
  title?: string;
  description?: string;
  category?: string;
  // Sharing flags (web-aligned)
  shareType?: string;
  isLendable?: boolean;
  isRentable?: boolean;
  isSwappable?: boolean;
  isGift?: boolean;
  isAvailable?: boolean;
  // Pricing
  pricePerDay?: number | null;
  dollarsPrice?: string | number | null;
  shareCoinPrice?: number | null;
  shareCoinsReward?: number | null;
  securityDeposit?: number | null;
  // Media
  imageUrl?: string | null;
  photos?: string[] | null;
  // Meta
  conditionRating?: number | null;
  condition?: string;
  location?: string;
  neighbourhood?: string;
  city?: string | null;
  owner?: {
    id: number;
    displayName?: string;
    username: string;
    avatarUrl?: string | null;
    trustScore?: number;
    trustLevel?: string;
    isVerified?: boolean;
    reputationLevel?: string;
  };
}

interface ItemCardProps {
  item: Item;
  compact?: boolean;
}

function iname(item: Item) {
  return item.name || item.title || "Untitled";
}

function iphoto(item: Item): string | undefined {
  const raw =
    item.photos && item.photos.length > 0 ? item.photos[0] : item.imageUrl;
  return photoUrl(raw) ?? undefined;
}

function coinsCount(item: Item) {
  return Math.round(Number(item.shareCoinPrice || item.shareCoinsReward || 0));
}

function weeklyPrice(item: Item): string | null {
  if (item.dollarsPrice && Number(item.dollarsPrice) > 0)
    return `$${Number(item.dollarsPrice).toFixed(0)}/wk`;
  if (item.pricePerDay && Number(item.pricePerDay) > 0)
    return `$${(Number(item.pricePerDay) * 7).toFixed(0)}/wk`;
  return null;
}

type ActionBtn = { label: string; icon: string; family: "feather" | "hand-heart" | "arrow-lr"; bg: string };

function getActionBtns(item: Item, primary: string): ActionBtn[] {
  const btns: ActionBtn[] = [];
  if (item.isGift)      btns.push({ label: "Claim Gift", icon: "gift",         family: "feather",     bg: "#ec4899" });
  if (item.isLendable)  btns.push({ label: "Borrow It",  icon: "",             family: "hand-heart",  bg: primary });
  if (item.isRentable)  btns.push({ label: "Rent It",    icon: "dollar-sign",  family: "feather",     bg: primary });
  if (item.isSwappable) btns.push({ label: "Swap It",    icon: "",             family: "arrow-lr",    bg: primary });
  if (btns.length > 0) return btns;
  // Fallback to shareType
  const st = (item.shareType || "borrow").toLowerCase();
  if (st === "gift")  return [{ label: "Claim Gift", icon: "gift",         family: "feather",    bg: "#ec4899" }];
  if (st === "rent")  return [{ label: "Rent It",    icon: "dollar-sign",  family: "feather",    bg: primary }];
  if (st === "swap")  return [{ label: "Swap It",    icon: "",             family: "arrow-lr",   bg: primary }];
  return               [{ label: "Borrow It",   icon: "",             family: "hand-heart", bg: primary }];
}

export function ItemCard({ item, compact = false }: ItemCardProps) {
  const colors = useColors();
  const router = useRouter();
  const photo = iphoto(item);
  const c = coinsCount(item);
  const wkPrice = weeklyPrice(item);
  const isGift = !!(item.isGift || (item.shareType || "").toLowerCase() === "gift");
  const actionBtns = getActionBtns(item, colors.primary);
  const condLabel = item.conditionRating != null ? `${item.conditionRating}/10` : null;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: isGift ? "#fce7f3" : colors.border,
          opacity: pressed ? 0.96 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
      ]}
      onPress={() => router.push(`/item/${item.id}`)}
    >
      {/* Image */}
      <View style={[styles.imageWrap, { backgroundColor: isGift ? "#fdf2f8" : colors.muted }]}>
        {photo ? (
          <Image source={{ uri: photo }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={[styles.imagePlaceholder, { backgroundColor: isGift ? "#fce7f3" : colors.muted }]}>
            {isGift
              ? <Text style={{ fontSize: 28 }}>🎁</Text>
              : <Feather name="package" size={28} color={colors.mutedForeground} />}
          </View>
        )}
        {/* FREE badge */}
        {isGift && (
          <View style={styles.freeBadge}>
            <Text style={styles.freeBadgeText}>FREE</Text>
          </View>
        )}
        {/* Unavailable badge */}
        {item.isAvailable === false && !isGift && (
          <View style={styles.outBadge}>
            <Text style={styles.outBadgeText}>Currently Out</Text>
          </View>
        )}
      </View>

      {/* Content */}
      <View style={styles.body}>
        {/* Title */}
        <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
          {iname(item)}
        </Text>

        {/* Description — compact hides it */}
        {!compact && item.description ? (
          <Text style={[styles.description, { color: colors.mutedForeground }]} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}

        {/* Location */}
        {(item.city || item.neighbourhood || item.location) ? (
          <View style={styles.metaRow}>
            <Feather name="map-pin" size={11} color={colors.mutedForeground} />
            <Text style={[styles.metaText, { color: colors.mutedForeground }]} numberOfLines={1}>
              {item.city || item.neighbourhood || item.location}
            </Text>
          </View>
        ) : null}

        {/* Condition + Verified Owner */}
        <View style={styles.metaRow}>
          {condLabel ? (
            <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
              <Text style={{ fontFamily: "Inter_600SemiBold" }}>Condition:</Text> {condLabel}
            </Text>
          ) : null}
          {item.owner?.isVerified ? (
            <View style={[styles.verifiedPill, { borderColor: colors.primary + "30" }]}>
              <Feather name="check-circle" size={9} color={colors.primary} />
              <Text style={[styles.verifiedText, { color: colors.primary }]}>Verified Owner</Text>
            </View>
          ) : null}
        </View>

        {/* Pricing: ShareCoins | $/wk */}
        {!isGift && (c > 0 || wkPrice) ? (
          <View style={styles.pricingRow}>
            {c > 0 ? (
              <>
                <Coins size={13} color="#0DCEA1" strokeWidth={2} />
                <Text style={styles.coinsText}>{c} ShareCoins</Text>
              </>
            ) : null}
            {c > 0 && wkPrice ? (
              <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{"  |  "}</Text>
            ) : null}
            {wkPrice ? (
              <>
                <Feather name="dollar-sign" size={12} color={colors.mutedForeground} />
                <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{wkPrice}</Text>
              </>
            ) : null}
          </View>
        ) : null}

        {/* Action buttons */}
        <View style={styles.actionRow}>
          {actionBtns.map((btn) => (
            <Pressable
              key={btn.label}
              style={[styles.actionBtn, { backgroundColor: btn.bg }]}
              onPress={() => router.push(`/item/${item.id}`)}
            >
              {btn.family === "hand-heart"
                ? <HandHeart size={12} color="#fff" strokeWidth={2} />
                : btn.family === "arrow-lr"
                ? <ArrowLeftRight size={12} color="#fff" strokeWidth={2} />
                : <Feather name={btn.icon as any} size={11} color="#fff" />}
              <Text style={styles.actionBtnText}>{btn.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* Shared by row */}
        {item.owner ? (
          <View style={[styles.ownerRow, { borderTopColor: colors.border }]}>
            <Text style={[styles.sharedByLabel, { color: colors.mutedForeground }]}>
              Shared by{"  "}
            </Text>
            <Pressable onPress={() => router.push(`/profile/${item.owner!.id}` as never)}>
              <Text style={[styles.sharedByName, { color: colors.primary }]} numberOfLines={1}>
                {item.owner.displayName || item.owner.username}
              </Text>
            </Pressable>
            {item.owner.isVerified ? (
              <View style={[styles.verifiedDot, { backgroundColor: colors.primary }]}>
                <Feather name="check" size={8} color="#fff" />
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  imageWrap: {
    width: "100%",
    aspectRatio: 1 / 0.9,
    position: "relative",
    overflow: "hidden",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  imagePlaceholder: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  freeBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "#ec4899",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  freeBadgeText: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    color: "#fff",
  },
  outBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    backgroundColor: "#f59e0b",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  outBadgeText: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    color: "#fff",
  },
  body: {
    padding: 10,
    gap: 5,
  },
  title: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.1,
  },
  description: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 16,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexWrap: "wrap",
  },
  metaText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  verifiedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    backgroundColor: "#fff",
  },
  verifiedText: {
    fontSize: 9,
    fontFamily: "Inter_600SemiBold",
  },
  pricingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  coinsText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: "#0DCEA1",
  },
  actionRow: {
    flexDirection: "row",
    gap: 5,
    flexWrap: "wrap",
    marginTop: 2,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 20,
    flexShrink: 1,
  },
  actionBtnText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  ownerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 2,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexWrap: "wrap",
  },
  sharedByLabel: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  sharedByName: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  verifiedDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 2,
  },
});

export type { ItemCardProps };
