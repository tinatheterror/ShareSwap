// Design tokens mirrored 1:1 from the web app's generated shadcn theme
// (artifacts/shareswap/theme.json -> @replit/vite-plugin-shadcn-theme-json,
// stone neutral base + custom teal primary). Do not drift these from web
// without updating both apps together.
const colors = {
  light: {
    text: "#0c0a09",
    tint: "#0DCEA1",

    // Web's html/body uses --app-bg (#F3F4F6) for the page shell, while
    // --background (white) is reserved for surfaces like popovers.
    background: "#F3F4F6",
    foreground: "#0c0a09",

    card: "#ffffff",
    cardForeground: "#0c0a09",

    primary: "#0DCEA1",
    primaryDark: "#0BB690",
    primaryForeground: "#002319",

    secondary: "#f5f5f4",
    secondaryForeground: "#1c1917",

    muted: "#f5f5f4",
    mutedForeground: "#78716c",

    accent: "#f5f5f4",
    accentForeground: "#1c1917",

    destructive: "#ef4444",
    destructiveForeground: "#fafaf9",

    border: "#e7e5e4",
    input: "#e7e5e4",

    success: "#22c55e",
    warning: "#f59e0b",
    info: "#3b82f6",

    tabBar: "#ffffff",
    tabBarBorder: "#e7e5e4",

    coin: "#f59e0b",
    coinBackground: "#fef3c7",
  },
  radius: 12,
};

export default colors;
