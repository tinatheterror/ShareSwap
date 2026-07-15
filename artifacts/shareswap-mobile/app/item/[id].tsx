import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { photoUrl } from "@/lib/api";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Item } from "@/components/ItemCard";

interface ItemDetail extends Item {
  condition?: string;
  isAvailable?: boolean;
  depositAmount?: number;
  minimumDays?: number;
  maximumDays?: number;
  rules?: string;
  tags?: string[];
}

const SHARE_TYPE_LABELS: Record<string, string> = {
  borrow: "Borrow",
  rent: "Rent",
  swap: "Swap",
  gift: "Gift",
  lend: "Lend",
};

const CONDITION_LABELS: Record<string, string> = {
  new: "Brand New",
  like_new: "Like New",
  good: "Good",
  fair: "Fair",
  poor: "Well Loved",
};

export default function ItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const isWeb = Platform.OS === "web";

  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const { data: item, isLoading } = useQuery<ItemDetail>({
    queryKey: [`/api/items/${id}`],
    queryFn: () => apiGet<ItemDetail>(`/api/items/${id}`),
    enabled: !!id,
  });

  async function handleRequest() {
    if (!user) {
      Alert.alert("Sign in required", "Please sign in to request this item.", [
        { text: "Cancel" },
        { text: "Sign In", onPress: () => router.push("/login") },
      ]);
      return;
    }
    if (!message.trim()) {
      Alert.alert("Add a message", "Please write a short message to the owner.");
      return;
    }
    setSending(true);
    try {
      await apiPost(`/api/items/${id}/request`, { message: message.trim() });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        "Request sent! 🎉",
        "The owner will get back to you soon.",
        [{ text: "OK", onPress: () => router.back() }],
      );
      qc.invalidateQueries({ queryKey: ["/api/conversations"] });
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to send request.";
      Alert.alert("Error", msg);
    } finally {
      setSending(false);
    }
  }

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!item) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Feather name="alert-circle" size={40} color={colors.mutedForeground} />
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
          Item not found
        </Text>
        <Pressable onPress={() => router.back()}>
          <Text style={{ color: colors.primary }}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const isOwnItem = item.owner?.id === user?.id;
  const typeLabel = SHARE_TYPE_LABELS[item.shareType ?? "borrow"] ?? "Share";
  const conditionLabel = CONDITION_LABELS[item.condition ?? "good"] ?? "Good";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{
          paddingBottom: insets.bottom + (isWeb ? 34 : 0) + 100,
        }}
        showsVerticalScrollIndicator={false}
      >
        {item.imageUrl ? (
          <Image
            source={{ uri: photoUrl(item.imageUrl) }}
            style={styles.heroImage}
            resizeMode="cover"
          />
        ) : (
          <View
            style={[styles.heroPlaceholder, { backgroundColor: colors.muted }]}
          >
            <Feather name="package" size={64} color={colors.mutedForeground} />
          </View>
        )}

        <View style={styles.content}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {item.title}
            </Text>
            <View
              style={[
                styles.typeBadge,
                {
                  backgroundColor: colors.primary + "20",
                  borderColor: colors.primary + "40",
                },
              ]}
            >
              <Text style={[styles.typeText, { color: colors.primary }]}>
                {typeLabel}
              </Text>
            </View>
          </View>

          {item.shareType === "rent" && item.pricePerDay ? (
            <Text style={[styles.price, { color: colors.primary }]}>
              £{item.pricePerDay}/day
            </Text>
          ) : null}

          <View style={styles.metaRow}>
            {item.condition ? (
              <View
                style={[
                  styles.metaChip,
                  { backgroundColor: colors.muted, borderColor: colors.border },
                ]}
              >
                <Feather name="star" size={12} color={colors.mutedForeground} />
                <Text
                  style={[styles.metaText, { color: colors.mutedForeground }]}
                >
                  {conditionLabel}
                </Text>
              </View>
            ) : null}
            {item.neighbourhood ?? item.location ? (
              <View
                style={[
                  styles.metaChip,
                  { backgroundColor: colors.muted, borderColor: colors.border },
                ]}
              >
                <Feather
                  name="map-pin"
                  size={12}
                  color={colors.mutedForeground}
                />
                <Text
                  style={[styles.metaText, { color: colors.mutedForeground }]}
                >
                  {item.neighbourhood ?? item.location}
                </Text>
              </View>
            ) : null}
          </View>

          {item.description ? (
            <Text style={[styles.description, { color: colors.foreground }]}>
              {item.description}
            </Text>
          ) : null}

          {item.rules ? (
            <View
              style={[
                styles.rulesBox,
                { backgroundColor: colors.accent, borderColor: colors.primary + "30" },
              ]}
            >
              <Text style={[styles.rulesTitle, { color: colors.primary }]}>
                Rules
              </Text>
              <Text style={[styles.rulesText, { color: colors.accentForeground }]}>
                {item.rules}
              </Text>
            </View>
          ) : null}

          {item.owner ? (
            <Pressable
              style={[
                styles.ownerCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
              onPress={() => router.push(`/profile/${item.owner!.id}`)}
            >
              <View
                style={[
                  styles.ownerAvatar,
                  { backgroundColor: colors.primary + "30" },
                ]}
              >
                <Text style={[styles.ownerAvatarText, { color: colors.primary }]}>
                  {(item.owner.displayName ?? item.owner.username)
                    .charAt(0)
                    .toUpperCase()}
                </Text>
              </View>
              <View style={styles.ownerInfo}>
                <Text style={[styles.ownerName, { color: colors.foreground }]}>
                  {item.owner.displayName ?? item.owner.username}
                </Text>
                {item.owner.trustScore ? (
                  <View style={styles.trustRow}>
                    <Feather name="shield" size={12} color={colors.primary} />
                    <Text style={[styles.trustText, { color: colors.primary }]}>
                      Trust score {item.owner.trustScore}
                    </Text>
                    {item.owner.trustLevel ? (
                      <Text
                        style={[
                          styles.levelText,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        · {item.owner.trustLevel}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
              <Feather
                name="chevron-right"
                size={16}
                color={colors.mutedForeground}
              />
            </Pressable>
          ) : null}

          {!isOwnItem && item.isAvailable !== false ? (
            <View
              style={[
                styles.requestBox,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.requestTitle, { color: colors.foreground }]}>
                Send a request
              </Text>
              <TextInput
                style={[
                  styles.messageInput,
                  {
                    backgroundColor: colors.muted,
                    borderColor: colors.border,
                    color: colors.foreground,
                  },
                ]}
                placeholder={`Hi! I'd love to ${typeLabel.toLowerCase()} this item...`}
                placeholderTextColor={colors.mutedForeground}
                value={message}
                onChangeText={setMessage}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
              <Pressable
                style={({ pressed }) => [
                  styles.requestButton,
                  {
                    backgroundColor: colors.primary,
                    opacity: pressed || sending ? 0.85 : 1,
                  },
                ]}
                onPress={handleRequest}
                disabled={sending}
              >
                {sending ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <>
                    <Feather name="send" size={16} color={colors.primaryForeground} />
                    <Text style={[styles.requestButtonText, { color: colors.primaryForeground }]}>
                      Request to {typeLabel}
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          ) : isOwnItem ? (
            <View
              style={[
                styles.ownItemNote,
                { backgroundColor: colors.muted, borderColor: colors.border },
              ]}
            >
              <Feather name="info" size={14} color={colors.mutedForeground} />
              <Text style={[styles.ownItemText, { color: colors.mutedForeground }]}>
                This is your listing
              </Text>
            </View>
          ) : (
            <View
              style={[
                styles.ownItemNote,
                { backgroundColor: colors.muted, borderColor: colors.border },
              ]}
            >
              <Feather
                name="alert-circle"
                size={14}
                color={colors.mutedForeground}
              />
              <Text style={[styles.ownItemText, { color: colors.mutedForeground }]}>
                This item is currently unavailable
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
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 32,
  },
  heroImage: {
    width: "100%",
    height: 280,
  },
  heroPlaceholder: {
    width: "100%",
    height: 280,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    padding: 20,
    gap: 16,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  title: {
    flex: 1,
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.3,
  },
  typeBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  typeText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  price: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    marginTop: -8,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  metaText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  description: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
  },
  rulesBox: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 6,
  },
  rulesTitle: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  rulesText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  ownerCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  ownerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  ownerAvatarText: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
  },
  ownerInfo: {
    flex: 1,
    gap: 4,
  },
  ownerName: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  trustRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  trustText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  levelText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  requestBox: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  requestTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  messageInput: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    minHeight: 80,
  },
  requestButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    paddingVertical: 14,
  },
  requestButtonText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  ownItemNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  ownItemText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
  },
});
