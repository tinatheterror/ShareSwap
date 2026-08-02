import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPost } from "@/lib/api";

interface NudgeStatus {
  hasSeenNudge: boolean;
  isVerified: boolean;
}

/**
 * Mirrors the web's VerificationNudge component in verification-nudge.tsx.
 * Fetches GET /api/verification-nudge-status and shows a one-time prompt
 * for users who haven't completed full verification (email + ID + payment).
 * Dismissed via POST /api/verification-nudge-dismiss (sets hasSeenNudge=true).
 */
export function VerificationNudge() {
  const { user } = useAuth();
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: nudge, isLoading } = useQuery<NudgeStatus>({
    queryKey: ["/api/verification-nudge-status"],
    queryFn: () => apiGet("/api/verification-nudge-status"),
    enabled: !!user,
  });

  const dismissMutation = useMutation({
    mutationFn: () => apiPost("/api/verification-nudge-dismiss"),
    onSuccess: () => {
      queryClient.setQueryData<NudgeStatus>(["/api/verification-nudge-status"], (prev) =>
        prev ? { ...prev, hasSeenNudge: true } : prev
      );
    },
  });

  // Don't show if: loading, no user, already seen, already fully verified
  if (!user || isLoading || !nudge || nudge.hasSeenNudge || nudge.isVerified) {
    return null;
  }

  function handleVerifyNow() {
    dismissMutation.mutate();
    router.push("/verification" as never);
  }

  function handleDismiss() {
    dismissMutation.mutate();
  }

  return (
    <View style={[styles.banner, { backgroundColor: "#f0fdfa", borderBottomColor: "#99f6e4" }]}>
      <View style={[styles.iconWrap, { backgroundColor: "#ccfbf1" }]}>
        <Feather name="shield" size={16} color="#0d9488" />
      </View>

      <View style={styles.body}>
        <Text style={[styles.title, { color: "#134e4a" }]}>Verify your account</Text>
        <Text style={[styles.sub, { color: "#0f766e" }]}>
          Verified members can borrow and rent items from neighbours.
        </Text>
      </View>

      <Pressable
        style={({ pressed }) => [styles.verifyBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
        onPress={handleVerifyNow}
        disabled={dismissMutation.isPending}
      >
        <Text style={styles.verifyBtnText}>Verify</Text>
      </Pressable>

      <Pressable
        onPress={handleDismiss}
        disabled={dismissMutation.isPending}
        hitSlop={10}
        style={({ pressed }) => [styles.closeBtn, { opacity: pressed ? 0.5 : 1 }]}
      >
        {dismissMutation.isPending
          ? <ActivityIndicator size="small" color="#0f766e" />
          : <Feather name="x" size={16} color="#0f766e" />
        }
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 10,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  body: {
    flex: 1,
  },
  title: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  sub: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    lineHeight: 15,
    marginTop: 1,
  },
  verifyBtn: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexShrink: 0,
  },
  verifyBtnText: {
    color: "#fff",
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  closeBtn: {
    flexShrink: 0,
    width: 24,
    alignItems: "center",
    justifyContent: "center",
  },
});
