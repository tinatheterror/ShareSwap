/**
 * LevelUpBanner
 * Polls notifications every 120 s and shows a slide-down banner for new
 * level_up notifications — matching web's background-polling.tsx toast
 * (title 🎉 {notif.title}, message, duration 8 s).
 */
import React, { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { apiGet } from "@/lib/api";

interface Notification {
  id: number;
  type: string;
  title?: string | null;
  message: string;
}

interface Banner {
  id: number;
  title: string;
  message: string;
  slideAnim: Animated.Value;
}

let _bannerId = 0;
const POLL_MS = 120_000;

export function LevelUpBanner() {
  const { user } = useAuth();
  const seededRef = useRef(false);
  const seenIdsRef = useRef<Set<number>>(new Set());
  const [banners, setBanners] = useState<Banner[]>([]);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!user) return;

    async function poll() {
      try {
        const notifs = await apiGet<Notification[]>("/api/notifications");
        const levelUps = notifs.filter((n) => n.type === "level_up");

        if (!seededRef.current) {
          // First run: seed existing IDs so we don't re-toast old ones
          levelUps.forEach((n) => seenIdsRef.current.add(n.id));
          seededRef.current = true;
          return;
        }

        const fresh = levelUps.filter((n) => !seenIdsRef.current.has(n.id));
        fresh.forEach((n) => seenIdsRef.current.add(n.id));

        for (const notif of fresh) {
          showBanner(
            `🎉 ${notif.title ?? "Level up!"}`,
            notif.message,
          );
        }
      } catch {
        // Silently ignore network errors during background poll
      }
    }

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => clearInterval(interval);
  }, [user?.id]);

  function showBanner(title: string, message: string) {
    const slideAnim = new Animated.Value(-120);
    const id = ++_bannerId;

    setBanners((prev) => [...prev, { id, title, message, slideAnim }]);

    Animated.sequence([
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 60,
        friction: 10,
      }),
      Animated.delay(6000),
      Animated.timing(slideAnim, {
        toValue: -120,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setBanners((prev) => prev.filter((b) => b.id !== id));
    });
  }

  function dismiss(id: number) {
    setBanners((prev) => prev.filter((b) => b.id !== id));
  }

  if (banners.length === 0) return null;

  return (
    <View
      style={[styles.container, { top: insets.top + 8 }]}
      pointerEvents="box-none"
    >
      {banners.map((banner) => (
        <Animated.View
          key={banner.id}
          style={[
            styles.banner,
            { transform: [{ translateY: banner.slideAnim }] },
          ]}
        >
          <Pressable
            style={styles.bannerInner}
            onPress={() => dismiss(banner.id)}
          >
            <Text style={styles.bannerTitle}>{banner.title}</Text>
            <Text style={styles.bannerMessage} numberOfLines={2}>
              {banner.message}
            </Text>
          </Pressable>
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 9998,
    gap: 8,
  },
  banner: {
    backgroundColor: "#1a1a2e",
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
    borderWidth: 1,
    borderColor: "#a855f720",
  },
  bannerInner: {
    padding: 16,
    gap: 4,
  },
  bannerTitle: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    color: "#fff",
  },
  bannerMessage: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.75)",
    lineHeight: 18,
  },
});
