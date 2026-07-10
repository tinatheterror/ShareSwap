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

  useFocusEffect(
    useCallback(() => {
      setChoiceVisible(true);
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
    mutationFn: async (asset: ImagePicker.ImagePickerAsset) => {
      const formData = new FormData();
      const uriParts = asset.uri.split(".");
      const fileExt = uriParts[uriParts.length - 1] || "jpg";
      formData.append("photos", {
        uri: asset.uri,
        name: `screenshot.${fileExt}`,
        type: `image/${fileExt === "jpg" ? "jpeg" : fileExt}`,
      } as any);
      const res = await apiRequest("POST", "/api/smartscan/analyze", formData);
      return res.json() as Promise<{ analysis: SmartScanAnalysis }>;
    },
    onSuccess: ({ analysis }, asset) => {
      resetForm();
      setPhoto(asset);
      setName(analysis.name || "");
      setDescription(analysis.description || "");
      setItemType(CATEGORY_MAP[analysis.category] || "");
      setCondition(mapCondition(analysis.conditionRating));
      setOriginalValue(
        (analysis.suggestedValueRange && VALUE_RANGE_MAP[analysis.suggestedValueRange]) || ""
      );
    },
    onError: (error: Error) => {
      Alert.alert("Couldn't read that image", error.message);
    },
  });

  async function pickImportScreenshot() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Please allow photo access to import a listing screenshot.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.9,
    });
    if (!result.canceled && result.assets.length > 0) {
      setChoiceVisible(false);
      analyzeMutation.mutate(result.assets[0]);
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
            { paddingTop: topPad + 12, borderBottomColor: colors.border, backgroundColor: colors.background },
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
            onPress={pickImportScreenshot}
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

  if (!user) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
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
          { paddingTop: topPad + 12, backgroundColor: colors.background, borderBottomColor: colors.border },
        ]}
      >
        <Text style={[styles.title, { color: colors.foreground }]}>Share an Item</Text>
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
    fontSize: 15,
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
