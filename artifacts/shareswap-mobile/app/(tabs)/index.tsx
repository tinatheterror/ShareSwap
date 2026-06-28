import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import React, { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
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
import { ItemCard, Item } from "@/components/ItemCard";
import { ShareCoinBadge } from "@/components/ShareCoinBadge";
import { apiGet } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "expo-router";

const CATEGORIES = [
  { label: "All", icon: "grid" as const },
  { label: "Tools", icon: "tool" as const },
  { label: "Kitchen", icon: "coffee" as const },
  { label: "Sports", icon: "activity" as const },
  { label: "Books", icon: "book" as const },
  { label: "Garden", icon: "feather" as const },
  { label: "Tech", icon: "cpu" as const },
];

const SHARE_TYPES = ["All", "Borrow", "Rent", "Swap", "Gift"];

export default function BrowseScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const router = useRouter();
  const isWeb = Platform.OS === "web";

  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [selectedType, setSelectedType] = useState("All");
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery<Item[]>({
    queryKey: ["/api/items", selectedCategory, selectedType],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedCategory !== "All") params.set("category", selectedCategory);
      if (selectedType !== "All")
        params.set("shareType", selectedType.toLowerCase());
      return apiGet<Item[]>(`/api/items?${params.toString()}`);
    },
  });

  const items =
    data?.filter((item) =>
      search.trim()
        ? item.title.toLowerCase().includes(search.toLowerCase())
        : true,
    ) ?? [];

  async function handleRefresh() {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }

  const topPad = isWeb ? 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad + 12,
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <View style={styles.headerTop}>
          <View>
            <Text style={[styles.greeting, { color: colors.mutedForeground }]}>
              Hello, {user?.displayName ?? user?.username ?? "neighbour"} 👋
            </Text>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>
              Browse Items
            </Text>
          </View>
          <ShareCoinBadge />
        </View>

        <View
          style={[
            styles.searchBar,
            { backgroundColor: colors.muted, borderColor: colors.border },
          ]}
        >
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            style={[styles.searchInput, { color: colors.foreground }]}
            placeholder="Search items..."
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")}>
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categories}
        >
          {CATEGORIES.map((cat) => {
            const active = selectedCategory === cat.label;
            return (
              <Pressable
                key={cat.label}
                style={[
                  styles.categoryChip,
                  {
                    backgroundColor: active
                      ? colors.primary
                      : colors.muted,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => setSelectedCategory(cat.label)}
              >
                <Feather
                  name={cat.icon}
                  size={13}
                  color={active ? "#fff" : colors.mutedForeground}
                />
                <Text
                  style={[
                    styles.categoryText,
                    { color: active ? "#fff" : colors.mutedForeground },
                  ]}
                >
                  {cat.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.types}
        >
          {SHARE_TYPES.map((t) => {
            const active = selectedType === t;
            return (
              <Pressable
                key={t}
                style={[
                  styles.typeChip,
                  {
                    backgroundColor: active ? colors.accent : "transparent",
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => setSelectedType(t)}
              >
                <Text
                  style={[
                    styles.typeText,
                    { color: active ? colors.primary : colors.mutedForeground },
                  ]}
                >
                  {t}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.centered}>
          <Feather name="package" size={48} color={colors.mutedForeground} />
          <Text
            style={[styles.emptyTitle, { color: colors.foreground }]}
          >
            No items found
          </Text>
          <Text
            style={[styles.emptyText, { color: colors.mutedForeground }]}
          >
            Try a different filter or check back later
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => <ItemCard item={item} />}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + (isWeb ? 34 : 0) + 90 },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  greeting: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  headerTitle: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  categories: {
    gap: 8,
    paddingRight: 4,
  },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  categoryText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  types: {
    gap: 8,
    paddingRight: 4,
  },
  typeChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  typeText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  list: {
    padding: 16,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
});
