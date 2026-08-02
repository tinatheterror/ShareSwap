import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiRequest, photoUrl } from "@/lib/api";
import { NotificationBell } from "@/components/NotificationBell";

// ─── Constants ──────────────────────────────────────────────────────────────

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

// ─── Types ──────────────────────────────────────────────────────────────────

interface ItemDetail {
  id: number;
  name: string;
  description?: string | null;
  itemType?: string | null;
  condition?: string | null;
  originalValue?: string | null;
  photos: string[];
  isLendable?: boolean;
  isRentable?: boolean;
  isSwappable?: boolean;
  isGift?: boolean;
}

// ─── Screen ─────────────────────────────────────────────────────────────────

export default function EditItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const queryClient = useQueryClient();

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [itemType, setItemType] = useState("");
  const [condition, setCondition] = useState("");
  const [originalValue, setOriginalValue] = useState("");
  const [modes, setModes] = useState<Record<ShareMode, boolean>>({
    isLendable: true,
    isSwappable: false,
    isRentable: false,
    isGift: false,
  });
  // New photos picked from library (appended to existing)
  const [newPhotos, setNewPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);
  // Existing photo keys from server (ones not removed)
  const [existingPhotos, setExistingPhotos] = useState<string[]>([]);

  const [initialized, setInitialized] = useState(false);

  // Fetch item data
  const { data: item, isLoading, isError } = useQuery<ItemDetail>({
    queryKey: [`/api/items/${id}`],
    queryFn: () => apiGet<ItemDetail>(`/api/items/${id}`),
    enabled: !!id,
  });

  // Pre-fill form once item loads
  useEffect(() => {
    if (item && !initialized) {
      setName(item.name ?? "");
      setDescription(item.description ?? "");
      setItemType(item.itemType ?? "");
      setCondition(item.condition ?? "");
      setOriginalValue(item.originalValue ?? "");
      setModes({
        isLendable: item.isLendable ?? false,
        isSwappable: item.isSwappable ?? false,
        isRentable: item.isRentable ?? false,
        isGift: item.isGift ?? false,
      });
      setExistingPhotos(item.photos ?? []);
      setInitialized(true);
    }
  }, [item, initialized]);

  function toggleMode(key: ShareMode) {
    setModes((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function addPhoto() {
    const totalPhotos = existingPhotos.length + newPhotos.length;
    if (totalPhotos >= 5) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Please allow photo access to add photos.");
      return;
    }
    const remaining = 5 - totalPhotos;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
    });
    if (!result.canceled && result.assets.length > 0) {
      setNewPhotos((prev) => [...prev, ...result.assets].slice(0, 5 - existingPhotos.length));
    }
  }

  const updateItemMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Please give your item a name");
      if (!description.trim()) throw new Error("Please add a short description");
      if (!itemType) throw new Error("Please choose a category");
      if (!condition) throw new Error("Please choose a condition");
      if (!originalValue) throw new Error("Please choose an approximate value");
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

      // Preserve any existing photos not removed
      if (existingPhotos.length > 0) {
        formData.append("existingPhotos", JSON.stringify(existingPhotos));
      }
      // Append newly picked photos
      newPhotos.forEach((p, i) => {
        const uriParts = p.uri.split(".");
        const fileExt = uriParts[uriParts.length - 1] || "jpg";
        formData.append("photos", {
          uri: p.uri,
          name: `photo-${i}.${fileExt}`,
          type: `image/${fileExt === "jpg" ? "jpeg" : fileExt}`,
        } as any);
      });

      const res = await apiRequest("PATCH", `/api/items/${id}`, formData);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-items"] });
      queryClient.invalidateQueries({ queryKey: [`/api/items/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      Alert.alert("Saved!", "Your item has been updated.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    },
    onError: (error: Error) => {
      Alert.alert("Couldn't save changes", error.message);
    },
  });

  const totalPhotoCount = existingPhotos.length + newPhotos.length;

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 12, backgroundColor: colors.primary }]}>
          <View style={styles.headerRow}>
            <Pressable onPress={() => router.back()} hitSlop={8}>
              <Feather name="chevron-left" size={24} color={colors.foreground} />
            </Pressable>
            <Text style={[styles.headerTitle, { color: colors.foreground, flex: 1 }]}>Edit Item</Text>
            <NotificationBell />
          </View>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  if (isError || !item) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 12, backgroundColor: colors.primary }]}>
          <View style={styles.headerRow}>
            <Pressable onPress={() => router.back()} hitSlop={8}>
              <Feather name="chevron-left" size={24} color={colors.foreground} />
            </Pressable>
            <Text style={[styles.headerTitle, { color: colors.foreground, flex: 1 }]}>Edit Item</Text>
            <NotificationBell />
          </View>
        </View>
        <View style={styles.centered}>
          <Feather name="alert-circle" size={40} color={colors.mutedForeground} />
          <Text style={[styles.errorText, { color: colors.mutedForeground }]}>Couldn't load item</Text>
          <Pressable style={[styles.backBtn, { backgroundColor: colors.primary }]} onPress={() => router.back()}>
            <Text style={[styles.backBtnText, { color: colors.primaryForeground }]}>Go Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12, backgroundColor: colors.primary }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Feather name="chevron-left" size={24} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.foreground, flex: 1 }]}>Edit Item</Text>
          <NotificationBell />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Photos */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>
            Photos{" "}
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: colors.mutedForeground }}>
              ({totalPhotoCount}/5)
            </Text>
          </Text>
          {totalPhotoCount === 0 ? (
            <Pressable
              style={[styles.photoBox, { borderColor: colors.border, backgroundColor: colors.muted }]}
              onPress={addPhoto}
            >
              <View style={styles.photoPlaceholder}>
                <Feather name="camera" size={28} color={colors.mutedForeground} />
                <Text style={[styles.photoText, { color: colors.mutedForeground }]}>Add up to 5 photos</Text>
              </View>
            </Pressable>
          ) : (
            <View style={[styles.thumbRow, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              {existingPhotos.map((key, idx) => (
                <View key={key} style={styles.thumbWrap}>
                  <Image source={{ uri: photoUrl(key) ?? key }} style={styles.thumb} />
                  <Pressable
                    style={[styles.thumbRemove, { backgroundColor: colors.card }]}
                    onPress={() => setExistingPhotos((prev) => prev.filter((_, i) => i !== idx))}
                    hitSlop={6}
                  >
                    <Feather name="x" size={12} color={colors.foreground} />
                  </Pressable>
                </View>
              ))}
              {newPhotos.map((p, idx) => (
                <View key={p.assetId ?? p.uri} style={styles.thumbWrap}>
                  <Image source={{ uri: p.uri }} style={styles.thumb} />
                  <Pressable
                    style={[styles.thumbRemove, { backgroundColor: colors.card }]}
                    onPress={() => setNewPhotos((prev) => prev.filter((_, i) => i !== idx))}
                    hitSlop={6}
                  >
                    <Feather name="x" size={12} color={colors.foreground} />
                  </Pressable>
                </View>
              ))}
              {totalPhotoCount < 5 && (
                <Pressable
                  style={[styles.thumbAdd, { borderColor: colors.border }]}
                  onPress={addPhoto}
                >
                  <Feather name="plus" size={20} color={colors.mutedForeground} />
                </Pressable>
              )}
            </View>
          )}
        </View>

        {/* Name */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>Item name</Text>
          <TextInput
            style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card }]}
            placeholder="e.g. Cordless Drill"
            placeholderTextColor={colors.mutedForeground}
            value={name}
            onChangeText={setName}
          />
        </View>

        {/* Description */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.foreground }]}>Description</Text>
          <TextInput
            style={[styles.input, styles.textArea, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card }]}
            placeholder="Tell neighbours a bit about it..."
            placeholderTextColor={colors.mutedForeground}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={4}
          />
        </View>

        {/* Category */}
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

        {/* Condition */}
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
                  <Text style={[styles.chipText, { color: active ? colors.primaryForeground : colors.mutedForeground }]}>
                    {c}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Approximate value */}
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
                  <Text style={[styles.chipText, { color: active ? colors.primaryForeground : colors.mutedForeground }]}>
                    {v}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Share modes */}
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

        {/* Save button */}
        <Pressable
          style={[styles.submitBtn, { backgroundColor: colors.primary, opacity: updateItemMutation.isPending ? 0.7 : 1 }]}
          onPress={() => updateItemMutation.mutate()}
          disabled={updateItemMutation.isPending}
        >
          {updateItemMutation.isPending ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={[styles.submitBtnText, { color: colors.primaryForeground }]}>Save Changes</Text>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    marginLeft: 4,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  errorText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  backBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 4,
  },
  backBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  scroll: {
    padding: 16,
    gap: 16,
  },
  photoBox: {
    height: 160,
    borderRadius: 16,
    borderWidth: 1.5,
    overflow: "hidden",
  },
  photoPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  photoText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  thumbRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  thumbWrap: {
    width: 72,
    height: 72,
    borderRadius: 10,
    overflow: "visible",
  },
  thumb: {
    width: 72,
    height: 72,
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
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: "top",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  modeRow: {
    flexDirection: "row",
    gap: 8,
  },
  modeCard: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    gap: 4,
  },
  modeText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  submitBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  submitBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
});
