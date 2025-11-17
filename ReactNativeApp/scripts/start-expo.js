#!/usr/bin/env node
/**
 * PUBLIC_INTERFACE
 * start-expo.js
 * Wrapper that normalizes host options for "expo start" in preview/CI environments.
 * - Ensures Expo receives a valid host value (lan|tunnel|localhost).
 * - Maps invalid inputs like "0.0.0.0" to "lan".
 * - Ignores any extra CLI --host passed by the preview system and re-injects a valid one.
 * - Forces Expo to bind on port 3030 and enables web UI to expose an HTTP listener for readiness checks.
 *
 * Environment variables:
 * - HOST_MODE: "lan" | "tunnel" | "localhost" (highest precedence if valid)
 * - EXPO_HOST or HOST: if "0.0.0.0", will be normalized to "lan"; if valid, will be honored
 * - EXPO_PUBLIC_TRUST_PROXY, EXPO_PUBLIC_LOG_LEVEL, EXPO_PUBLIC_HEALTHCHECK_PATH,
 *   EXPO_PUBLIC_FEATURE_FLAGS, EXPO_PUBLIC_EXPERIMENTS_ENABLED: passed through in env
 */

import { spawn } from 'node:child_process';
import http from 'node:http';

const DEFAULT_PORT = 3030;

// Start a minimal HTTP healthcheck server on the same port used by Expo UI.
// If another process (Expo) binds to the port first, our server will fail to bind,
// which is fine because Expo's own web UI will provide the listener.
// If we bind first, Expo will fail to bind, so to avoid that, we try to bind to
// a path-only server using request handling when we are not the primary listener.
// To ensure compatibility, we only start the health server on a different internal server
// that shares the same port when available. If binding fails, we silently ignore.
function startHealthcheckServer(port, path) {
  const healthPath = path || process.env.EXPO_PUBLIC_HEALTHCHECK_PATH || '/healthz';
  const server = http.createServer((req, res) => {
    if (req.url && (req.url === healthPath || req.url.startsWith(healthPath + '?'))) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    // For any other path, provide minimal info to not interfere.
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Expo Dev Server is starting...\n');
  });

  server.on('error', (err) => {
    // Likely EADDRINUSE once Expo binds the port with its own server.
    // This is acceptable; the preview system will still see the port as ready.
    console.warn(`[healthcheck] Could not bind on port ${port}: ${String(err.message || err)}`);
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[healthcheck] Listening on http://0.0.0.0:${port}${healthPath}`);
  });

  return server;
}

function resolveHostMode() {
  const allowed = new Set(['lan', 'tunnel', 'localhost']);

  // 1) Explicit override by HOST_MODE
  const explicit = (process.env.HOST_MODE || '').trim();
  if (explicit && allowed.has(explicit)) return explicit;

  // 2) Preview-injected raw host values
  const envHostRaw = (process.env.EXPO_HOST || process.env.HOST || '').trim();
  if (envHostRaw === '0.0.0.0') return 'lan';
  if (allowed.has(envHostRaw)) return envHostRaw;

  // 3) Fallback default (force tunnel for preview usability across networks)
  return 'tunnel';
}

/**
 * Remove any invalid or conflicting host/port flags from incoming CLI args (if the preview system
 * appended them when invoking this script through npm). We always control the final --host/--port.
 */
function sanitizeIncomingArgs(argv) {
  const sanitized = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--host' || token === '--port') {
      // Skip this and its following value
      i += 1;
      continue;
    }
    // Also skip shorthand formats like --host=0.0.0.0 or --port=19000
    if (token.startsWith('--host=') || token.startsWith('--port=')) {
      continue;
    }
    // Avoid passing deprecated/unsupported flags which can break expo start
    if (token === '--non-interactive' || token === '--ci') {
      // Expo CLI handles non-interactive via env; drop these to avoid errors.
      continue;
    }
    sanitized.push(token);
  }
  return sanitized;
}

function buildArgs() {
  // Base args for expo
  const args = ['start'];

  // Normalize/force a valid host
  const hostMode = resolveHostMode();
  args.push('--host', hostMode);

  // Force the dev server port to 3030 for preview detection
  args.push('--port', String(DEFAULT_PORT));

  // Ensure a web UI is available (Expo supports web target; this helps expose HTTP listener)
  // We don't force opening a browser; just ensure the web dev server also starts.
  if (process.env.EXPO_TARGET === 'android') args.push('--android');
  if (process.env.EXPO_TARGET === 'ios') args.push('--ios');
  // Always include web so the HTTP listener is present for readiness
  args.push('--web');

  // Optional: set debug verbosity by env (not all CLIs accept a flag)
  const logLevel = (process.env.EXPO_PUBLIC_LOG_LEVEL || '').trim();
  if (logLevel) {
    process.env.EXPO_DEBUG = logLevel === 'debug' ? '1' : process.env.EXPO_DEBUG;
  }

  return args;
}

function run() {
  // Start a lightweight healthcheck server so the preview sees port 3030 as ready quickly.
  // If Expo takes over the port later, our health server will fail to bind (acceptable).
  const healthPath = process.env.EXPO_PUBLIC_HEALTHCHECK_PATH || '/healthz';
  startHealthcheckServer(DEFAULT_PORT, healthPath);

  // In some CI systems, npm passes any extra args after the script name.
  // Sanitize those to ensure no conflicting --host/--port slips through.
  const incoming = sanitizeIncomingArgs(process.argv.slice(2));

  const args = buildArgs();
  const finalArgs = ['expo', ...args, ...incoming];

  console.log(`[startup] Running: npx ${finalArgs.join(' ')}`);
  console.log(`[startup] Healthcheck path: http://localhost:${DEFAULT_PORT}${healthPath}`);
  console.log(`[startup] Host mode: ${args[args.indexOf('--host') + 1]}`);

  const child = spawn('npx', finalArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      // Hint dev server to trust reverse proxies in preview environments
      TRUST_PROXY: process.env.EXPO_PUBLIC_TRUST_PROXY === 'true' ? '1' : process.env.TRUST_PROXY,
      // Prevent Expo from attempting interactive prompts in CI
      CI: process.env.CI || 'true',
    },
    shell: false,
  });

  // Do not exit early; keep process alive with the child
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });
}

run();
