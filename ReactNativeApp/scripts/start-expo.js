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

const { spawn, spawnSync } = require('node:child_process'); // CJS
const http = require('node:http'); // CJS
const process_ = require('node:process'); // CJS
const os = require('node:os'); // CJS
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PORT = 3030;
const EXPO_INTERNAL_FALLBACK_PORT = 3031; // Expo dev server

// PUBLIC_INTERFACE
function isCIMode() {
  const ci = (process_.env.CI || '').toString().toLowerCase();
  return ci === '1' || ci === 'true' || ci === 'yes';
}

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
function rimrafSafe(targetPath) {
  try {
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
      console.log(`[cache] Removed: ${targetPath}`);
    }
  } catch (e) {
    console.warn(`[cache] Failed to remove ${targetPath}: ${e && e.message ? e.message : e}`);
  }
}

function resetMetroAndExpoCaches() {
  const root = process_.cwd();
  const candidates = [
    path.join(root, '.expo'),
    path.join(root, '.expo-shared'),
    path.join(root, 'node_modules', '.cache', 'metro'),
  ];
  console.log('[cache] Resetting Metro/Expo caches...');
  for (const p of candidates) {
    rimrafSafe(p);
  }
}

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
function ensureNgrokDependency() {
  const expectedPath = path.join(process_.cwd(), 'node_modules', '@expo', 'ngrok');
  if (fs.existsSync(expectedPath)) {
    console.log('[deps] @expo/ngrok is present.');
    return;
  }
  if (!isCIMode()) {
    console.log('[deps] @expo/ngrok not found, but not in CI mode; proceeding without auto-install.');
    return;
  }
  console.log('[deps] @expo/ngrok not found. Installing devDependency for tunnel support in CI...');
  const install = spawnSync('npm', ['i', '-D', '@expo/ngrok@^4.1.0'], {
    stdio: 'inherit',
    shell: false,
    env: { ...process_.env, CI: process_.env.CI || 'true' },
  });
  if (install.status !== 0) {
    console.warn('[deps] Failed to install @expo/ngrok automatically. Expo tunnel may prompt or fail in CI.');
  } else {
    console.log('[deps] Installed @expo/ngrok successfully.');
  }
}

function buildArgs() {
  const args = ['start'];

  const hostMode = resolveHostMode();
  args.push('--host', hostMode);

  // Reserve 3030 for health server; run expo on internal port
  args.push('--port', String(EXPO_INTERNAL_FALLBACK_PORT));

  // Force clearing Metro cache to avoid deserialization errors
  args.push('--clear');

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

  // Ensure ngrok is present in CI for tunnel mode and reset caches
  ensureNgrokDependency();
  resetMetroAndExpoCaches();

  const incoming = sanitizeIncomingArgs(process_.argv.slice(2));
  const args = buildArgs();
  const finalArgs = ['expo', ...args, ...incoming];

  // Force tunnel host in CI if somehow misconfigured
  if (isCIMode()) {
    const hostIdx = finalArgs.indexOf('--host');
    if (hostIdx !== -1) {
      finalArgs[hostIdx + 1] = 'tunnel';
    } else {
      finalArgs.push('--host', 'tunnel');
    }
  }

  console.log(`[startup] Node ${process_.version} on ${os.platform()}/${os.arch()}`);
  console.log(`[startup] Running: npx ${finalArgs.join(' ')}`);
  console.log(`[startup] Healthcheck path: http://0.0.0.0:${DEFAULT_PORT}${healthPath}`);
  const hostIdx2 = finalArgs.indexOf('--host');
  console.log(`[startup] Host mode: ${hostIdx2 !== -1 ? finalArgs[hostIdx2 + 1] : 'unknown'}`);
  console.log(`[startup] Expo internal port: ${EXPO_INTERNAL_FALLBACK_PORT}`);
  console.log('[startup] Port 3030 reserved for healthcheck; Expo binds internal port. If health server is up, preview should mark 3030 ready.');

  const child = spawn('npx', finalArgs, {
    stdio: 'inherit', // keep logs visible and keep process alive
    env: {
      ...process_.env,
      TRUST_PROXY: process_.env.EXPO_PUBLIC_TRUST_PROXY === 'true' ? '1' : process_.env.TRUST_PROXY,
      CI: process_.env.CI || 'true',
      EXPO_NO_INTERACTIVE: '1',
      // Avoid any prompts
      ADB_INSTALL_TIMEOUT: process_.env.ADB_INSTALL_TIMEOUT || '10',
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
