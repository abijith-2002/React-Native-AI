/**
 * PUBLIC_INTERFACE
 * getAppConfig
 * Generates the Expo app configuration using environment variables.
 * Ensures dev server binds to 0.0.0.0 so external health checks can connect.
 */
function getAppConfig() {
  /** This is a public function. */
  const trustProxy = process.env.EXPO_PUBLIC_TRUST_PROXY === 'true';
  const logLevel = process.env.EXPO_PUBLIC_LOG_LEVEL || 'info';
  const healthPath = process.env.EXPO_PUBLIC_HEALTHCHECK_PATH || '/healthz';
  const featureFlags = process.env.EXPO_PUBLIC_FEATURE_FLAGS || '';
  const experimentsEnabled =
    process.env.EXPO_PUBLIC_EXPERIMENTS_ENABLED === 'true';

  return {
    expo: {
      name: 'reactnative',
      slug: 'reactnative',
      version: '1.0.0',
      orientation: 'portrait',
      icon: './assets/icon.png',
      userInterfaceStyle: 'light',
      newArchEnabled: true,
      splash: {
        image: './assets/splash-icon.png',
        resizeMode: 'contain',
        backgroundColor: '#ffffff',
      },
      ios: {
        supportsTablet: true,
      },
      android: {
        adaptiveIcon: {
          foregroundImage: './assets/adaptive-icon.png',
          backgroundColor: '#ffffff',
        },
        edgeToEdgeEnabled: true,
      },
      web: {
        favicon: './assets/favicon.png',
      },
      // Dev settings to improve compatibility with preview environments.
      // Metro port is controlled in metro.config.js explicitly (3030).
      // Here, we ensure the host is accessible from container networks.
      devServer: {
        // LAN mode ensures external devices/health checks can reach the dev server.
        // Expo CLI respects REACT_NATIVE_PACKAGER_HOSTNAME and related envs when needed,
        // but we set host to 0.0.0.0 explicitly.
        host: process.env.EXPO_DEV_HOST || '0.0.0.0',
      },
      extra: {
        public: {
          trustProxy,
          logLevel,
          healthPath,
          featureFlags,
          experimentsEnabled,
        },
      },
    },
  };
}

export default getAppConfig();
