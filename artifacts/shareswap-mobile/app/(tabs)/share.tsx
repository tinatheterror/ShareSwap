import { Feather } from "@expo/vector-icons";

// ── Image upload helpers ──────────────────────────────────────────────────────
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

function getImageMimeType(asset: import("expo-image-picker").ImagePickerAsset): string {
  // Prefer the mimeType Expo reports (most reliable)
  const reported = asset.mimeType?.toLowerCase();
  if (reported && ALLOWED_MIME.includes(reported as any)) return reported;
  // HEIC/HEIF from iPhone — server doesn't accept them; tell multer it's JPEG
  // (Expo already decoded the pixel data; we're just labelling the upload)
  if (reported === "image/heic" || reported === "image/heif") return "image/jpeg";

  // Fall back to URI extension — strip query params and lowercase first
  const cleanUri = asset.uri.split("?")[0];
  const ext = (cleanUri.split(".").pop() ?? "jpg").toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png")  return "image/png";
  if (ext === "gif")  return "image/gif";
  if (ext === "webp") return "image/webp";
  return "image/jpeg"; // safe default
}

function getImageFilename(asset: import("expo-image-picker").ImagePickerAsset, index: number, prefix = "photo"): string {
  const mime = getImageMimeType(asset);
  const ext = mime.split("/")[1] === "jpeg" ? "jpg" : mime.split("/")[1];
  return `${prefix}-${index}.${ext}`;
}
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Image,
  Modal,
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
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { HeartPeopleIcon } from "@/components/HeartPeopleIcon";
import { NotificationBell } from "@/components/NotificationBell";
import Svg, { Path, Circle, Rect } from "react-native-svg";

const ITEM_TYPES = [
  "Baby & Kids",
  "Clothing & Accessories",
  "Electronics",
  "Hobbies & Collectibles",
  "Home & Kitchen",
  "Tools & Equipment",
] as const;

const CONDITIONS = ["New / Like New", "Good", "Fair", "Well Loved"] as const;

const ORIGINAL_VALUES = [
  "Under $50",
  "$50–$199",
  "$200–$499",
  "$500–$2,000",
] as const;

type ShareMode = "isLendable" | "isSwappable" | "isRentable" | "isGift";

const SHARE_MODES: { key: ShareMode; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: "isLendable", label: "Lend", icon: "clock" },
  { key: "isRentable", label: "Rent", icon: "dollar-sign" },
  { key: "isSwappable", label: "Swap", icon: "repeat" },
  { key: "isGift", label: "Gift", icon: "gift" },
];

// AI category strings -> our ITEM_TYPES chips
const CATEGORY_MAP: Record<string, (typeof ITEM_TYPES)[number]> = {
  Electronics: "Electronics",
  Tools: "Tools & Equipment",
  Sports: "Hobbies & Collectibles",
  "Home & Garden": "Home & Kitchen",
  "Books & Media": "Hobbies & Collectibles",
  Clothing: "Clothing & Accessories",
  "Toys & Games": "Baby & Kids",
  Kitchen: "Home & Kitchen",
  Outdoor: "Hobbies & Collectibles",
};

// AI conditionRating (1-5) -> our CONDITIONS chips
function mapCondition(rating: number): (typeof CONDITIONS)[number] {
  if (rating >= 4) return "New / Like New";
  if (rating === 3) return "Good";
  if (rating === 2) return "Fair";
  return "Well Loved";
}

// AI suggestedValueRange -> our ORIGINAL_VALUES chips
const VALUE_RANGE_MAP: Record<string, (typeof ORIGINAL_VALUES)[number]> = {
  "Under $50": "Under $50",
  "$50–$150": "$50–$199",
  "$150–$300": "$200–$499",
  "$300–$1,000": "$500–$2,000",
  "$1,000–$5,000": "$500–$2,000",
  "$5,000+": "$500–$2,000",
};

interface SmartScanAnalysis {
  name: string;
  description: string;
  category: string;
  conditionRating: number;
  suggestedValueRange: string | null;
}

// ─── Matching + tier helpers ──────────────────────────────────────────────────

function isGoodMatch(listingName: string, wishlistName: string): boolean {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 2);
  const lw = normalize(listingName);
  const ww = normalize(wishlistName);
  return lw.some((w) => ww.includes(w)) || ww.some((w) => lw.includes(w));
}

function autoDetectCategory(name: string): (typeof ITEM_TYPES)[number] | "" {
  const n = name.toLowerCase();
  if (/baby|stroller|crib|diaper|toddler|kid|child|toy|pram|highchair|nursery|onesie|nappy/i.test(n))
    return "Baby & Kids";
  if (/clothing|dress|shirt|pants|jacket|coat|shoes|boots|hat|scarf|bag|purse|jewelry|watch|jeans|sneaker|hoodie|leggings|swimsuit/i.test(n))
    return "Clothing & Accessories";
  if (/phone|tablet|laptop|computer|camera|tv|speaker|headphone|console|monitor|drone|smartwatch|earbuds|router|printer/i.test(n))
    return "Electronics";
  if (/camping|tent|bike|bicycle|golf|guitar|fishing|kayak|ski|snowboard|yoga|dumbbell|board game|puzzle|lego|instrument/i.test(n))
    return "Hobbies & Collectibles";
  if (/kitchen|blender|mixer|pot|pan|vacuum|oven|microwave|fridge|coffee|couch|sofa|mattress|bed|lamp|furniture|curtain|rug/i.test(n))
    return "Home & Kitchen";
  if (/drill|saw|hammer|wrench|mower|lawn|garden|ladder|pressure washer|generator|chainsaw|sander|shovel|rake|hose/i.test(n))
    return "Tools & Equipment";
  return "";
}

function calculateTier(originalValue: string, condition: string): number {
  let tier = 1;
  if (originalValue === "Under $50") tier = 1;
  else if (originalValue === "$50–$199") tier = 2;
  else if (originalValue === "$200–$499") tier = 3;
  else if (originalValue === "$500–$2,000") tier = 4;
  if (condition === "Fair" || condition === "Well Loved") tier = Math.max(1, tier - 1);
  return tier;
}

const TIER_WEEKLY_COINS: Record<number, number> = { 1: 5, 2: 10, 3: 20, 4: 40 };
const TIER_NAMES: Record<number, string> = {
  1: "Tier 1 – Budget Friendly",
  2: "Tier 2 – Everyday Household Item",
  3: "Tier 3 – Premium Item",
  4: "Tier 4 – High Value Item",
};

// ─── Puzzle-people SVG icon ───────────────────────────────────────────────────

function PuzzlePeopleIcon({ size = 88 }: { size?: number }) {
  const h = Math.round(size * 0.625); // maintain 80:50 aspect ratio
  return (
    <Svg width={size} height={h} viewBox="0 0 80 50">
      {/* Left piece – slate blue; tab extends RIGHT to x=50 */}
      <Path
        d="M1,1 L40,1 L40,17 C40,17 50,17 50,25 C50,33 40,33 40,33 L40,49 L1,49 Z"
        fill="#6E82C8"
      />
      {/* Right piece – yellow; slot cut matching tab (also curves to x=50) */}
      <Path
        d="M40,1 L79,1 L79,49 L40,49 L40,33 C40,33 50,33 50,25 C50,17 40,17 40,17 Z"
        fill="#F5C542"
      />
      {/* Left person – head */}
      <Circle cx="19" cy="13" r="6" fill="#FAB87F" />
      {/* Left person – body */}
      <Path d="M10,38 Q10,26 19,26 Q28,26 28,38 L28,46 L10,46 Z" fill="#2B5FD9" />
      {/* Right person – head */}
      <Circle cx="59" cy="13" r="6" fill="#FAB87F" />
      {/* Right person – body */}
      <Path d="M50,38 Q50,26 59,26 Q68,26 68,38 L68,46 L50,46 Z" fill="#1F2937" />
      {/* Outer border */}
      <Rect x="1" y="1" width="78" height="48" rx="3" fill="none" stroke="#1F2937" strokeWidth="2" />
      {/* Connector outline – follows the tab edge */}
      <Path
        d="M40,1 L40,17 C40,17 50,17 50,25 C50,33 40,33 40,33 L40,49"
        fill="none"
        stroke="#1F2937"
        strokeWidth="2"
      />
    </Svg>
  );
}

// ─── Confetti burst ───────────────────────────────────────────────────────────

const CONFETTI_PALETTE = [
  "#FF6B6B", "#FFD93D", "#6BCB77", "#4D96FF",
  "#FF6B9D", "#A78BFA", "#0DCEA1", "#FB923C",
];

// Pre-generate deterministic-looking confetti pieces (seeded spread, no Math.random at render time)
const CONFETTI_PIECES = Array.from({ length: 24 }, (_, i) => ({
  left: 5 + ((i * 37 + 11) % 90),      // spread 5–95% of screen width
  delay: (i * 60) % 550,               // stagger 0–550 ms
  w: 7 + (i % 4) * 2,                  // 7–13 px wide
  h: 5 + (i % 3) * 2,                  // 5–9 px tall
  color: CONFETTI_PALETTE[i % CONFETTI_PALETTE.length],
  spinDir: i % 2 === 0 ? 1 : -1,
}));

function Confetti({ visible, screenWidth }: { visible: boolean; screenWidth: number }) {
  const anims = React.useRef(
    CONFETTI_PIECES.map(() => ({
      y: new Animated.Value(-50),
      opacity: new Animated.Value(0),
      spin: new Animated.Value(0),
    }))
  ).current;

  React.useEffect(() => {
    if (!visible) {
      anims.forEach((a) => { a.y.setValue(-50); a.opacity.setValue(0); a.spin.setValue(0); });
      return;
    }
    anims.forEach((a, i) => {
      const piece = CONFETTI_PIECES[i];
      a.y.setValue(-50);
      a.opacity.setValue(0);
      a.spin.setValue(0);
      Animated.sequence([
        Animated.delay(piece.delay),
        Animated.parallel([
          Animated.timing(a.opacity, { toValue: 1, duration: 100, useNativeDriver: true }),
          Animated.timing(a.y, { toValue: 480, duration: 1800 + (i % 5) * 200, useNativeDriver: true }),
          Animated.timing(a.spin, { toValue: piece.spinDir * 6, duration: 1800, useNativeDriver: true }),
        ]),
        Animated.timing(a.opacity, { toValue: 0, duration: 250, useNativeDriver: true }),
      ]).start();
    });
  }, [visible]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {CONFETTI_PIECES.map((piece, i) => (
        <Animated.View
          key={i}
          style={{
            position: "absolute",
            left: (piece.left / 100) * screenWidth,
            top: 0,
            width: piece.w,
            height: piece.h,
            backgroundColor: piece.color,
            borderRadius: 2,
            opacity: anims[i].opacity,
            transform: [
              { translateY: anims[i].y },
              {
                rotate: anims[i].spin.interpolate({
                  inputRange: [-6, 6],
                  outputRange: ["-1080deg", "1080deg"],
                }),
              },
            ],
          }}
        />
      ))}
    </View>
  );
}

interface MatchWishlist {
  id: number;
  userId: number;
  itemName: string;
  description?: string;
  neededDate?: string;
  returnDate?: string;
  username?: string;
  displayName?: string;
}

function MatchModal({
  visible,
  match,
  listedItem,
  colors,
  onDone,
}: {
  visible: boolean;
  match: MatchWishlist | null;
  listedItem: any;
  colors: any;
  onDone: () => void;
}) {
  const scaleAnim = React.useRef(new Animated.Value(0.85)).current;
  const opacityAnim = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scaleAnim, { toValue: 1, damping: 20, stiffness: 300, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      scaleAnim.setValue(0.85);
      opacityAnim.setValue(0);
    }
  }, [visible]);

  // Auto-notify wishlist owner as soon as the modal appears
  React.useEffect(() => {
    if (!visible || !match || !listedItem?.id) return;
    apiRequest("POST", "/api/wishlist-match-notification", {
      itemId: listedItem.id,
      wishlistId: match.id,
      wishlistOwnerId: match.userId,
    }).catch(() => {});
  }, [visible]);

  if (!match) return null;

  const requesterName = match.displayName || match.username || "your neighbour";

  const coins = (() => {
    if (match.neededDate && match.returnDate) {
      const days =
        Math.ceil(
          (new Date(match.returnDate).getTime() - new Date(match.neededDate).getTime()) /
            (1000 * 60 * 60 * 24),
        ) + 1;
      return 10 + Math.min(days, 10);
    }
    return 10;
  })();

  const screenWidth = Dimensions.get("window").width;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDone}>
      <View style={mm.overlay}>
        {/* Confetti falls over the whole overlay */}
        <Confetti visible={visible} screenWidth={screenWidth} />

        <Animated.View style={[mm.card, { opacity: opacityAnim, transform: [{ scale: scaleAnim }] }]}>
          {/* Teal header */}
          <View style={mm.header}>
            <View style={mm.iconWrap}>
              <PuzzlePeopleIcon size={88} />
            </View>
            <Text style={mm.niceText}>It's a Match!</Text>
            <Text style={mm.matchedWith}>You matched with {requesterName}</Text>
          </View>

          {/* Match details */}
          <View style={mm.body}>
            <View style={[mm.matchCard, { borderColor: "#2dd4bf", backgroundColor: "#f0fdfa" }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <Text style={mm.matchItemName} numberOfLines={1}>{match.itemName}</Text>
                <Feather name="check-circle" size={15} color="#0f766e" />
              </View>
              {match.description ? (
                <Text style={mm.matchDesc} numberOfLines={2}>{match.description}</Text>
              ) : null}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                <View style={mm.avatarRow}>
                  <View style={mm.avatar}>
                    <Text style={mm.avatarText}>{requesterName.charAt(0).toUpperCase()}</Text>
                  </View>
                  <Text style={mm.avatarName}>{requesterName}</Text>
                </View>
                {match.neededDate ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Feather name="calendar" size={13} color="#0f766e" />
                    <Text style={mm.dateText}>
                      {new Date(match.neededDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      {match.returnDate
                        ? ` – ${new Date(match.returnDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                        : ""}
                    </Text>
                  </View>
                ) : null}
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 }}>
                <Text style={{ fontSize: 20 }}>🪙</Text>
                <Text style={mm.coinsText}>Earn {coins} ShareCoins for helping!</Text>
              </View>
            </View>

            <Text style={mm.confirmText}>
              We've let them know your item matches what they're looking for. If they want it,
              they'll send you a request.
            </Text>

            <Pressable style={[mm.gotItBtn, { backgroundColor: colors.primary }]} onPress={onDone}>
              <Text style={mm.gotItText}>Got it</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

export default function ShareScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;

  const params = useLocalSearchParams<{ prefill?: string }>();

  const [choiceVisible, setChoiceVisible] = useState(true);
  const [importVisible, setImportVisible] = useState(false);
  const [importPhotos, setImportPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);

  useFocusEffect(
    useCallback(() => {
      // When arriving from "I Have This Item!", skip choice screen
      if (params.prefill) {
        setChoiceVisible(false);
        setImportVisible(false);
      } else {
        setChoiceVisible(true);
        setImportVisible(false);
        setImportPhotos([]);
      }
    }, [params.prefill])
  );

  const [photos, setPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [itemType, setItemType] = useState<string>("");
  const [condition, setCondition] = useState<string>("");
  const [originalValue, setOriginalValue] = useState<string>("");
  const [modes, setModes] = useState<Record<ShareMode, boolean>>({
    isLendable: true,
    isSwappable: false,
    isRentable: false,
    isGift: false,
  });

  // Match modal state
  const [matchModalVisible, setMatchModalVisible] = useState(false);
  const [matchedWishlist, setMatchedWishlist] = useState<MatchWishlist | null>(null);
  const [listedItem, setListedItem] = useState<any>(null);

  // Pre-fill name when arriving from wishlist "I Have This Item!"
  React.useEffect(() => {
    if (params.prefill) {
      setName(params.prefill);
      setChoiceVisible(false);
    }
  }, [params.prefill]);

  // Auto-detect category from item name when field is empty
  React.useEffect(() => {
    if (!name || itemType) return;
    const detected = autoDetectCategory(name);
    if (detected) setItemType(detected);
  }, [name]);

  function resetForm() {
    setPhotos([]);
    setName("");
    setDescription("");
    setItemType("");
    setCondition("");
    setOriginalValue("");
    setModes({ isLendable: true, isSwappable: false, isRentable: false, isGift: false });
  }

  function toggleMode(key: ShareMode) {
    setModes((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function pickPhoto() {
    if (photos.length >= 5) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Please allow photo access to add a picture of your item.");
      return;
    }
    const remaining = 5 - photos.length;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
    });
    if (!result.canceled && result.assets.length > 0) {
      setPhotos((prev) => [...prev, ...result.assets].slice(0, 5));
    }
  }

  const analyzeMutation = useMutation({
    mutationFn: async (assets: ImagePicker.ImagePickerAsset[]) => {
      const formData = new FormData();
      assets.forEach((asset, i) => {
        formData.append("photos", {
          uri: asset.uri,
          name: getImageFilename(asset, i, "screenshot"),
          type: getImageMimeType(asset),
        } as any);
      });
      const res = await apiRequest("POST", "/api/smartscan/analyze", formData);
      return res.json() as Promise<{ analysis: SmartScanAnalysis }>;
    },
    onSuccess: ({ analysis }, assets) => {
      resetForm();
      setPhotos([assets[0]]);
      setName(analysis.name || "");
      setDescription(analysis.description || "");
      setItemType(CATEGORY_MAP[analysis.category] || "");
      setCondition(mapCondition(analysis.conditionRating));
      setOriginalValue(
        (analysis.suggestedValueRange && VALUE_RANGE_MAP[analysis.suggestedValueRange]) || ""
      );
      setImportVisible(false);
    },
    onError: (error: Error) => {
      Alert.alert("Couldn't read that listing", error.message);
    },
  });

  async function pickImportScreenshots() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Please allow photo access to import a listing screenshot.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.9,
      allowsMultipleSelection: true,
      selectionLimit: 5,
    });
    if (!result.canceled && result.assets.length > 0) {
      setImportPhotos((prev) => [...prev, ...result.assets].slice(0, 5));
    }
  }

  const createItemMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Please give your item a name");
      if (!description.trim()) throw new Error("Please add a short description");
      if (!itemType) throw new Error("Please choose a category");
      if (!condition) throw new Error("Please choose a condition");
      if (!originalValue) throw new Error("Please choose an approximate value");
      if (photos.length === 0) throw new Error("Please add at least one photo");
      if (!Object.values(modes).some(Boolean)) {
        throw new Error("Please select at least one sharing option");
      }

      const formData = new FormData();
      formData.append("name", name.trim());
      formData.append("description", description.trim());
      formData.append("itemType", itemType);
      formData.append("category", itemType);
      formData.append("condition", condition);
      formData.append("originalValue", originalValue);
      Object.entries(modes).forEach(([key, value]) => {
        formData.append(key, String(value));
      });

      photos.forEach((p, i) => {
        formData.append("photos", {
          uri: p.uri,
          name: getImageFilename(p, i, "photo"),
          type: getImageMimeType(p),
        } as any);
      });

      const res = await apiRequest("POST", "/api/items", formData);
      return res.json();
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });

      // Check for wishlist matches before resetting the form (we need `name`)
      try {
        const res = await apiRequest("GET", "/api/all-wishlists");
        const wishlists: MatchWishlist[] = await res.json();
        const currentUserId = user?.id;
        const match = wishlists.find(
          (w) => w.userId !== currentUserId && isGoodMatch(name, w.itemName),
        );
        if (match) {
          setListedItem(data);
          setMatchedWishlist(match);
          resetForm();
          setMatchModalVisible(true);
          return;
        }
      } catch {
        // Matching failed silently — listing still succeeded
      }

      resetForm();
      Alert.alert("Listed!", "Your item is now live for neighbours to see.", [
        { text: "View it", onPress: () => router.push("/(tabs)") },
      ]);
    },
    onError: (error: Error) => {
      Alert.alert("Couldn't list item", error.message);
    },
  });

  if (choiceVisible) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.header,
            { paddingTop: topPad + 12, borderBottomColor: "transparent", backgroundColor: colors.primary },
          ]}
        >
          <View style={styles.headerTitleRow}>
            <Text style={[styles.title, { color: colors.foreground, flex: 1 }]}>Share</Text>
            <NotificationBell />
          </View>
        </View>

        <ScrollView contentContainerStyle={cm.fullScroll} showsVerticalScrollIndicator={false}>
          <Text style={[cm.sectionLabel, { color: colors.foreground }]}>How would you like to share?</Text>

          <Pressable
            style={[cm.option, { backgroundColor: colors.muted }]}
            onPress={() => setChoiceVisible(false)}
          >
            <View style={[cm.iconWrap, { backgroundColor: "#ccfbf1" }]}>
              <Feather name="plus" size={20} color="#0f766e" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[cm.optTitle, { color: colors.foreground }]}>List an item</Text>
              <Text style={[cm.optSub, { color: colors.mutedForeground }]}>
                Add item details or use ShareSmart Scan
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </Pressable>

          <Pressable
            style={[cm.option, { backgroundColor: colors.muted }]}
            onPress={() => {
              setChoiceVisible(false);
              setImportVisible(true);
            }}
          >
            <View style={[cm.iconWrap, { backgroundColor: "#ccfbf1" }]}>
              <Feather name="download" size={20} color="#0f766e" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[cm.optTitle, { color: colors.foreground }]}>Import a listing</Text>
              <Text style={[cm.optSub, { color: colors.mutedForeground }]}>
                Turn screenshots into a listing in seconds
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </Pressable>

          <Pressable
            style={[cm.option, { backgroundColor: colors.muted }]}
            onPress={() => {
              setChoiceVisible(false);
              router.push("/(tabs)/wishlist" as never);
            }}
          >
            <View style={[cm.iconWrap, { backgroundColor: "#ccfbf1" }]}>
              <HeartPeopleIcon size={20} color="#0f766e" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[cm.optTitle, { color: colors.foreground }]}>See what people need</Text>
              <Text style={[cm.optSub, { color: colors.mutedForeground }]}>
                Fulfill a wishlist and earn ShareCoins
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </Pressable>

          <Text style={[cm.sectionLabel, { color: colors.foreground, marginTop: 20 }]}>My ShareChest</Text>

          <Pressable
            style={[cm.option, { backgroundColor: colors.muted }]}
            onPress={() => router.push("/my-shared-items" as never)}
          >
            <View style={[cm.iconWrap, { backgroundColor: "#ccfbf1" }]}>
              <Image
                source={require("../../assets/icons/sharechest-chest.png")}
                style={{ width: 20, height: 20 }}
                resizeMode="contain"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[cm.optTitle, { color: colors.foreground }]}>Manage your shared items</Text>
              <Text style={[cm.optSub, { color: colors.mutedForeground }]}>
                View, edit, or check the status of your items.
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  if (importVisible) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View
          style={[
            im.headerRow,
            { paddingTop: topPad + 12, borderBottomColor: colors.border, backgroundColor: colors.background },
          ]}
        >
          <View style={{ flex: 1 }} />
          <NotificationBell />
          <Pressable
            onPress={() => {
              setImportVisible(false);
              setImportPhotos([]);
              setChoiceVisible(true);
            }}
            hitSlop={8}
            style={{ marginLeft: 8 }}
          >
            <Feather name="x" size={22} color={colors.mutedForeground} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={im.scroll} showsVerticalScrollIndicator={false}>
          <View style={[im.titleRow]}>
            <View style={[im.sparkleWrap, { backgroundColor: "#ccfbf1" }]}>
              <Feather name="zap" size={14} color="#0f766e" />
            </View>
            <Text
              style={[im.title, { color: colors.foreground }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.5}
              ellipsizeMode="clip"
            >
              Import Marketplace Listing
            </Text>
          </View>

          <Text style={[im.subtitle, { color: colors.mutedForeground }]}>
            Upload screenshots of your listing from any marketplace to generate a new listing.
          </Text>

          <View style={im.platformRow}>
            {["Facebook Marketplace", "Craigslist", "Poshmark", "OfferUp", "Karrot", "Any resale platform"].map(
              (platform) => (
                <View key={platform} style={[im.platformChip, { backgroundColor: "#f0fdfa", borderColor: "#99f6e4" }]}>
                  <Text style={[im.platformChipText, { color: "#0f766e" }]}>{platform}</Text>
                </View>
              )
            )}
          </View>

          <Pressable
            style={[im.dropzone, { borderColor: colors.primary, backgroundColor: colors.muted }]}
            onPress={pickImportScreenshots}
          >
            {importPhotos.length > 0 ? (
              <View style={im.thumbRow}>
                {importPhotos.map((asset, idx) => (
                  <View key={asset.assetId || asset.uri} style={im.thumbWrap}>
                    <Image source={{ uri: asset.uri }} style={im.thumb} />
                    <Pressable
                      style={[im.thumbRemove, { backgroundColor: colors.card }]}
                      onPress={() => setImportPhotos((prev) => prev.filter((_, i) => i !== idx))}
                      hitSlop={6}
                    >
                      <Feather name="x" size={12} color={colors.foreground} />
                    </Pressable>
                  </View>
                ))}
                {importPhotos.length < 5 && (
                  <View style={[im.thumbAdd, { borderColor: colors.border }]}>
                    <Feather name="plus" size={20} color={colors.mutedForeground} />
                  </View>
                )}
              </View>
            ) : (
              <>
                <View style={[im.uploadCircle, { borderColor: colors.primary }]}>
                  <Feather name="upload" size={20} color={colors.primary} />
                </View>
                <Text style={[im.dropTitle, { color: colors.foreground }]}>Drop screenshots here</Text>
                <Text style={[im.dropSub, { color: colors.mutedForeground }]}>or tap to browse your files</Text>
                <Text style={[im.dropHint, { color: colors.mutedForeground }]}>
                  Up to 5 screenshots · JPG, PNG, WEBP
                </Text>
              </>
            )}
          </Pressable>

          <Text style={[im.helper, { color: colors.mutedForeground }]}>
            Screenshots of the full listing page work best.
          </Text>

          <Pressable
            style={[
              im.scanBtn,
              {
                backgroundColor: colors.primary,
                opacity: importPhotos.length === 0 || analyzeMutation.isPending ? 0.5 : 1,
              },
            ]}
            disabled={importPhotos.length === 0 || analyzeMutation.isPending}
            onPress={() => analyzeMutation.mutate(importPhotos)}
          >
            {analyzeMutation.isPending ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <>
                <Feather name="zap" size={16} color={colors.primaryForeground} />
                <Text style={[im.scanBtnText, { color: colors.primaryForeground }]}>Scan listing</Text>
              </>
            )}
          </Pressable>

          <Pressable
            style={im.manualLink}
            onPress={() => {
              resetForm();
              setImportVisible(false);
            }}
          >
            <Feather name="edit-2" size={14} color={colors.mutedForeground} />
            <Text style={[im.manualLinkText, { color: colors.mutedForeground }]}>Enter manually instead</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  if (!user) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: topPad + 12, backgroundColor: colors.primary, borderBottomColor: "transparent" }]}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={[styles.title, { color: colors.foreground, flex: 1 }]}>Share an Item</Text>
            <NotificationBell />
          </View>
        </View>
        <View style={styles.centered}>
          <Feather name="upload" size={48} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Sign in to share</Text>
          <Pressable
            style={[styles.signInBtn, { backgroundColor: colors.primary }]}
            onPress={() => router.push("/login")}
          >
            <Text style={[styles.signInBtnText, { color: colors.primaryForeground }]}>Sign In</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { paddingTop: topPad + 12, backgroundColor: colors.primary, borderBottomColor: "transparent" },
        ]}
      >
        <View style={styles.headerTitleRow}>
          <Text style={[styles.title, { color: colors.foreground, flex: 1 }]}>Share an Item</Text>
          <NotificationBell />
        </View>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          List something to lend, rent, swap, or gift
        </Text>
      </View>

      {analyzeMutation.isPending ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Reading your screenshot…</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + (isWeb ? 34 : 0) + 100 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Photos */}
          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.foreground }]}>
              Photos <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: colors.mutedForeground }}>({photos.length}/5)</Text>
            </Text>
            {photos.length === 0 ? (
              <Pressable
                style={[styles.photoBox, { borderColor: colors.border, backgroundColor: colors.muted }]}
                onPress={pickPhoto}
              >
                <View style={styles.photoPlaceholder}>
                  <Feather name="camera" size={28} color={colors.mutedForeground} />
                  <Text style={[styles.photoText, { color: colors.mutedForeground }]}>Add up to 5 photos</Text>
                </View>
              </Pressable>
            ) : (
              <View style={[styles.photoThumbRow, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                {photos.map((p, idx) => (
                  <View key={p.assetId ?? p.uri} style={styles.photoThumbWrap}>
                    <Image source={{ uri: p.uri }} style={styles.photoThumb} />
                    <Pressable
                      style={[styles.photoThumbRemove, { backgroundColor: colors.card }]}
                      onPress={() => setPhotos((prev) => prev.filter((_, i) => i !== idx))}
                      hitSlop={6}
                    >
                      <Feather name="x" size={12} color={colors.foreground} />
                    </Pressable>
                  </View>
                ))}
                {photos.length < 5 && (
                  <Pressable
                    style={[styles.photoThumbAdd, { borderColor: colors.border }]}
                    onPress={pickPhoto}
                  >
                    <Feather name="plus" size={20} color={colors.mutedForeground} />
                  </Pressable>
                )}
              </View>
            )}
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.foreground }]}>What are you sharing?</Text>
            <TextInput
              style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card }]}
              placeholder="e.g. Cordless Drill"
              placeholderTextColor={colors.mutedForeground}
              value={name}
              onChangeText={setName}
            />
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.foreground }]}>Description</Text>
            <TextInput
              style={[
                styles.input,
                styles.textArea,
                { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card },
              ]}
              placeholder="Tell neighbours a bit about it..."
              placeholderTextColor={colors.mutedForeground}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
            />
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.foreground }]}>Category</Text>
            <View style={styles.chipRow}>
              {ITEM_TYPES.map((type) => {
                const active = itemType === type;
                return (
                  <Pressable
                    key={type}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active ? colors.primary : colors.muted,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => setItemType(type)}
                  >
                    <Text style={[styles.chipText, { color: active ? colors.primaryForeground : colors.mutedForeground }]}>
                      {type}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.foreground }]}>Condition</Text>
            <View style={styles.chipRow}>
              {CONDITIONS.map((c) => {
                const active = condition === c;
                return (
                  <Pressable
                    key={c}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active ? colors.primary : colors.muted,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => setCondition(c)}
                  >
                    <Text style={[styles.chipText, { color: active ? colors.primaryForeground : colors.mutedForeground }]}>{c}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.foreground }]}>Approximate value</Text>
            <View style={styles.chipRow}>
              {ORIGINAL_VALUES.map((v) => {
                const active = originalValue === v;
                return (
                  <Pressable
                    key={v}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active ? colors.primary : colors.muted,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => setOriginalValue(v)}
                  >
                    <Text style={[styles.chipText, { color: active ? colors.primaryForeground : colors.mutedForeground }]}>{v}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* ShareCoin tier preview */}
          {originalValue && condition ? (() => {
            const tier = calculateTier(originalValue, condition);
            const weekly = TIER_WEEKLY_COINS[tier];
            return (
              <View style={[tp.row, { backgroundColor: "#f0fdfa", borderColor: "#2dd4bf" }]}>
                <Text style={{ fontSize: 18 }}>🪙</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[tp.title, { color: "#0f766e" }]}>
                    ~{weekly} ShareCoins / week
                  </Text>
                  <Text style={[tp.sub, { color: "#0f766e" }]}>
                    {TIER_NAMES[tier]}
                  </Text>
                </View>
              </View>
            );
          })() : null}

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.foreground }]}>How do you want to share it?</Text>
            <View style={styles.modeRow}>
              {SHARE_MODES.map((m) => {
                const active = modes[m.key];
                return (
                  <Pressable
                    key={m.key}
                    style={[
                      styles.modeCard,
                      {
                        backgroundColor: active ? colors.accent : colors.card,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => toggleMode(m.key)}
                  >
                    <Feather name={m.icon} size={20} color={active ? colors.primary : colors.mutedForeground} />
                    <Text style={[styles.modeText, { color: active ? colors.primary : colors.mutedForeground }]}>
                      {m.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Pressable
            style={[styles.submitBtn, { backgroundColor: colors.primary, opacity: createItemMutation.isPending ? 0.7 : 1 }]}
            onPress={() => createItemMutation.mutate()}
            disabled={createItemMutation.isPending}
          >
            {createItemMutation.isPending ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={[styles.submitBtnText, { color: colors.primaryForeground }]}>List Item</Text>
            )}
          </Pressable>
        </ScrollView>
      )}

      {/* Wishlist match modal */}
      <MatchModal
        visible={matchModalVisible}
        match={matchedWishlist}
        listedItem={listedItem}
        colors={colors}
        onDone={() => {
          setMatchModalVisible(false);
          setMatchedWishlist(null);
          router.push("/(tabs)");
        }}
      />
    </View>
  );
}

const im = StyleSheet.create({
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  scroll: {
    padding: 20,
    gap: 14,
    paddingBottom: 60,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sparkleWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    flex: 1,
  },
  subtitle: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  platformRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 6,
    columnGap: 5,
  },
  platformChip: {
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  platformChipText: {
    fontSize: 9,
    fontFamily: "Inter_500Medium",
  },
  dropzone: {
    borderWidth: 2,
    borderStyle: "dashed",
    borderRadius: 16,
    minHeight: 130,
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
    gap: 2,
  },
  uploadCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  dropTitle: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
  },
  dropSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  dropHint: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    marginTop: 10,
  },
  thumbRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "center",
  },
  thumbWrap: {
    width: 64,
    height: 64,
    borderRadius: 10,
    overflow: "visible",
  },
  thumb: {
    width: "100%",
    height: "100%",
    borderRadius: 10,
  },
  thumbRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbAdd: {
    width: 64,
    height: 64,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  helper: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  scanBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    paddingVertical: 15,
  },
  scanBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  manualLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
  },
  manualLinkText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
});

const cm = StyleSheet.create({
  fullHeaderRow: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  fullScroll: {
    padding: 16,
    gap: 12,
  },
  heading: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 14,
    borderRadius: 14,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  optTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  optSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  sectionLabel: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.3,
    marginBottom: 8,
  },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
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
    gap: 18,
  },
  photoBox: {
    height: 160,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: "dashed",
    overflow: "hidden",
  },
  photoPreview: {
    width: "100%",
    height: "100%",
  },
  photoPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  photoText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  photoThumbRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  photoThumbWrap: {
    width: 72,
    height: 72,
    borderRadius: 10,
    overflow: "visible",
  },
  photoThumb: {
    width: 72,
    height: 72,
    borderRadius: 10,
  },
  photoThumbRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  photoThumbAdd: {
    width: 72,
    height: 72,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  field: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  textArea: {
    minHeight: 90,
    textAlignVertical: "top",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  modeRow: {
    flexDirection: "row",
    gap: 10,
  },
  modeCard: {
    flex: 1,
    alignItems: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  modeText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  submitBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 4,
  },
  submitBtnText: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    padding: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
  },
  signInBtn: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 14,
  },
  signInBtnText: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
});

// Tier preview row
const tp = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  title: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  sub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 1,
  },
});

// Match modal
const mm = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: "#fff",
    borderRadius: 20,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 12,
  },
  header: {
    backgroundColor: "#0f766e",
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: "center",
    gap: 6,
  },
  iconWrap: {
    marginBottom: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  niceText: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: "#fff",
    textAlign: "center",
  },
  matchedWith: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.9)",
    textAlign: "center",
  },
  body: {
    padding: 20,
    gap: 14,
  },
  matchCard: {
    borderWidth: 2,
    borderRadius: 14,
    padding: 14,
  },
  matchItemName: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: "#111827",
    flex: 1,
  },
  matchDesc: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#6b7280",
    marginBottom: 4,
  },
  avatarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#0f766e",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#fff",
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  avatarName: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#374151",
  },
  dateText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#0f766e",
  },
  coinsText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: "#0f766e",
  },
  confirmText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#6b7280",
    textAlign: "center",
    lineHeight: 20,
  },
  gotItBtn: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 4,
  },
  gotItText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
});
