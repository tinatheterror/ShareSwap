import React from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Coins, Users, Gamepad2, HeartHandshake } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentBalance: number;
  required: number;
  context?: "borrow" | "swap";
  /** Called when an earn route is tapped, before navigation — use to close parent sheets/modals */
  onBeforeNavigate?: () => void;
}

export function InsufficientShareCoinsModal({
  isOpen,
  onClose,
  currentBalance,
  required,
  context = "borrow",
  onBeforeNavigate,
}: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const shortfall = Math.max(0, required - currentBalance);

  function navigate(target: () => void) {
    // Close this modal and any parent sheet first, then wait for
    // all modal animations to finish before pushing the new route.
    onClose();
    onBeforeNavigate?.();
    setTimeout(target, 350);
  }

  const earnRoutes = [
    {
      Icon: Users,
      label: "Invite friends",
      sub: "Get coins instantly when they join",
      onPress: () => navigate(() => router.push("/referrals" as never)),
    },
    {
      Icon: Gamepad2,
      label: "Play games",
      sub: "Earn coins in minutes",
      onPress: () => navigate(() => router.push("/(tabs)/games" as never)),
    },
    {
      Icon: HeartHandshake,
      label: "Help neighbours",
      sub: "Lend items to earn coins",
      onPress: () => navigate(() => router.push({ pathname: "/(tabs)/wishlist", params: { tab: "community" } } as never)),
    },
  ];

  return (
    <Modal
      visible={isOpen}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={[s.centeredView, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={s.card}>
          {/* ── Amber header ── */}
          <View style={s.header}>
            <Pressable style={s.closeBtn} onPress={onClose} hitSlop={8}>
              <Text style={s.closeBtnText}>✕</Text>
            </Pressable>
            <View style={s.coinCircle}>
              <Coins size={28} color="#fff" strokeWidth={2} />
            </View>
            <Text style={s.headerTitle}>Not enough ShareCoins</Text>
          </View>

          {/* ── Body ── */}
          <View style={s.body}>
            {/* Shortfall */}
            <View style={s.shortfallBox}>
              <Text style={s.shortfallText}>
                You need{" "}
                <Text style={s.shortfallHighlight}>{shortfall} more</Text>
                {" "}to {context === "borrow" ? "borrow this item" : "complete this swap"}.
              </Text>
              <Text style={s.balanceText}>
                Your balance:{" "}
                <Text style={s.balanceBold}>{currentBalance} ShareCoins</Text>
              </Text>
            </View>

            {/* Earn routes */}
            <Text style={s.earnLabel}>GET MORE SHARECOINS</Text>

            {earnRoutes.map(({ Icon, label, sub, onPress }) => (
              <Pressable
                key={label}
                style={({ pressed }) => [s.earnRow, pressed && s.earnRowPressed]}
                onPress={onPress}
              >
                <View style={s.earnIconWrap}>
                  <Icon size={16} color="#0DCEA1" strokeWidth={2} />
                </View>
                <View style={s.earnText}>
                  <Text style={s.earnTitle}>{label}</Text>
                  <Text style={s.earnSub}>{sub}</Text>
                </View>
              </Pressable>
            ))}

            {/* Dismiss */}
            <Pressable
              style={({ pressed }) => [s.laterBtn, pressed && { opacity: 0.6 }]}
              onPress={onClose}
            >
              <Text style={s.laterText}>Maybe later</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const AMBER = "#F59E0B";

const s = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  centeredView: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
  },

  /* Header */
  header: {
    backgroundColor: AMBER,
    paddingTop: 28,
    paddingBottom: 24,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  closeBtn: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  coinCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  headerTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    fontFamily: "Inter_700Bold",
  },

  /* Body */
  body: {
    padding: 20,
  },
  shortfallBox: {
    alignItems: "center",
    marginBottom: 18,
    gap: 4,
  },
  shortfallText: {
    fontSize: 15,
    color: "#1f2937",
    fontWeight: "500",
    textAlign: "center",
    fontFamily: "Inter_500Medium",
  },
  shortfallHighlight: {
    color: "#F97316",
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  balanceText: {
    fontSize: 13,
    color: "#9ca3af",
    textAlign: "center",
    fontFamily: "Inter_400Regular",
  },
  balanceBold: {
    fontWeight: "600",
    color: "#374151",
    fontFamily: "Inter_600SemiBold",
  },

  /* Earn routes */
  earnLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#0DCEA1",
    letterSpacing: 0.8,
    marginBottom: 8,
    fontFamily: "Inter_700Bold",
  },
  earnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#f3f4f6",
    marginBottom: 6,
  },
  earnRowPressed: {
    borderColor: "#99f6e4",
    backgroundColor: "#f0fdf9",
  },
  earnIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#f0fdf9",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  earnText: {
    flex: 1,
  },
  earnTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1f2937",
    fontFamily: "Inter_600SemiBold",
  },
  earnSub: {
    fontSize: 12,
    color: "#9ca3af",
    marginTop: 1,
    fontFamily: "Inter_400Regular",
  },

  /* Dismiss */
  laterBtn: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 4,
  },
  laterText: {
    fontSize: 14,
    color: "#9ca3af",
    fontFamily: "Inter_400Regular",
  },
});
