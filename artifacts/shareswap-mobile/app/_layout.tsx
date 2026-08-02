import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { SessionGuard } from "@/components/SessionGuard";
import { usePushNotificationNavigation, useRegisterPushToken } from "@/hooks/usePushNotifications";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});

function RootLayoutNav() {
  // Set up deep-link navigation from push notification taps
  usePushNotificationNavigation();

  // Re-register the push token on every app launch when a session already
  // exists (catches permission grants after the initial install, and token
  // rotations after app updates).
  const { user } = useAuth();
  useRegisterPushToken(!!user);

  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="login"
        options={{
          title: "Sign In",
          headerBackTitle: "Back",
          presentation: "modal",
        }}
      />
      <Stack.Screen
        name="register"
        options={{
          title: "Create Account",
          headerBackTitle: "Back",
          presentation: "modal",
        }}
      />
      <Stack.Screen
        name="notifications"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="item/[id]"
        options={{
          title: "",
          headerBackTitle: "Back",
          headerTransparent: true,
        }}
      />
      <Stack.Screen
        name="profile/[id]"
        options={{
          title: "Profile",
          headerBackTitle: "Back",
        }}
      />
      <Stack.Screen
        name="chat/[id]"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="wallet"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="sharecoin-wallet"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="transactions"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="achievements"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="referrals"
        options={{ title: "Referrals", headerBackTitle: "Back" }}
      />
      <Stack.Screen
        name="settings"
        options={{
          title: "Settings",
          headerBackTitle: "Back",
        }}
      />
      <Stack.Screen
        name="edit-profile"
        options={{
          title: "Edit Profile",
          headerBackTitle: "Back",
        }}
      />
      <Stack.Screen
        name="payment-methods"
        options={{
          title: "Payment Methods",
          headerBackTitle: "Back",
        }}
      />
      <Stack.Screen
        name="verification"
        options={{
          title: "Identity Verification",
          headerBackTitle: "Back",
        }}
      />
      <Stack.Screen
        name="verify-email-prompt"
        options={{
          headerShown: false,
          gestureEnabled: false,
        }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  const ready = fontsLoaded || fontError || timedOut;

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync();
    }
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <SessionGuard />
            <GestureHandlerRootView>
              <KeyboardProvider>
                <RootLayoutNav />
              </KeyboardProvider>
            </GestureHandlerRootView>
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
