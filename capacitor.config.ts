import { CapacitorConfig } from '@capacitor/cli';

/**
 * Vyroniq native shell.
 *
 * The URL scheme the app answers to (`vyroniq://auth`, the OAuth callback) is
 * NOT configured here — Capacitor has no option for it. It lives in
 * android/app/src/main/AndroidManifest.xml as an intent-filter on MainActivity,
 * which is also where the `vyroniq` custom_url_scheme string is consumed.
 *
 * NOTE on server.url: still the old glitchfiesta.in host. That is the live
 * production origin this build ships against — pointing the shell at a
 * vyroniq.in host before that domain is provisioned and TLS-terminated would
 * leave the app loading nothing on a fresh install. Change both this file and
 * android/app/src/main/assets/capacitor.config.json (which is what
 * `npx cap sync` actually reads) in the same commit when the host moves.
 */

const config: CapacitorConfig = {
  appId: 'in.vyroniq.gym',
  appName: 'Vyroniq',
  webDir: 'public',
  server: {
    url: 'https://gym.glitchfiesta.in',
    cleartext: true
  },
  android: {
    allowMixedContent: true,
    captureInput: true,
    // Android-specific asset config for production builds
    assetPath: 'assets',
  },
  // Icon configuration (1024x1024 base)
  icon: {
    source: 'assets/icon.png',
    background: '#26A69A',
    foreground: 'assets/icon-foreground.png',
  },
  // Splash screen configuration (2732x2732 base)
  splash: {
    source: 'assets/splash.png',
    backgroundColor: '#26A69A',
  },
};

export default config;
