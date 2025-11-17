#!/usr/bin/env node
/**
 * PUBLIC_INTERFACE
 * start-expo.js
 * Wrapper that normalizes host options for "expo start" in preview/CI environments.
 * - Ensures Expo receives a valid host value (lan|tunnel|localhost).
 * - Maps invalid inputs like "0.0.0.0" to a supported mode (tunnel).
 * - Sanitizes and ignores preview-injected --host/--port flags, reinjecting valid ones.
 * - Always binds a standalone HTTP healthcheck server on 0.0.0.0:3030 that returns 200 on /healthz (configurable).
 * - Runs Expo with stdio inherited and without daemonizing.
 *
 * Environment variables:
 * - HOST_MODE: "lan" | "tunnel" | "localhost" (highest precedence if valid)
 * - EXPO_HOST or HOST: if "0.0.0.0", will be normalized to "tunnel"; if valid, will be honored
 * - EXPO_PUBLIC_TRUST_PROXY, EXPO_PUBLIC_LOG_LEVEL, EXPO_PUBLIC_HEALTHCHECK_PATH,
 *   EXPO_PUBLIC_FEATURE_FLAGS, EXPO_PUBLIC_EXPERIMENTS_ENABLED: passed through in env
 */

const { spawn } = require('node:child_process');
const http = require('node:http');
const process_ = require('node:process');

const DEFAULT_PORT = 3030;
const EXPO_INTERNAL_FALLBACK_PORT = 3031; // Internal port for Expo so 3030 can be used by healthcheck

/**
 * PUBLIC_INTERFACE
 * startHealthcheckServer
 * Start a resilient HTTP healthcheck server on 0.0.0.0:3030 that:
 * - Always responds 200 on EXPO_PUBLIC_HEALTHCHECK_PATH (default /healthz).
 * - Keeps the parent process alive independent of Expo.
 */
function startHealthcheckServer(port, path) {
  const healthPath = path || process_.env.EXPO_PUBLIC_HEALTHCHECK_PATH || '/healthz';

  const server = http.createServer((req, res) => {
    const url = (req && req.url) || '/';
    const isHealth = url === healthPath || url.startsWith(healthPath + '?');

    if (isHealth) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', port, path: healthPath }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Expo Dev Server bootstrap\n');
  });

  server.on('listening', () => {
    console.log(`[healthcheck] Listening on http://0.0.0.0:${port}${healthPath}`);
    console.log('[healthcheck] Ready signal is up (HTTP 200).');
  });

  server.on('error', (err) => {
    const code = err && err.code;
    const msg = String(err && (err.message || err));
    if (code === 'EADDRINUSE' || msg.includes('EADDRINUSE')) {
      console.warn(`[healthcheck] Port ${port} already in use. Ensure nothing else binds to ${port}.`);
      console.warn('[healthcheck] Preview readiness depends on this server binding successfully.');
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
 * Also remove any unknown flags that preview might inject which could cause Expo to error.
 */
function sanitizeIncomingArgs(argv) {
  const sanitized = [];
  const dropNext = new Set(['--host', '--port']);
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    // Drop paired flags and their value
    if (dropNext.has(token)) {
      i += 1;
      continue;
    }

    // Drop inline assignments
    if (typeof token === 'string' && (token.startsWith('--host=') || token.startsWith('--port='))) {
      continue;
    }

    // Drop preview-only flags that Expo doesn't recognize
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

  // Map "0.0.0.0" to a valid host mode (tunnel) and never pass raw "0.0.0.0" to Expo
  const hostMode = resolveHostMode();
  args.push('--host', hostMode);

  // Bind Expo on an internal port to avoid colliding with the healthcheck on 3030
  args.push('--port', String(EXPO_INTERNAL_FALLBACK_PORT));

  // Select platform targets if specified
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

  // Drop any preview-injected flags that might conflict (e.g., --host 0.0.0.0 or --port 3030)
  const incoming = sanitizeIncomingArgs(process_.argv.slice(2));
  const args = buildArgs();
  const finalArgs = ['expo', ...args, ...incoming];

  console.log(`[startup] Running: npx ${finalArgs.join(' ')}`);
  console.log(`[startup] Healthcheck path: http://0.0.0.0:${DEFAULT_PORT}${healthPath}`);
  console.log(`[startup] Host mode: ${args[args.indexOf('--host') + 1]}`);
  console.log(`[startup] Expo internal port: ${EXPO_INTERNAL_FALLBACK_PORT}`);
  console.log('[startup] Note: Port 3030 is reserved for healthcheck only; Expo runs on an internal port.');

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
