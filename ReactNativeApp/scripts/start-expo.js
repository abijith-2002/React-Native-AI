#!/usr/bin/env node
/**
 * PUBLIC_INTERFACE
 * start-expo.js
 * This wrapper normalizes host options for expo start to be compatible with preview environments.
 * It maps invalid host inputs like "0.0.0.0" to a valid expo host mode (lan|tunnel|localhost).
 * It also respects a HOST_MODE environment variable when provided.
 *
 * Environment variables:
 * - HOST_MODE: one of "lan", "tunnel", "localhost". If provided, used directly.
 * - EXPO_HOST or HOST: if set to "0.0.0.0", maps to "lan" by default.
 * - EXPO_PUBLIC_TRUST_PROXY: if "true", sets HTTP(S)_PROXY trust headers for certain environments.
 * - EXPO_PUBLIC_LOG_LEVEL: passed through to process.env for expo to pick up if supported.
 * - EXPO_PUBLIC_HEALTHCHECK_PATH: passed through untouched.
 * - EXPO_PUBLIC_FEATURE_FLAGS / EXPO_PUBLIC_EXPERIMENTS_ENABLED: passed through untouched.
 */

const { spawn } = require('node:child_process');

function resolveHostMode() {
  // Allow explicit override
  const explicit = process.env.HOST_MODE && String(process.env.HOST_MODE).trim();
  const allowed = new Set(['lan', 'tunnel', 'localhost']);
  if (explicit && allowed.has(explicit)) return explicit;

  // Preview systems may set EXPO_HOST or HOST to 0.0.0.0; map that to lan.
  const envHost = (process.env.EXPO_HOST || process.env.HOST || '').trim();
  if (envHost === '0.0.0.0') return 'lan';

  // If EXPO_HOST equals one of allowed, honor it.
  if (allowed.has(envHost)) return envHost;

  // Fallback for CI/preview where inbound connections go through a proxy
  // "lan" typically binds to the local network interface and is widely compatible.
  return 'lan';
}

function buildArgs() {
  const args = ['start'];

  const hostMode = resolveHostMode();
  args.push('--host', hostMode);

  // When certain preview systems inject an invalid --host 0.0.0.0 at the end,
  // we avoid passing that by being the only caller of expo with normalized args.
  // Forward platform flags if the parent npm script requested them via env
  if (process.env.EXPO_TARGET === 'android') args.push('--android');
  if (process.env.EXPO_TARGET === 'ios') args.push('--ios');
  if (process.env.EXPO_TARGET === 'web') args.push('--web');

  // Log level pass-through (Expo reads some envs internally)
  const logLevel = process.env.EXPO_PUBLIC_LOG_LEVEL;
  if (logLevel) {
    // Not all expo CLIs accept --log-level; set env only
    process.env.EXPO_DEBUG = logLevel === 'debug' ? '1' : process.env.EXPO_DEBUG;
  }

  return args;
}

function run() {
  const args = buildArgs();
  const child = spawn('npx', ['expo', ...args], {
    stdio: 'inherit',
    env: {
      ...process.env,
      // Suggest to node/expo we may be behind a proxy if configured
      TRUST_PROXY: process.env.EXPO_PUBLIC_TRUST_PROXY === 'true' ? '1' : process.env.TRUST_PROXY,
    },
    shell: false,
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });
}

run();
