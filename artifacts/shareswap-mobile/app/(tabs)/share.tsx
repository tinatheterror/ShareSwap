import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import React, { useCallback, useState } from "react";
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
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { HeartPeopleIcon } from "@/components/HeartPeopleIcon";
import { NotificationBell } from "@/components/NotificationBell";

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

export default function ShareScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;

  const [choiceVisible, setChoiceVisible] = useState(true);
  const [importVisible, setImportVisible] = useState(false);
  const [importPhotos, setImportPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);

  useFocusEffect(
    useCallback(() => {
      setChoiceVisible(true);
      setImportVisible(false);
      setImportPhotos([]);
    }, [])
  );

  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
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

  function resetForm() {
    setPhoto(null);
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
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Please allow photo access to add a picture of your item.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsEditing: true,
      aspect: [4, 3],
    });
    if (!result.canceled && result.assets.length > 0) {
      setPhoto(result.assets[0]);
    }
  }

  const analyzeMutation = useMutation({
    mutationFn: async (assets: ImagePicker.ImagePickerAsset[]) => {
      const formData = new FormData();
      assets.forEach((asset, i) => {
        const uriParts = asset.uri.split(".");
        const fileExt = uriParts[uriParts.length - 1] || "jpg";
        formData.append("photos", {
          uri: asset.uri,
          name: `screenshot-${i}.${fileExt}`,
          type: `image/${fileExt === "jpg" ? "jpeg" : fileExt}`,
        } as any);
      });
      const res = await apiRequest("POST", "/api/smartscan/analyze", formData);
      return res.json() as Promise<{ analysis: SmartScanAnalysis }>;
    },
    onSuccess: ({ analysis }, assets) => {
      resetForm();
      setPhoto(assets[0]);
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
      if (!photo) throw new Error("Please add at least one photo");
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

      const uriParts = photo.uri.split(".");
      const fileExt = uriParts[uriParts.length - 1] || "jpg";
      formData.append("photos", {
        uri: photo.uri,
        name: `photo.${fileExt}`,
        type: `image/${fileExt === "jpg" ? "jpeg" : fileExt}`,
      } as any);

      const res = await apiRequest("POST", "/api/items", formData);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
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
            cm.fullHeaderRow,
            { paddingTop: topPad + 12, borderBottomColor: "transparent", backgroundColor: colors.primary },
          ]}
        >
          <Text style={[cm.heading, { color: colors.foreground }]}>How would you like to share?</Text>
        </View>

        <ScrollView contentContainerStyle={cm.fullScroll} showsVerticalScrollIndicator={false}>
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
          <View style={{ width: 24 }} />
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => {
              setImportVisible(false);
              setImportPhotos([]);
              setChoiceVisible(true);
            }}
            hitSlop={8}
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
          <Text style={[styles.title, { color: colors.foreground }]}>Share an Item</Text>
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
        <View style={styles.headerRow}>
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
          <Pressable
            style={[styles.photoBox, { borderColor: colors.border, backgroundColor: colors.muted }]}
            onPress={pickPhoto}
          >
            {photo ? (
              <Image source={{ uri: photo.uri }} style={styles.photoPreview} />
            ) : (
              <View style={styles.photoPlaceholder}>
                <Feather name="camera" size={28} color={colors.mutedForeground} />
                <Text style={[styles.photoText, { color: colors.mutedForeground }]}>Add a photo</Text>
              </View>
            )}
          </Pressable>

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
    </View>
  );
}

const im = StyleSheet.create({
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
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
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
    height: 180,
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
