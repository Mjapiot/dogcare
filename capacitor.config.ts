import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Native iOS shell. The app loads the deployed Dogcare site (it needs its
 * server for auth and actions) and adds native capabilities through plugins.
 * For local development: CAP_SERVER_URL=http://localhost:3000 npx cap run ios
 */
const serverUrl = process.env.CAP_SERVER_URL ?? "https://dogcare-gamma.vercel.app";

const config: CapacitorConfig = {
  appId: "app.dogcare.ios",
  appName: "Dogcare",
  webDir: "native-shell",
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith("http://"),
    // shown when the site cannot be reached (no network)
    errorPath: "offline.html",
  },
  ios: {
    contentInset: "never",
    backgroundColor: "#ebe8e2",
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      launchAutoHide: true,
      backgroundColor: "#ebe8e2",
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    Keyboard: {
      resizeOnFullScreen: true,
    },
  },
};

export default config;
