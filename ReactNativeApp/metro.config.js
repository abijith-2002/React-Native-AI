import { getDefaultConfig } from '@expo/metro-config';

/**
 * PUBLIC_INTERFACE
 * getMetroConfig
 * This function creates a Metro configuration for Expo/React Native.
 * It explicitly binds the Metro server to port 3030 and sets up a healthcheck
 * middleware so the hosting environment can determine when the server is ready.
 */
function getMetroConfig(projectRoot) {
  /** This is a public function. */
  const config = getDefaultConfig(projectRoot);

  // Ensure the server listens on the interface and port expected by the preview
  config.server = config.server || {};
  // Port selection; binding to 0.0.0.0 is handled by Expo/Metro when EXPO_DEV_HOST=0.0.0.0
  config.server.port = Number(process.env.METRO_PORT || 3030);
  config.server.enhanceMiddleware = (middleware) => {
    // Healthcheck route served by Metro (defaults to /healthz). Port remains 3030 by default.
    const healthPath = process.env.EXPO_PUBLIC_HEALTHCHECK_PATH || '/healthz';
    return (req, res, next) => {
      if (req.url && req.url.startsWith(healthPath)) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, max-age=0');
        res.end(JSON.stringify({ status: 'ok', port: config.server.port }));
        return;
      }
      return middleware(req, res, next);
    };
  };

  return config;
}

export default getMetroConfig(__dirname);
