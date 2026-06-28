import { Feather } from "@expo/vector-icons";
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

interface Item {
  id: number;
  title: string;
  description?: string;
  category?: string;
  condition?: string;
  shareType?: string;
  pricePerDay?: number | null;
  imageUrl?: string;
  location?: string;
  neighbourhood?: string;
  owner?: {
    id: number;
    displayName?: string;
    username: string;
    avatarUrl?: string;
    trustScore?: number;
    trustLevel?: string;
  };
}

const SHARE_TYPE_LABELS: Record<string, string> = {
  borrow: "Borrow",
  rent: "Rent",
  swap: "Swap",
  gift: "Gift",
  lend: "Lend",
};

const SHARE_TYPE_COLORS: Record<string, string> = {
  borrow: "#3b82f6",
  rent: "#8b5cf6",
  swap: "#f59e0b",
  gift: "#ec4899",
  lend: "#10b981",
};

interface ItemCardProps {
  item: Item;
  compact?: boolean;
}

export function ItemCard({ item, compact = false }: ItemCardProps) {
  const colors = useColors();
  const router = useRouter();
  const typeColor = SHARE_TYPE_COLORS[item.shareType ?? "borrow"] ?? colors.primary;
  const typeLabel = SHARE_TYPE_LABELS[item.shareType ?? "borrow"] ?? "Share";

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.95 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
      onPress={() => router.push(`/item/${item.id}`)}
    >
      <View style={styles.imageContainer}>
        {item.imageUrl ? (
          <Image
            source={{ uri: item.imageUrl }}
            style={styles.image}
            resizeMode="cover"
          />
        ) : (
          <View
            style={[styles.imagePlaceholder, { backgroundColor: colors.muted }]}
          >
            <Feather name="package" size={32} color={colors.mutedForeground} />
          </View>
        )}
        <View
          style={[styles.typeBadge, { backgroundColor: typeColor + "20", borderColor: typeColor + "40" }]}
        >
          <Text style={[styles.typeText, { color: typeColor }]}>{typeLabel}</Text>
        </View>
      </View>

      <View style={styles.content}>
        <Text
          style={[styles.title, { color: colors.foreground }]}
          numberOfLines={1}
        >
          {item.title}
        </Text>

        {!compact && item.description ? (
          <Text
            style={[styles.description, { color: colors.mutedForeground }]}
            numberOfLines={2}
          >
            {item.description}
          </Text>
        ) : null}

        <View style={styles.footer}>
          {item.shareType === "rent" && item.pricePerDay ? (
            <Text style={[styles.price, { color: colors.primary }]}>
              £{item.pricePerDay}/day
            </Text>
          ) : (
            <Text style={[styles.price, { color: colors.primary }]}>Free</Text>
          )}

          {item.neighbourhood || item.location ? (
            <View style={styles.locationRow}>
              <Feather name="map-pin" size={11} color={colors.mutedForeground} />
              <Text
                style={[styles.location, { color: colors.mutedForeground }]}
                numberOfLines={1}
              >
                {item.neighbourhood ?? item.location}
              </Text>
            </View>
          ) : null}
        </View>

        {item.owner && !compact ? (
          <View style={styles.ownerRow}>
            <View
              style={[
                styles.avatar,
                { backgroundColor: colors.primary + "30" },
              ]}
            >
              {item.owner.avatarUrl ? (
                <Image
                  source={{ uri: item.owner.avatarUrl }}
                  style={styles.avatarImg}
                />
              ) : (
                <Text style={[styles.avatarLetter, { color: colors.primary }]}>
                  {(item.owner.displayName ?? item.owner.username)
                    .charAt(0)
                    .toUpperCase()}
                </Text>
              )}
            </View>
            <Text
              style={[styles.ownerName, { color: colors.mutedForeground }]}
            >
              {item.owner.displayName ?? item.owner.username}
            </Text>
            {item.owner.trustScore ? (
              <View style={styles.trustRow}>
                <Feather name="shield" size={11} color={colors.primary} />
                <Text style={[styles.trustText, { color: colors.primary }]}>
                  {item.owner.trustScore}
                </Text>
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
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 12,
  },
  imageContainer: {
    position: "relative",
  },
  image: {
    width: "100%",
    height: 180,
  },
  imagePlaceholder: {
    width: "100%",
    height: 180,
    alignItems: "center",
    justifyContent: "center",
  },
  typeBadge: {
    position: "absolute",
    top: 10,
    left: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  typeText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.3,
  },
  content: {
    padding: 14,
    gap: 6,
  },
  title: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  description: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
  },
  price: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    flex: 1,
    justifyContent: "flex-end",
  },
  location: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    maxWidth: 120,
  },
  ownerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImg: {
    width: 24,
    height: 24,
  },
  avatarLetter: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
  },
  ownerName: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
  trustRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  trustText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
});

export type { Item };
