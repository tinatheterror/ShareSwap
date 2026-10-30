import { Alert, Linking } from "react-native";

export const PRIVACY_URL = "https://shareswap.app/privacy";
export const TERMS_URL = "https://shareswap.app/terms";
/** Deletion without the app: sign in, then request, cancel or confirm. Also the deletion URL for the Play listing. */
export const DELETE_ACCOUNT_URL = "https://shareswap.app/delete-account";

export function openLegalLink(url: string) {
  Linking.openURL(url).catch(() => {
    Alert.alert("Couldn't open link", `Please visit ${url} in your browser.`);
  });
}
