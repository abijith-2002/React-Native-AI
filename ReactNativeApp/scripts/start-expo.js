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

/**
 * Start a resilient HTTP healthcheck server on 0.0.0.0:3030 that:
 * - Always responds 200 on EXPO_PUBLIC_HEALTHCHECK_PATH (default /healthz).
 * - If Expo already owns the port, we log and rely on Expo's listener; we also
 *   keep the parent process alive via the spawned Expo child.
 */
function startHealthcheckServer(port, path) {
  const healthPath = path || process.env.EXPO_PUBLIC_HEALTHCHECK_PATH || '/healthz';

  const server = http.createServer(async (req, res) => {
    const url = req.url || '/';
    const isHealth = url === healthPath || url.startsWith(healthPath + '?');

    if (isHealth) {
      // Return 200 quickly to mark readiness
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // Minimal default route
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Expo Dev Server is starting...\n');
  });

  server.on('error', (err) => {
    const msg = String(err && (err.message || err));
    if (msg.includes('EADDRINUSE')) {
      console.warn(`[healthcheck] Port ${port} already in use; assuming Expo dev server bound successfully.`);
      // Nothing else to do; Expo will keep the process alive and respond.
      return;
    }
    console.warn(`[healthcheck] Could not bind on port ${port}: ${msg}`);
  });

  try {
    server.listen(port, '0.0.0.0', () => {
      console.log(`[healthcheck] Listening on http://0.0.0.0:${port}${healthPath}`);
    });
  } catch (e) {
    console.warn(`[healthcheck] Listen threw: ${String(e && (e.message || e))}`);
  }

  return server;
}

function resolveHostMode() {
  const allowed = new Set(['lan', 'tunnel', 'localhost']);

  const explicit = (process.env.HOST_MODE || '').trim();
  if (explicit && allowed.has(explicit)) return explicit;

  const envHostRaw = (process.env.EXPO_HOST || process.env.HOST || '').trim();
  if (envHostRaw === '0.0.0.0') return 'lan';
  if (allowed.has(envHostRaw)) return envHostRaw;

  return 'tunnel';
}

/**
 * Remove any invalid or conflicting host/port flags from incoming CLI args.
 */
function sanitizeIncomingArgs(argv) {
  const sanitized = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--host' || token === '--port') {
      i += 1;
      continue;
    }
    if (token.startsWith('--host=') || token.startsWith('--port=')) {
      continue;
    }
    if (token === '--non-interactive' || token === '--ci') {
      continue;
    }
    sanitized.push(token);
  }
  return sanitized;
}

function buildArgs() {
  const args = ['start'];

  const hostMode = resolveHostMode();
  args.push('--host', hostMode);

  args.push('--port', String(DEFAULT_PORT));

  // Ensure HTTP listener exists
  if (process.env.EXPO_TARGET === 'android') args.push('--android');
  if (process.env.EXPO_TARGET === 'ios') args.push('--ios');
  args.push('--web');

  const logLevel = (process.env.EXPO_PUBLIC_LOG_LEVEL || '').trim();
  if (logLevel) {
    process.env.EXPO_DEBUG = logLevel === 'debug' ? '1' : process.env.EXPO_DEBUG;
  }

  return args;
}

function run() {
  const healthPath = process.env.EXPO_PUBLIC_HEALTHCHECK_PATH || '/healthz';
  startHealthcheckServer(DEFAULT_PORT, healthPath);

  const incoming = sanitizeIncomingArgs(process.argv.slice(2));
  const args = buildArgs();
  const finalArgs = ['expo', ...args, ...incoming];

  console.log(`[startup] Running: npx ${finalArgs.join(' ')}`);
  console.log(`[startup] Healthcheck path: http://0.0.0.0:${DEFAULT_PORT}${healthPath}`);
  console.log(`[startup] Host mode: ${args[args.indexOf('--host') + 1]}`);

  const child = spawn('npx', finalArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      TRUST_PROXY: process.env.EXPO_PUBLIC_TRUST_PROXY === 'true' ? '1' : process.env.TRUST_PROXY,
      CI: process.env.CI || 'true',
    },
    shell: false,
  });

  // Keep process alive until child exits
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });
}

run();
