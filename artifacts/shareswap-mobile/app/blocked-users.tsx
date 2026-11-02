import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack } from "expo-router";
import React from "react";
import { ActivityIndicator, Alert, FlatList, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { photoUrl } from "@/lib/api";
import { affectedByBlock, fetchBlockedUsers, moderationErrorMessage, unblockUser, type BlockedUser } from "@/lib/moderation";

export default function BlockedUsersScreen() {
  const colors = useColors();
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery<BlockedUser[]>({ queryKey: ["/api/blocks"], queryFn: fetchBlockedUsers });

  const unblock = useMutation({
    mutationFn: (userId: number) => unblockUser(userId),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => affectedByBlock(q.queryKey) }),
    onError: (err) => Alert.alert("Couldn't unblock", moderationErrorMessage(err)),
  });

  function confirmUnblock(person: BlockedUser) {
    const name = person.displayName || person.username;
    Alert.alert(`Unblock ${name}?`, "You'll be able to see each other's listings and profile again, and send messages and requests.", [
      { text: "Cancel", style: "cancel" },
      { text: "Unblock", onPress: () => unblock.mutate(person.userId) },
    ]);
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: "Blocked users" }} />
      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : error ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>{moderationErrorMessage(error)}</Text>
          <Pressable onPress={() => refetch()} accessibilityRole="button"><Text style={[styles.retry, { color: colors.primary }]}>Try again</Text></Pressable>
        </View>
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(person) => String(person.userId)}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            (data?.length ?? 0) > 0 ? (
              <Text style={[styles.intro, { color: colors.mutedForeground }]}>
                People you block can't see your listings or profile, and can't message you or send you requests.
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.empty} testID="blocked-users-empty">
              <Feather name="shield" size={36} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>You haven't blocked anyone.</Text>
            </View>
          }
          renderItem={({ item: person }) => {
            const name = person.displayName || person.username;
            return (
              <View style={[styles.row, { borderColor: colors.border, backgroundColor: colors.card }]} testID={`blocked-user-${person.userId}`}>
                {person.profilePhoto ? (
                  <Image source={{ uri: photoUrl(person.profilePhoto) }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, { backgroundColor: colors.primary + "25", alignItems: "center", justifyContent: "center" }]}>
                    <Text style={{ color: colors.primary, fontFamily: "Inter_700Bold" }}>{name.charAt(0).toUpperCase()}</Text>
                  </View>
                )}
                <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>{name}</Text>
                <Pressable
                  testID={`unblock-${person.userId}`}
                  accessibilityRole="button"
                  disabled={unblock.isPending}
                  onPress={() => confirmUnblock(person)}
                  style={[styles.unblockBtn, { borderColor: colors.border, opacity: unblock.isPending ? 0.5 : 1 }]}
                >
                  <Text style={[styles.unblockText, { color: colors.foreground }]}>Unblock</Text>
                </Pressable>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 16, gap: 10 },
  intro: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular", marginBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderWidth: 1, borderRadius: 14 },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  name: { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold" },
  unblockBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  unblockText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  empty: { alignItems: "center", gap: 12, paddingTop: 64, paddingHorizontal: 32 },
  emptyText: { fontSize: 15, fontFamily: "Inter_500Medium", textAlign: "center" },
  retry: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
