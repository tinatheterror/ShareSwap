import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { FlatList, Keyboard, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { apiGet } from "@/lib/api";

export type AgeRegion = { code: string; country: "CA" | "US"; name: string; ageOfMajority: number };
export type AgeValue = { dateOfBirth: string; region: string };
export const emptyAge: AgeValue = { dateOfBirth: "", region: "" };
export const ageComplete = (value: AgeValue) => /^\d{4}-\d{2}-\d{2}$/.test(value.dateOfBirth) && value.region !== "";

/** "19900505" -> "1990-05-05" as it is typed. */
export const formatDobInput = (text: string) => {
  const digits = text.replace(/\D/g, "").slice(0, 8);
  return [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)].filter(Boolean).join("-");
};

let cachedRegions: AgeRegion[] | null = null;

/**
 * Date of birth and province/state: the age of majority where you live is the minimum age for an account. The server uses the
 * birth date once to check it and keeps only the place and the date the check passed.
 */
export function AgeFields({ value, onChange }: { value: AgeValue; onChange: (value: AgeValue) => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [regions, setRegions] = useState<AgeRegion[]>(cachedRegions ?? []);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (cachedRegions) return;
    let alive = true;
    apiGet<{ regions: AgeRegion[] }>("/api/legal/age-config")
      .then((config) => { cachedRegions = config.regions; if (alive) setRegions(config.regions); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const chosen = regions.find((region) => region.code === value.region);
  return (
    <View style={styles.wrap} testID="age-fields">
      <Text style={[styles.label, { color: colors.foreground }]}>Where do you live?</Text>
      <Pressable
        testID="age-region"
        accessibilityRole="button"
        onPress={() => setPicking(true)}
        style={[styles.field, { borderColor: colors.border, backgroundColor: colors.card }]}
      >
        <Text style={{ color: chosen ? colors.foreground : colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 15 }}>
          {chosen ? chosen.name : "Choose your province, territory or state"}
        </Text>
        <Feather name="chevron-down" size={18} color={colors.mutedForeground} />
      </Pressable>

      <Text style={[styles.label, { color: colors.foreground }]}>Date of birth</Text>
      <TextInput
        testID="age-dob"
        value={value.dateOfBirth}
        onChangeText={(text) => {
          const dateOfBirth = formatDobInput(text);
          onChange({ ...value, dateOfBirth });
          // The number pad has no Done key, so close it once the whole date is in and the rest of the screen is reachable.
          if (/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) Keyboard.dismiss();
        }}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.mutedForeground}
        keyboardType="number-pad"
        returnKeyType="done"
        blurOnSubmit
        maxLength={10}
        style={[styles.field, styles.input, { borderColor: colors.border, backgroundColor: colors.card, color: colors.foreground }]}
      />
      <Text style={[styles.hint, { color: colors.mutedForeground }]}>
        You must have reached the age of majority where you live{chosen ? ` (${chosen.ageOfMajority} in ${chosen.name})` : ""} to use ShareSwap. We use your date of birth only to check this and do not keep it.
      </Text>

      <Modal visible={picking} animationType="slide" onRequestClose={() => setPicking(false)}>
        <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top + 12, paddingBottom: insets.bottom }}>
          <Text style={[styles.title, { color: colors.foreground }]}>Where do you live?</Text>
          <FlatList
            data={regions}
            keyExtractor={(region) => region.code}
            renderItem={({ item, index }) => (
              <>
                {(index === 0 || regions[index - 1].country !== item.country) && (
                  <Text style={[styles.section, { color: colors.mutedForeground }]}>{item.country === "CA" ? "Canada" : "United States"}</Text>
                )}
                <Pressable
                  testID={`age-region-${item.code}`}
                  accessibilityRole="button"
                  style={styles.row}
                  onPress={() => { onChange({ ...value, region: item.code }); setPicking(false); }}
                >
                  <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 16 }}>{item.name}</Text>
                  {item.code === value.region ? <Feather name="check" size={18} color={colors.primary} /> : null}
                </Pressable>
              </>
            )}
          />
          <Pressable accessibilityRole="button" onPress={() => setPicking(false)} style={styles.close}>
            <Text style={{ color: colors.primary, fontFamily: "Inter_700Bold", fontSize: 16 }}>Close</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, alignSelf: "stretch" },
  label: { fontSize: 14, fontFamily: "Inter_500Medium" },
  field: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  input: { fontSize: 15, fontFamily: "Inter_400Regular" },
  hint: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  title: { fontSize: 20, fontFamily: "Inter_700Bold", paddingHorizontal: 20, paddingBottom: 8 },
  section: { fontSize: 12, fontFamily: "Inter_700Bold", textTransform: "uppercase", paddingHorizontal: 20, paddingTop: 14, paddingBottom: 4 },
  row: { paddingHorizontal: 20, paddingVertical: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  close: { alignItems: "center", paddingVertical: 14 },
});
