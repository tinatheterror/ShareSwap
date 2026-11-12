// Dynamic Expo config on top of app.json. The only thing computed here is the Android Firebase file: EAS stores
// google-services.json as a secret file environment variable (GOOGLE_SERVICES_JSON, development/preview/production) and sets the
// variable to the path of the file it writes on the build machine. Where the variable is not set (local development, CI, the
// Replit preview) the key is simply left out, exactly as before.
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    ...(process.env.GOOGLE_SERVICES_JSON ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON } : {}),
  },
});
