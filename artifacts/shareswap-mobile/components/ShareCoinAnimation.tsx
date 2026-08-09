/**
 * ShareCoinAnimation
 * Global overlay that triggers whenever the user's ShareCoin balance increases.
 * Matches web's sharecoin-animation.tsx: large 🪙 emoji + "+N" text that
 * floats up and fades out over 2 seconds.
 */
import { useQuery } from "@tanstack/react-query";
import React, { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { apiGet } from "@/lib/api";

interface UserCoins {
  shareCoins?: number | null;
}

interface Drop {
  id: number;
  amount: number;
  anim: Animated.Value;
  opacity: Animated.Value;
}

let _dropId = 0;

export function ShareCoinAnimation() {
  const { user } = useAuth();
  const prevCoinsRef = useRef<number | null>(null);
  const [drops, setDrops] = useState<Drop[]>([]);

  // Poll /api/user every 30 s — same staleTime as the rest of the app
  const { data: freshUser } = useQuery<UserCoins>({
    queryKey: ["/api/user"],
    queryFn: () => apiGet<UserCoins>("/api/user"),
    enabled: !!user,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  useEffect(() => {
    const coins = Math.round(Number(freshUser?.shareCoins ?? 0));
    if (prevCoinsRef.current === null) {
      prevCoinsRef.current = coins;
      return;
    }
    const delta = coins - prevCoinsRef.current;
    prevCoinsRef.current = coins;

    if (delta <= 0) return;

    // Spawn a drop
    const anim = new Animated.Value(0);    // 0 = start pos, 1 = end pos
    const opacity = new Animated.Value(1);
    const id = ++_dropId;

    setDrops((prev) => [...prev, { id, amount: delta, anim, opacity }]);

    Animated.parallel([
      Animated.timing(anim, {
        toValue: 1,
        duration: 2000,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.delay(1000),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]),
    ]).start(() => {
      setDrops((prev) => prev.filter((d) => d.id !== id));
    });
  }, [freshUser?.shareCoins]);

  if (drops.length === 0) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {drops.map((drop) => {
        const translateY = drop.anim.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -160],
        });
        const scale = drop.anim.interpolate({
          inputRange: [0, 0.2, 1],
          outputRange: [0.6, 1.2, 1],
        });
        return (
          <Animated.View
            key={drop.id}
            style={[
              styles.drop,
              {
                opacity: drop.opacity,
                transform: [{ translateY }, { scale }],
              },
            ]}
          >
            <Text style={styles.coin}>🪙</Text>
            <Text style={styles.amount}>+{drop.amount}</Text>
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  drop: {
    position: "absolute",
    // Centered horizontally, starts ~40% from top (same visual zone as web)
    top: "42%",
    left: 0,
    right: 0,
    alignItems: "center",
    gap: 4,
    zIndex: 9999,
  },
  coin: {
    fontSize: 72,
  },
  amount: {
    fontSize: 32,
    fontFamily: "Inter_700Bold",
    color: "#eab308",
    letterSpacing: -0.5,
  },
});
