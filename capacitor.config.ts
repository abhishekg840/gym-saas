import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.glitchfiesta.forgeos',
  appName: 'ForgeOS',
  webDir: 'public',
  server: {
    url: 'https://gym.glitchfiesta.in',
    cleartext: true
  },
  android: {
    allowMixedContent: true,
    captureInput: true
  }
};

export default config;