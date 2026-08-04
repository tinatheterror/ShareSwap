import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { BadgeCheck, Coins } from "lucide-react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { photoUrl } from "@/lib/api";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Item } from "@/components/ItemCard";
import { VerificationGateModal } from "@/components/VerificationGateModal";
import { PhotoLightbox } from "@/components/PhotoLightbox";

type RequestType = "BORROW" | "RENT" | "SWAP" | "GIFT";

interface ItemDetail extends Item {
  condition?: string;
  conditionRating?: number;
  isAvailable?: boolean;
  depositAmount?: number;
  minimumDays?: number;
  maximumDays?: number;
  rules?: string;
  tags?: string[];
  photos?: string[];
  // Sharing flags
  isLendable?: boolean;
  isRentable?: boolean;
  isSwappable?: boolean;
  isGift?: boolean;
  // Availability states
  isCurrentlyOut?: boolean;
  isCooldownActive?: boolean;
  cooldownExpiresAt?: string | null;
  activeRequestEndDate?: string | null;
  isPassedOn?: boolean;
  // Pricing
  shareCoinPrice?: number;
  shareCoinsReward?: number;
  dollarsPrice?: number;
  securityDeposit?: number;
  replacementValue?: number;
  // Swap
  swapDesiredItem?: string;
  tier?: number;
  // Owner
  ownerId?: number;
}

interface PendingRequest {
  id: number;
  itemId: number;
  requestType: string;
  status: string;
}

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

  const [activeRequestType, setActiveRequestType] = useState<RequestType | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [showVerifModal, setShowVerifModal] = useState(false);
  const [verifMissing, setVerifMissing] = useState<{ idVerified?: boolean; paymentVerified?: boolean }>({});
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [lightboxVisible, setLightboxVisible] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const { width: screenWidth } = useWindowDimensions();

  function openLightbox(index: number) {
    setLightboxIndex(index);
    setLightboxVisible(true);
  }

  const { data: item, isLoading } = useQuery<ItemDetail>({
    queryKey: [`/api/items/${id}`],
    queryFn: () => apiGet<ItemDetail>(`/api/items/${id}`),
    enabled: !!id,
  });

  const isCurrentlyOut = !!item?.isCurrentlyOut;
  const isCooldownActive = !!item?.isCooldownActive;
  const cooldownExpiresAt = item?.cooldownExpiresAt ?? null;
  const activeRequestEndDate = item?.activeRequestEndDate ?? null;
  const expectedAvailability = activeRequestEndDate
    ? new Date(activeRequestEndDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;

  // Pending requests — check per type
  const { data: allRequests } = useQuery<PendingRequest[]>({
    queryKey: ["/api/requests"],
    queryFn: () => apiGet<PendingRequest[]>("/api/requests"),
    enabled: !!user,
    refetchOnMount: "always",
  });

  const pendingForItem = (allRequests ?? []).filter(
    (r) => r.itemId === Number(id) && r.status === "PENDING",
  );
  const hasPendingBorrow = pendingForItem.some((r) => r.requestType === "BORROW");
  const hasPendingRent = pendingForItem.some((r) => r.requestType === "RENT");
  const hasPendingSwap = pendingForItem.some((r) => r.requestType === "SWAP");
  const hasPendingGift = pendingForItem.some((r) => r.requestType === "GIFT");
  const hasAnyPending = pendingForItem.length > 0;

  // Notify-me subscription (only when item is out)
  const { data: notifyData } = useQuery<{ subscribed: boolean }>({
    queryKey: [`/api/items/${id}/notify-me`],
    queryFn: () => apiGet<{ subscribed: boolean }>(`/api/items/${id}/notify-me`),
    enabled: !!id && !!user && isCurrentlyOut,
  });
  const isSubscribed = notifyData?.subscribed ?? false;

  const notifyMutation = useMutation({
    mutationFn: () =>
      isSubscribed
        ? apiDelete(`/api/items/${id}/notify-me`)
        : apiPost(`/api/items/${id}/notify-me`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/items/${id}/notify-me`] });
      Alert.alert(
        isSubscribed ? "Notification removed" : "We'll notify you",
        isSubscribed
          ? "You won't be notified when this item returns."
          : "You'll get a notification when this item becomes available again.",
      );
    },
  });

  const wishlistMutation = useMutation({
    mutationFn: () => apiPost("/api/wishlists/from-item", { itemId: Number(id) }),
    onSuccess: () => {
      Alert.alert("Added to wishlist", "We'll notify you when something similar is listed.");
    },
    onError: () => {
      Alert.alert("Could not add to wishlist", "Please try again.");
    },
  });

  async function handleSendRequest(type: RequestType) {
    if (!user) {
      Alert.alert("Sign in required", "Please sign in to request this item.", [
        { text: "Cancel" },
        { text: "Sign In", onPress: () => router.push("/login") },
      ]);
      return;
    }
    if (type !== "GIFT" && !message.trim()) {
      Alert.alert("Add a message", "Please write a short message to the owner.");
      return;
    }
    setSending(true);
    try {
      await apiPost(`/api/items/${id}/request`, {
        requestType: type,
        message: message.trim(),
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setActiveRequestType(null);
      setMessage("");
      qc.invalidateQueries({ queryKey: ["/api/requests"] });
      qc.invalidateQueries({ queryKey: ["/api/conversations"] });
      Alert.alert("Request sent! 🎉", "The owner will get back to you soon.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (err: unknown) {
      const e = err as Error & { code?: string; missing?: { idVerified?: boolean; paymentVerified?: boolean } };
      if (e.code === "FULL_VERIFICATION_REQUIRED") {
        setVerifMissing(e.missing ?? {});
        setShowVerifModal(true);
        setActiveRequestType(null);
        return;
      }
      if (e.code === "EMAIL_NOT_VERIFIED") {
        router.push("/verify-email-prompt" as never);
        return;
      }
      if (e.code === "BORROW_LIMIT_REACHED") {
        Alert.alert("Monthly limit reached", e.message || "Upgrade to Member for unlimited borrows.");
        return;
      }
      Alert.alert("Error", e.message || "Failed to send request.");
    } finally {
      setSending(false);
    }
  }

  function handlePhotoScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const index = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
    setActivePhotoIndex(index);
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
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Item not found</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={{ color: colors.primary }}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const isOwner = !!user && (user.id === item.ownerId || item.owner?.id === user.id);

  const allPhotos: string[] =
    item.photos && item.photos.length > 0
      ? item.photos
      : item.imageUrl
        ? [item.imageUrl]
        : [];

  const conditionLabel =
    item.conditionRating != null
      ? `${item.conditionRating}/10`
      : CONDITION_LABELS[item.condition ?? ""] ?? item.condition ?? null;

  const shareCoinCost = Math.round(Number(item.shareCoinPrice || item.shareCoinsReward || 5));
  const rentPerWeek = Number(item.dollarsPrice || 0).toFixed(0);
  const deposit = Number(item.securityDeposit || 0).toFixed(0);

  // ─── Request modal ───────────────────────────────────────────────────────────
  function renderRequestModal() {
    if (!activeRequestType) return null;
    const isGift = activeRequestType === "GIFT";
    const typeLabel =
      activeRequestType === "BORROW" ? "Borrow" :
      activeRequestType === "RENT" ? "Rent" :
      activeRequestType === "SWAP" ? "Swap" : "Gift";

    return (
      <Modal
        visible={!!activeRequestType}
        animationType="slide"
        transparent
        onRequestClose={() => { setActiveRequestType(null); setMessage(""); }}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => { setActiveRequestType(null); setMessage(""); }}
        />
        <View style={[styles.modalSheet, { backgroundColor: colors.card }]}>
          <View style={[styles.modalHandle, { backgroundColor: colors.border }]} />
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>
            {isGift ? "Claim this gift" : `Request to ${typeLabel}`}
          </Text>
          <Text style={[styles.modalSubtitle, { color: colors.mutedForeground }]}>
            {isGift
              ? "Send a note to the owner (optional)"
              : `Write a short note to the owner of "${item.title}"`}
          </Text>

          {!isGift && (
            <TextInput
              style={[
                styles.messageInput,
                { backgroundColor: colors.muted, borderColor: colors.border, color: colors.foreground },
              ]}
              placeholder={`Hi! I'd love to ${typeLabel.toLowerCase()} this...`}
              placeholderTextColor={colors.mutedForeground}
              value={message}
              onChangeText={setMessage}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          )}

          <Pressable
            style={({ pressed }) => [
              styles.sendBtn,
              {
                backgroundColor: isGift ? "#ec4899" : colors.primary,
                opacity: pressed || sending ? 0.85 : 1,
              },
            ]}
            onPress={() => handleSendRequest(activeRequestType)}
            disabled={sending}
          >
            {sending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Feather name={isGift ? "gift" : "send"} size={16} color="#fff" />
                <Text style={styles.sendBtnText}>
                  {isGift ? "Claim Gift" : `Send Request`}
                </Text>
              </>
            )}
          </Pressable>
        </View>
      </Modal>
    );
  }

  // ─── Action section ───────────────────────────────────────────────────────────
  function renderPendingBtn(label: string) {
    return (
      <View style={[styles.pendingBtn, { backgroundColor: colors.muted, borderColor: colors.border }]}>
        <Feather name="clock" size={14} color={colors.mutedForeground} />
        <Text style={[styles.pendingBtnText, { color: colors.mutedForeground }]}>{label}</Text>
      </View>
    );
  }

  function renderActionBtn(
    label: string,
    icon: string,
    onPress: () => void,
    bgColor?: string,
    disabled?: boolean,
  ) {
    return (
      <Pressable
        style={({ pressed }) => [
          styles.actionBtn,
          {
            backgroundColor: disabled ? colors.muted : (bgColor || colors.primary),
            opacity: (pressed && !disabled) ? 0.85 : 1,
          },
        ]}
        onPress={onPress}
        disabled={disabled}
      >
        <Feather name={icon as any} size={15} color={disabled ? colors.mutedForeground : "#fff"} />
        <Text style={[styles.actionBtnText, { color: disabled ? colors.mutedForeground : "#fff" }]}>
          {label}
        </Text>
      </Pressable>
    );
  }

  function renderActions() {
    // Owner view
    if (isOwner) {
      if (item.isPassedOn) {
        return (
          <View style={[styles.bannerBox, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Feather name="package" size={16} color={colors.mutedForeground} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.bannerTitle, { color: colors.mutedForeground }]}>This item has been passed on</Text>
              <Text style={[styles.bannerBody, { color: colors.mutedForeground }]}>
                It was gifted or swapped to a neighbour and is no longer editable.
              </Text>
            </View>
          </View>
        );
      }
      return (
        <View style={{ gap: 10 }}>
          {isCurrentlyOut && (
            <View style={[styles.bannerBox, { backgroundColor: "#f0fdf4", borderColor: "#86efac" }]}>
              <Feather name="package" size={16} color="#16a34a" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.bannerTitle, { color: "#166534" }]}>Your item is out with a neighbour</Text>
                <Text style={[styles.bannerBody, { color: "#15803d" }]}>
                  Renew your listing now so it's ready to go when it returns.
                </Text>
              </View>
            </View>
          )}
          {renderPricingRows(true)}
          <Pressable
            style={[styles.editBtn, { borderColor: colors.border }]}
            onPress={() => router.push(`/(tabs)/lend?edit=${item.id}` as never)}
          >
            <Feather name="edit-2" size={14} color={colors.foreground} />
            <Text style={[styles.editBtnText, { color: colors.foreground }]}>Edit your listing</Text>
          </Pressable>
        </View>
      );
    }

    // Cooldown (request was declined recently)
    if (isCooldownActive) {
      return (
        <View style={{ gap: 10 }}>
          <View style={[styles.bannerBox, { backgroundColor: "#f8fafc", borderColor: "#cbd5e1" }]}>
            <Feather name="slash" size={16} color="#64748b" />
            <View style={{ flex: 1 }}>
              <Text style={[styles.bannerTitle, { color: "#475569" }]}>Request declined</Text>
              <Text style={[styles.bannerBody, { color: "#64748b" }]}>
                {cooldownExpiresAt
                  ? `You can request again after ${new Date(cooldownExpiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}, or when the owner updates the listing.`
                  : "You can request again once the owner updates the listing."}
              </Text>
            </View>
          </View>
          <View style={[styles.pendingBtn, { backgroundColor: "#f1f5f9", borderColor: "#cbd5e1" }]}>
            <Feather name="slash" size={14} color="#94a3b8" />
            <Text style={[styles.pendingBtnText, { color: "#94a3b8" }]}>Request declined</Text>
          </View>
        </View>
      );
    }

    // Currently out with a neighbour
    if (isCurrentlyOut) {
      return (
        <View style={{ gap: 10 }}>
          <View style={[styles.bannerBox, { backgroundColor: "#fffbeb", borderColor: "#fcd34d" }]}>
            <Feather name="package" size={16} color="#d97706" />
            <View style={{ flex: 1 }}>
              <Text style={[styles.bannerTitle, { color: "#92400e" }]}>Currently out with a neighbour</Text>
              <Text style={[styles.bannerBody, { color: "#b45309" }]}>
                {expectedAvailability
                  ? `This item is expected back ${expectedAvailability}.`
                  : "This item is currently unavailable."}
              </Text>
            </View>
          </View>
          {user ? (
            <>
              <Pressable
                style={[styles.notifyBtn, { backgroundColor: isSubscribed ? colors.muted : colors.primary, borderColor: isSubscribed ? colors.border : "transparent" }]}
                onPress={() => notifyMutation.mutate()}
                disabled={notifyMutation.isPending}
              >
                <Feather name={isSubscribed ? "bell-off" : "bell"} size={15} color={isSubscribed ? colors.foreground : "#fff"} />
                <Text style={[styles.notifyBtnText, { color: isSubscribed ? colors.foreground : "#fff" }]}>
                  {isSubscribed ? "Remove Notification" : "Notify Me When Available"}
                </Text>
              </Pressable>
              <Text style={[styles.notifyHint, { color: colors.mutedForeground }]}>
                Notified when it returns
              </Text>
              <Pressable
                style={[styles.wishlistBtn, { borderColor: colors.primary + "80" }]}
                onPress={() => wishlistMutation.mutate()}
                disabled={wishlistMutation.isPending}
              >
                <Feather name="bookmark-plus" size={15} color={colors.primary} />
                <Text style={[styles.wishlistBtnText, { color: colors.primary }]}>Add to Wishlist</Text>
              </Pressable>
              <Text style={[styles.notifyHint, { color: colors.mutedForeground }]}>
                Notified when <Text style={{ fontFamily: "Inter_600SemiBold" }}>anything similar</Text> is listed
              </Text>
            </>
          ) : (
            <Pressable
              style={[styles.notifyBtn, { backgroundColor: colors.primary }]}
              onPress={() => router.push("/login" as never)}
            >
              <Feather name="bell" size={15} color="#fff" />
              <Text style={[styles.notifyBtnText, { color: "#fff" }]}>Sign in to get notified</Text>
            </Pressable>
          )}
        </View>
      );
    }

    // Gift-only item: show single claim button
    if (item.isGift && !item.isLendable && !item.isRentable && !item.isSwappable) {
      return (
        <View style={{ gap: 8 }}>
          {hasPendingGift
            ? renderPendingBtn("Request Pending")
            : renderActionBtn("Claim Gift", "gift", () => setActiveRequestType("GIFT"), "#ec4899", hasAnyPending)}
          <Text style={[styles.giftHint, { color: colors.mutedForeground }]}>
            This item is being given away for free
          </Text>
        </View>
      );
    }

    // Normal: show per-type sections
    return (
      <View style={{ gap: 14 }}>
        {renderPricingRows(false)}
      </View>
    );
  }

  function renderPricingRows(ownerView: boolean) {
    const rows: React.ReactNode[] = [];

    if (item.isLendable) {
      rows.push(
        <View key="borrow" style={[styles.typeRow, { borderColor: colors.border }]}>
          <Text style={[styles.typeRowLabel, { color: colors.foreground }]}>Borrow</Text>
          <View style={styles.typeRowPrice}>
            <Coins size={18} color={colors.primary} strokeWidth={2} />
            <Text style={[styles.typeRowPriceText, { color: colors.primary }]}>
              {shareCoinCost} ShareCoins
            </Text>
          </View>
          <Text style={[styles.typeRowSub, { color: colors.mutedForeground }]}>
            Trust-Deposit: ${deposit}
          </Text>
          {item.replacementValue ? (
            <Text style={[styles.typeRowMicro, { color: colors.mutedForeground }]}>
              Max charge if not returned: ${item.replacementValue}
            </Text>
          ) : null}
          {!ownerView && (
            hasPendingBorrow
              ? renderPendingBtn("Request Pending")
              : renderActionBtn("Request to Borrow", "heart", () => setActiveRequestType("BORROW"), colors.primary, hasAnyPending || !item.replacementValue)
          )}
        </View>,
      );
    }

    if (item.isRentable) {
      rows.push(
        <View key="rent" style={[styles.typeRow, { borderColor: colors.border }]}>
          <Text style={[styles.typeRowLabel, { color: colors.foreground }]}>Rent</Text>
          <Text style={[styles.typeRowPriceText, { color: colors.primary, fontSize: 18, fontFamily: "Inter_700Bold" }]}>
            ${rentPerWeek}/week
          </Text>
          <Text style={[styles.typeRowSub, { color: colors.mutedForeground }]}>
            Trust-Deposit: ${deposit}
          </Text>
          {!ownerView && (
            hasPendingRent
              ? renderPendingBtn("Request Pending")
              : renderActionBtn("Request to Rent", "dollar-sign", () => setActiveRequestType("RENT"), colors.primary, hasAnyPending)
          )}
        </View>,
      );
    }

    if (item.isSwappable) {
      rows.push(
        <View key="swap" style={[styles.typeRow, { borderColor: colors.border }]}>
          <Text style={[styles.typeRowLabel, { color: colors.foreground }]}>Swap</Text>
          {item.swapDesiredItem ? (
            <Text style={[styles.typeRowSub, { color: colors.mutedForeground }]}>
              Looking for: {item.swapDesiredItem}
            </Text>
          ) : (
            <Text style={[styles.typeRowSub, { color: colors.mutedForeground }]}>
              Offer something in exchange
            </Text>
          )}
          {!ownerView && (
            hasPendingSwap
              ? renderPendingBtn("Request Pending")
              : renderActionBtn("Request Swap", "repeat", () => setActiveRequestType("SWAP"), colors.primary, hasAnyPending)
          )}
        </View>,
      );
    }

    if (item.isGift) {
      rows.push(
        <View key="gift" style={[styles.typeRow, { borderColor: colors.border }]}>
          <Text style={[styles.typeRowLabel, { color: colors.foreground }]}>Gift</Text>
          <Text style={[styles.typeRowPriceText, { color: "#ec4899", fontSize: 18, fontFamily: "Inter_700Bold" }]}>
            Free to claim
          </Text>
          <Text style={[styles.typeRowSub, { color: colors.mutedForeground }]}>
            This item is being given away
          </Text>
          {!ownerView && (
            hasPendingGift
              ? renderPendingBtn("Request Pending")
              : renderActionBtn("Send Gift Request", "gift", () => setActiveRequestType("GIFT"), "#ec4899", hasAnyPending)
          )}
        </View>,
      );
    }

    return rows;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <VerificationGateModal
        visible={showVerifModal}
        onClose={() => setShowVerifModal(false)}
        missing={verifMissing}
      />
      <PhotoLightbox
        photos={allPhotos}
        initialIndex={lightboxIndex}
        visible={lightboxVisible}
        onClose={() => setLightboxVisible(false)}
      />
      {renderRequestModal()}

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + (isWeb ? 34 : 0) + 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Photos */}
        {allPhotos.length > 0 ? (
          <View>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={handlePhotoScroll}
              scrollEventThrottle={16}
            >
              {allPhotos.map((photo, index) => (
                <Pressable key={index} onPress={() => openLightbox(index)} style={{ width: screenWidth }}>
                  <Image
                    source={{ uri: photoUrl(photo) }}
                    style={[styles.heroImage, { width: screenWidth }]}
                    resizeMode="cover"
                  />
                  <View style={styles.zoomHint} pointerEvents="none">
                    <Feather name="zoom-in" size={14} color="#fff" />
                    <Text style={styles.zoomHintText}>Tap to zoom</Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
            {allPhotos.length > 1 && (
              <View style={styles.dotRow}>
                {allPhotos.map((_, index) => (
                  <View
                    key={index}
                    style={[
                      styles.dot,
                      {
                        backgroundColor: index === activePhotoIndex ? colors.primary : colors.primary + "40",
                        width: index === activePhotoIndex ? 18 : 6,
                      },
                    ]}
                  />
                ))}
              </View>
            )}
          </View>
        ) : (
          <View style={[styles.heroPlaceholder, { backgroundColor: colors.muted }]}>
            <Feather name="package" size={64} color={colors.mutedForeground} />
          </View>
        )}

        <View style={styles.content}>
          {/* Title */}
          <Text style={[styles.title, { color: colors.foreground }]}>{item.name ?? item.title}</Text>

          {/* Meta chips — location only */}
          {(item.neighbourhood ?? item.location) ? (
            <View style={styles.metaRow}>
              <View style={[styles.metaChip, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                <Feather name="map-pin" size={12} color={colors.mutedForeground} />
                <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                  {item.neighbourhood ?? item.location}
                </Text>
              </View>
            </View>
          ) : null}

          {/* Description */}
          {item.description ? (
            <Text style={[styles.description, { color: colors.foreground }]}>{item.description}</Text>
          ) : null}

          {/* Rules */}
          {item.rules ? (
            <View style={[styles.rulesBox, { backgroundColor: colors.accent, borderColor: colors.primary + "30" }]}>
              <Text style={[styles.rulesTitle, { color: colors.primary }]}>Rules</Text>
              <Text style={[styles.rulesText, { color: colors.accentForeground }]}>{item.rules}</Text>
            </View>
          ) : null}

          {/* Shared by */}
          {item.owner ? (
            <View style={{ gap: 6 }}>
              <View style={styles.sharedByRow}>
                <Text style={[styles.sharedByLabel, { color: colors.mutedForeground }]}>Shared by</Text>
                <Pressable
                  style={styles.sharedByName}
                  onPress={() => router.push(`/profile/${item.owner!.id}`)}
                >
                  <Text style={[styles.sharedByNameText, { color: colors.primary }]}>
                    {item.owner.displayName ?? item.owner.username}
                  </Text>
                  {(item.owner as any).isVerified ? (
                    <BadgeCheck size={16} fill="#0DCEA1" color="white" strokeWidth={1.5} />
                  ) : null}
                </Pressable>
              </View>
              {conditionLabel ? (
                <View style={[styles.metaChip, { alignSelf: "flex-start", backgroundColor: colors.muted, borderColor: colors.border }]}>
                  <Feather name="star" size={12} color={colors.mutedForeground} />
                  <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                    {item.conditionRating != null ? `Condition: ${conditionLabel}` : conditionLabel}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Action section */}
          <View style={[styles.actionSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {renderActions()}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  heroImage: { height: 280 },
  heroPlaceholder: { width: "100%", height: 280, alignItems: "center", justifyContent: "center" },
  dotRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, paddingVertical: 10 },
  dot: { height: 6, borderRadius: 3 },
  content: { padding: 20, gap: 16 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metaChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1,
  },
  metaText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  description: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 22 },
  rulesBox: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 6 },
  rulesTitle: { fontSize: 13, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  rulesText: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  sharedByRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  sharedByLabel: { fontSize: 14, fontFamily: "Inter_400Regular" },
  sharedByName: { flexDirection: "row", alignItems: "center", gap: 5 },
  sharedByNameText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  actionSection: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },

  // Type rows (borrow/rent/swap/gift)
  typeRow: {
    flexDirection: "column", gap: 4,
    paddingVertical: 12, borderBottomWidth: 1,
  },
  typeRowLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  typeRowPrice: { flexDirection: "row", alignItems: "center", gap: 4 },
  typeRowPriceText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  typeRowSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  typeRowMicro: { fontSize: 11, fontFamily: "Inter_400Regular" },

  // Buttons
  actionBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, borderRadius: 10, paddingVertical: 12,
    marginTop: 6,
  },
  actionBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  pendingBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, borderRadius: 10, paddingVertical: 12,
    borderWidth: 1, marginTop: 6,
  },
  pendingBtnText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  editBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, borderRadius: 10, paddingVertical: 10, borderWidth: 1,
  },
  editBtnText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  notifyBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, borderRadius: 12, paddingVertical: 13,
  },
  notifyBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  wishlistBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, borderRadius: 12, paddingVertical: 12, borderWidth: 1,
  },
  wishlistBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  notifyHint: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center" },
  giftHint: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },

  // Banner boxes
  bannerBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    borderRadius: 12, borderWidth: 1, padding: 12,
  },
  bannerTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  bannerBody: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },

  // Request modal
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  modalSheet: {
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40, gap: 12,
  },
  modalHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 4 },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  modalSubtitle: { fontSize: 14, fontFamily: "Inter_400Regular" },
  messageInput: {
    borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, fontFamily: "Inter_400Regular", minHeight: 90,
  },
  sendBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, borderRadius: 14, paddingVertical: 14,
  },
  sendBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },

  // Misc
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  zoomHint: {
    position: "absolute", bottom: 10, right: 10,
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(0,0,0,0.40)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
  },
  zoomHintText: { color: "#fff", fontSize: 11, fontFamily: "Inter_500Medium" },
});
