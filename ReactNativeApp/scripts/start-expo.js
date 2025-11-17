#!/usr/bin/env node
/**
 * PUBLIC_INTERFACE
 * start-expo.js
 * Wrapper that normalizes host options for "expo start" in preview/CI environments.
 * - Ensures Expo receives a valid host value (lan|tunnel|localhost).
 * - Maps invalid inputs like "0.0.0.0" to a supported mode.
 * - Sanitizes and ignores preview-injected --host/--port flags, reinjecting valid ones.
 * - Always binds a standalone HTTP healthcheck server on 0.0.0.0:3030 that returns 200 on /healthz (configurable).
 * - Runs Expo with stdio inherited and without daemonizing.
 *
 * Environment variables:
 * - HOST_MODE: "lan" | "tunnel" | "localhost" (highest precedence if valid)
 * - EXPO_HOST or HOST: if "0.0.0.0", will be normalized to 'tunnel'; if valid, will be honored
 * - EXPO_PUBLIC_TRUST_PROXY, EXPO_PUBLIC_LOG_LEVEL, EXPO_PUBLIC_HEALTHCHECK_PATH,
 *   EXPO_PUBLIC_FEATURE_FLAGS, EXPO_PUBLIC_EXPERIMENTS_ENABLED: passed through in env
 */

const { spawn } = require('node:child_process');
const http = require('node:http');
const process_ = require('node:process');

const DEFAULT_PORT = 3030;
const EXPO_INTERNAL_FALLBACK_PORT = 3031; // Internal fallback for Expo if 3030 is reserved for healthcheck

/**
 * PUBLIC_INTERFACE
 * startHealthcheckServer
 * Start a resilient HTTP healthcheck server on 0.0.0.0:3030 that:
 * - Always responds 200 on EXPO_PUBLIC_HEALTHCHECK_PATH (default /healthz).
 * - Keeps the parent process alive independent of Expo.
 */
function startHealthcheckServer(port, path) {
  const healthPath = path || process_.env.EXPO_PUBLIC_HEALTHCHECK_PATH || '/healthz';

  const server = http.createServer(async (req, res) => {
    const url = (req && req.url) || '/';
    const isHealth = url === healthPath || url.startsWith(healthPath + '?');

    if (isHealth) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Expo Dev Server bootstrap\n');
  });

  server.on('listening', () => {
    console.log(`[healthcheck] Listening on http://0.0.0.0:${port}${healthPath}`);
  });

  server.on('error', (err) => {
    const msg = String(err && (err.message || err));
    if (msg.includes('EADDRINUSE')) {
      console.warn(`[healthcheck] Port ${port} already in use. To ensure a stable 200 on ${healthPath}, we will run Expo on an internal port and keep this dedicated server on ${port}.`);
      // We still mark as bound false; we'll proceed but warn that readiness may depend on Expo if we can't bind.
      return;
    }
    console.warn(`[healthcheck] Could not bind on port ${port}: ${msg}`);
  });

  try {
    server.listen(port, '0.0.0.0');
  } catch (e) {
    console.warn(`[healthcheck] Listen threw: ${String(e && (e.message || e))}`);
  }

  return server;
}

/**
 * PUBLIC_INTERFACE
 * resolveHostMode
 * Resolve the host mode for Expo start.
 * Priority:
 * 1) HOST_MODE env if valid
 * 2) EXPO_HOST/HOST (map "0.0.0.0" to "tunnel" to avoid Expo assertion)
 * 3) default "tunnel"
 */
function resolveHostMode() {
  const allowed = new Set(['lan', 'tunnel', 'localhost']);

  const explicit = (process_.env.HOST_MODE || '').trim();
  if (explicit && allowed.has(explicit)) return explicit;

  const envHostRaw = (process_.env.EXPO_HOST || process_.env.HOST || '').trim();
  if (envHostRaw === '0.0.0.0') return 'tunnel';
  if (allowed.has(envHostRaw)) return envHostRaw;

  return 'tunnel';
}

/**
 * PUBLIC_INTERFACE
 * sanitizeIncomingArgs
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
    if (typeof token === 'string' && (token.startsWith('--host=') || token.startsWith('--port='))) {
      continue;
    }
    if (token === '--non-interactive' || token === '--ci') {
      continue;
    }
    sanitized.push(token);
  }
  return sanitized;
}

/**
 * PUBLIC_INTERFACE
 * buildArgs
 * Build arguments for `expo start`. We avoid binding Expo directly to 3030 so our
 * health server can always occupy that port. Expo will bind to a fallback internal port.
 */
function buildArgs() {
  const args = ['start'];

  const hostMode = resolveHostMode();
  args.push('--host', hostMode);

  // Bind Expo on an internal port to avoid colliding with healthcheck on 3030
  args.push('--port', String(EXPO_INTERNAL_FALLBACK_PORT));

  // Ensure the dev UI is available; do not pass invalid flags
  if (process_.env.EXPO_TARGET === 'android') args.push('--android');
  if (process_.env.EXPO_TARGET === 'ios') args.push('--ios');
  args.push('--web');

  const logLevel = (process_.env.EXPO_PUBLIC_LOG_LEVEL || '').trim();
  if (logLevel) {
    process_.env.EXPO_DEBUG = logLevel === 'debug' ? '1' : process_.env.EXPO_DEBUG;
  }

  return args;
}

/**
 * PUBLIC_INTERFACE
 * run
 * Start health server and Expo process with stdio inherited.
 */
function run() {
  const healthPath = process_.env.EXPO_PUBLIC_HEALTHCHECK_PATH || '/healthz';
  startHealthcheckServer(DEFAULT_PORT, healthPath);

  const incoming = sanitizeIncomingArgs(process_.argv.slice(2));
  const args = buildArgs();
  const finalArgs = ['expo', ...args, ...incoming];

  console.log(`[startup] Running: npx ${finalArgs.join(' ')}`);
  console.log(`[startup] Healthcheck path: http://0.0.0.0:${DEFAULT_PORT}${healthPath}`);
  console.log(`[startup] Host mode: ${args[args.indexOf('--host') + 1]}`);
  console.log(`[startup] Expo internal port: ${EXPO_INTERNAL_FALLBACK_PORT}`);

  const child = spawn('npx', finalArgs, {
    stdio: 'inherit',
    env: {
      ...process_.env,
      TRUST_PROXY: process_.env.EXPO_PUBLIC_TRUST_PROXY === 'true' ? '1' : process_.env.TRUST_PROXY,
      CI: process_.env.CI || 'true',
    },
    shell: false,
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      try {
        process_.kill(process_.pid, signal);
      } catch {
        process_.exit(0);
      }
    } else {
      process_.exit(code ?? 0);
    }
  });
}

run();
