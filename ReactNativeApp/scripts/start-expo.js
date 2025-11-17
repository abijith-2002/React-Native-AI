#!/usr/bin/env node
/**
 * PUBLIC_INTERFACE
 * start-expo.js
 * CommonJS wrapper ensuring Expo starts reliably in preview/CI:
 * - Forces valid host (lan|tunnel|localhost); maps invalid "0.0.0.0" to "tunnel".
 * - Strips preview-injected --host/--port (including "--host 0.0.0.0").
 * - Starts a standalone health server on 0.0.0.0:3030 (path configurable) returning HTTP 200.
 * - Spawns "npx expo start" with stdio inherited on an internal port to avoid conflict.
 * - Adds explicit logging and handles EADDRINUSE gracefully.
 *
 * Environment variables:
 * - HOST_MODE: "lan" | "tunnel" | "localhost"
 * - EXPO_HOST or HOST: if "0.0.0.0", will be normalized to "tunnel"
 * - EXPO_PUBLIC_TRUST_PROXY, EXPO_PUBLIC_LOG_LEVEL, EXPO_PUBLIC_HEALTHCHECK_PATH,
 *   EXPO_PUBLIC_FEATURE_FLAGS, EXPO_PUBLIC_EXPERIMENTS_ENABLED
 */

const { spawn } = require('node:child_process'); // CJS
const http = require('node:http'); // CJS
const process_ = require('node:process'); // CJS
const os = require('node:os'); // CJS

const DEFAULT_PORT = 3030;
const EXPO_INTERNAL_FALLBACK_PORT = 3031; // Expo dev server

// PUBLIC_INTERFACE
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
      console.warn(`[healthcheck] Port ${port} already in use. Another instance may be running; readiness may still be satisfied.`);
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

// PUBLIC_INTERFACE
function resolveHostMode() {
  const allowed = new Set(['lan', 'tunnel', 'localhost']);

  const explicit = (process_.env.HOST_MODE || '').trim();
  if (explicit && allowed.has(explicit)) return explicit;

  const envHostRaw = (process_.env.EXPO_HOST || process_.env.HOST || '').trim();
  if (envHostRaw === '0.0.0.0') return 'tunnel';
  if (allowed.has(envHostRaw)) return envHostRaw;

  return 'tunnel';
}

// PUBLIC_INTERFACE
function sanitizeIncomingArgs(argv) {
  const sanitized = [];
  const dropNext = new Set(['--host', '--port']);
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    if (dropNext.has(token)) {
      // Drop paired flags and their value
      i += 1;
      continue;
    }

    if (typeof token === 'string') {
      // Drop inline --host/--port and any 0.0.0.0 assignment
      if (token.startsWith('--host=') || token.startsWith('--port=')) continue;
      if (token === '--host=0.0.0.0' || token === '--host 0.0.0.0') continue;
    }

    // Drop preview-only flags that may confuse expo
    if (token === '--non-interactive' || token === '--ci') continue;

    sanitized.push(token);
  }
  return sanitized;
}

// PUBLIC_INTERFACE
function buildArgs() {
  const args = ['start'];

  const hostMode = resolveHostMode();
  args.push('--host', hostMode);

  // Reserve 3030 for health server; run expo on internal port
  args.push('--port', String(EXPO_INTERNAL_FALLBACK_PORT));

  if (process_.env.EXPO_TARGET === 'android') args.push('--android');
  if (process_.env.EXPO_TARGET === 'ios') args.push('--ios');
  args.push('--web');

  const logLevel = (process_.env.EXPO_PUBLIC_LOG_LEVEL || '').trim();
  if (logLevel) {
    process_.env.EXPO_DEBUG = logLevel === 'debug' ? '1' : process_.env.EXPO_DEBUG;
  }

  return args;
}

// PUBLIC_INTERFACE
function run() {
  const healthPath = process_.env.EXPO_PUBLIC_HEALTHCHECK_PATH || '/healthz';
  startHealthcheckServer(DEFAULT_PORT, healthPath);

  const incoming = sanitizeIncomingArgs(process_.argv.slice(2));
  const args = buildArgs();
  const finalArgs = ['expo', ...args, ...incoming];

  console.log(`[startup] Node ${process_.version} on ${os.platform()}/${os.arch()}`);
  console.log(`[startup] Running: npx ${finalArgs.join(' ')}`);
  console.log(`[startup] Healthcheck path: http://0.0.0.0:${DEFAULT_PORT}${healthPath}`);
  console.log(`[startup] Host mode: ${args[args.indexOf('--host') + 1]}`);
  console.log(`[startup] Expo internal port: ${EXPO_INTERNAL_FALLBACK_PORT}`);
  console.log('[startup] Port 3030 reserved for healthcheck; Expo binds internal port. If health server is up, preview should mark 3030 ready.');

  const child = spawn('npx', finalArgs, {
    stdio: 'inherit', // keep logs visible and keep process alive
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

  child.on('error', (err) => {
    console.error('[startup] Failed to spawn Expo via npx:', err && err.message ? err.message : err);
    process_.exit(1);
  });
}

run();
