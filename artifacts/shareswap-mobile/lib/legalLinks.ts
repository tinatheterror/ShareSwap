import { Alert, Linking } from "react-native";

export const PRIVACY_URL = "https://shareswap.app/privacy";
export const TERMS_URL = "https://shareswap.app/terms";
export const GUIDELINES_URL = "https://shareswap.app/community-guidelines";
/** Used until the server says otherwise (GET /api/legal/config, or supportEmail on /api/user). */
export const DEFAULT_SUPPORT_EMAIL = "support@shareswap.app";

export function supportMailto(email: string = DEFAULT_SUPPORT_EMAIL, subject = "ShareSwap support") {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}`;
}
/** Deletion without the app: sign in, then request, cancel or confirm. Also the deletion URL for the Play listing. */
export const DELETE_ACCOUNT_URL = "https://shareswap.app/delete-account";

export function openLegalLink(url: string) {
  Linking.openURL(url).catch(() => {
    Alert.alert("Couldn't open link", `Please visit ${url} in your browser.`);
  });
}
