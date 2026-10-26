import { Alert, Linking } from "react-native";

export const PRIVACY_URL = "https://shareswap.app/privacy";
export const TERMS_URL = "https://shareswap.app/terms";

export function openLegalLink(url: string) {
  Linking.openURL(url).catch(() => {
    Alert.alert("Couldn't open link", `Please visit ${url} in your browser.`);
  });
}
