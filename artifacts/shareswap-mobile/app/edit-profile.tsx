import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
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
import { useAuth } from "@/context/AuthContext";
import { apiGet, apiRequest, BASE_URL, photoUrl } from "@/lib/api";

interface UserProfile {
  id: number;
  username: string;
  displayName?: string | null;
  bio?: string | null;
  location?: string | null;
  profilePhoto?: string | null;
}

export default function EditProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, refreshUser } = useAuth() as any;
  const queryClient = useQueryClient();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [location, setLocation] = useState("");
  const [localPhoto, setLocalPhoto] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);

  const { data: profile, isLoading } = useQuery<UserProfile>({
    queryKey: ["user-profile"],
    queryFn: () => apiGet("/api/user-profile"),
  });

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName ?? "");
      setBio(profile.bio ?? "");
      setLocation(profile.location ?? "");
    }
  }, [profile]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const trimmedName = displayName.trim();
      const body: Record<string, string | undefined> = {
        bio: bio.trim() || undefined,
        location: location.trim() || undefined,
      };
      // Only send displayName if it actually changed — server enforces a 30-day cooldown
      if (trimmedName && trimmedName !== (profile?.displayName ?? "")) {
        body.displayName = trimmedName;
      }
      const res = await apiRequest("PATCH", "/api/user-profile", body);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user-profile"] });
      queryClient.invalidateQueries({ queryKey: ["public-profile"] });
      if (refreshUser) refreshUser();
      router.back();
    },
    onError: (e: Error) => {
      Alert.alert("Error", e.message || "Could not save profile.");
    },
  });

  const pickAndUploadPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission needed",
        "Allow photo access to upload a profile photo."
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      base64: true, // request base64 data directly — avoids multipart/FormData issues on native
    });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setLocalPhoto(asset.uri);
    setPhotoUploading(true);

    try {
      // Use the base64 string from ImagePicker directly.
      // Sending JSON is far more reliable than multipart/FormData in React Native,
      // which can silently drop the file part when custom headers (CSRF) are present.
      const filename = asset.uri.split("/").pop() ?? "photo.jpg";
      const ext = (asset.mimeType?.split("/")[1] ?? filename.split(".").pop() ?? "jpg").toLowerCase();
      const mimeType = asset.mimeType ?? (ext === "png" ? "image/png" : "image/jpeg");

      if (!asset.base64) {
        throw new Error("Could not read image data. Please try again.");
      }

      const res = await apiRequest("POST", "/api/users/profile-photo", {
        imageBase64: asset.base64,
        mimeType,
        filename: `photo.${ext === "png" ? "png" : "jpg"}`,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error || "Upload failed");
      }
      const data = await res.json();
      // Mirror web: invalidate user (ShareCoin count), user-profile, and public profile
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      queryClient.invalidateQueries({ queryKey: ["user-profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user-profile"] });
      queryClient.invalidateQueries({ queryKey: ["public-profile"] });
      if (refreshUser) refreshUser();

      if (data.shareCoinsAwarded > 0) {
        Alert.alert("Photo Approved! 🪙", "You earned 1 ShareCoin for adding a profile photo!");
      } else if (data.validationStatus === "rejected") {
        Alert.alert(
          "Photo Saved",
          data.validationReason || "Try another photo to earn 1 ShareCoin."
        );
      } else {
        Alert.alert("Photo Updated!", "Your profile photo has been updated.");
      }
    } catch (e: any) {
      Alert.alert("Upload Failed", e.message || "Could not upload photo.");
      setLocalPhoto(null);
    } finally {
      setPhotoUploading(false);
    }
  };

  const currentPhotoUri = localPhoto
    ? localPhoto
    : profile?.profilePhoto
    ? photoUrl(profile.profilePhoto)
    : null;

  const initials = (profile?.displayName ?? profile?.username ?? user?.username ?? "?")
    .charAt(0)
    .toUpperCase();

  const isSaving = saveMutation.isPending;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: "#D4F7F1" }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: topPad + 16, paddingBottom: insets.bottom + 40 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Profile Photo */}
        <View style={styles.card}>
          <Text style={[styles.sectionLabel, { color: colors.foreground }]}>
            Profile Photo
          </Text>
          <View style={styles.photoRow}>
            <Pressable onPress={pickAndUploadPhoto} style={styles.avatarWrap}>
              {currentPhotoUri ? (
                <Image source={{ uri: currentPhotoUri }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder]}>
                  <Text style={styles.avatarInitial}>{initials}</Text>
                </View>
              )}
              <View style={styles.cameraBtn}>
                {photoUploading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Feather name="camera" size={14} color="#fff" />
                )}
              </View>
            </Pressable>
            <View style={styles.photoHint}>
              <Text style={[styles.addPhotoText, { color: colors.foreground }]}>
                Add a photo
              </Text>
              <Text style={styles.earnText}>🪙 Earn 1 ShareCoin</Text>
            </View>
          </View>
        </View>

        {/* Display Name */}
        <View style={styles.card}>
          <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
            Display Name
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
                color: colors.foreground,
              },
            ]}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder={profile?.username ?? "Your name"}
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="words"
            returnKeyType="next"
          />
        </View>

        {/* Bio */}
        <View style={styles.card}>
          <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
            Bio
          </Text>
          <TextInput
            style={[
              styles.input,
              styles.bioInput,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
                color: colors.foreground,
              },
            ]}
            value={bio}
            onChangeText={setBio}
            placeholder="Tell us about yourself..."
            placeholderTextColor={colors.mutedForeground}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        {/* Location */}
        <View style={styles.card}>
          <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
            Location
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
                color: colors.foreground,
              },
            ]}
            value={location}
            onChangeText={setLocation}
            placeholder="Your city (e.g. Toronto)"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="words"
            returnKeyType="done"
          />
        </View>

        {/* Buttons */}
        <View style={styles.btnRow}>
          <Pressable
            style={({ pressed }) => [
              styles.saveBtn,
              { opacity: pressed || isSaving ? 0.8 : 1 },
            ]}
            onPress={() => saveMutation.mutate()}
            disabled={isSaving || isLoading || photoUploading}
          >
            {isSaving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Feather name="save" size={16} color="#fff" />
                <Text style={styles.saveBtnText}>Save Changes</Text>
              </>
            )}
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.cancelBtn,
              {
                borderColor: colors.border,
                backgroundColor: colors.background,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
            onPress={() => router.back()}
            disabled={isSaving}
          >
            <Text style={[styles.cancelBtnText, { color: colors.foreground }]}>
              Cancel
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 20,
    gap: 16,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  sectionLabel: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  photoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  avatarWrap: {
    position: "relative",
    width: 72,
    height: 72,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
  },
  avatarPlaceholder: {
    backgroundColor: "#A7F0E4",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    color: "#0d9488",
  },
  cameraBtn: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#0d9488",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  photoHint: {
    gap: 4,
  },
  addPhotoText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  earnText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#d97706",
  },
  fieldLabel: {
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
  bioInput: {
    minHeight: 100,
    paddingTop: 12,
  },
  btnRow: {
    gap: 12,
    marginTop: 4,
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#0d9488",
    borderRadius: 12,
    paddingVertical: 14,
  },
  saveBtnText: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  cancelBtn: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
  },
  cancelBtnText: {
    fontSize: 16,
    fontFamily: "Inter_500Medium",
  },
});
