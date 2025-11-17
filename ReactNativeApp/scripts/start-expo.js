#!/usr/bin/env node
/**
 * PUBLIC_INTERFACE
 * start-expo.js
 * Wrapper that normalizes host options for "expo start" in preview/CI environments.
 * - Ensures Expo receives a valid host value (lan|tunnel|localhost).
 * - Maps invalid inputs like "0.0.0.0" to "lan".
 * - Ignores any extra CLI --host passed by the preview system and re-injects a valid one.
 *
 * Environment variables:
 * - HOST_MODE: "lan" | "tunnel" | "localhost" (highest precedence if valid)
 * - EXPO_HOST or HOST: if "0.0.0.0", will be normalized to "lan"; if valid, will be honored
 * - EXPO_PUBLIC_TRUST_PROXY, EXPO_PUBLIC_LOG_LEVEL, EXPO_PUBLIC_HEALTHCHECK_PATH,
 *   EXPO_PUBLIC_FEATURE_FLAGS, EXPO_PUBLIC_EXPERIMENTS_ENABLED: passed through in env
 */

const { spawn } = require('node:child_process');

function resolveHostMode() {
  const allowed = new Set(['lan', 'tunnel', 'localhost']);

  // 1) Explicit override by HOST_MODE
  const explicit = (process.env.HOST_MODE || '').trim();
  if (explicit && allowed.has(explicit)) return explicit;

  // 2) Preview-injected raw host values
  const envHostRaw = (process.env.EXPO_HOST || process.env.HOST || '').trim();
  if (envHostRaw === '0.0.0.0') return 'lan';
  if (allowed.has(envHostRaw)) return envHostRaw;

  // 3) Fallback default
  return 'lan';
}

/**
 * Remove any invalid or conflicting host flags from incoming CLI args (if the preview system
 * appended them when invoking this script through npm). We always control the final --host.
 */
function sanitizeIncomingArgs(argv) {
  const sanitized = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--host') {
      // Skip this and its following value (could be 0.0.0.0)
      i += 1;
      continue;
    }
    // Also skip shorthand formats like --host=0.0.0.0
    if (token.startsWith('--host=')) {
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

  // Forward platform flags via env variable set by npm scripts
  if (process.env.EXPO_TARGET === 'android') args.push('--android');
  if (process.env.EXPO_TARGET === 'ios') args.push('--ios');
  if (process.env.EXPO_TARGET === 'web') args.push('--web');

  // Optional: set debug verbosity by env (not all CLIs accept a flag)
  const logLevel = (process.env.EXPO_PUBLIC_LOG_LEVEL || '').trim();
  if (logLevel) {
    process.env.EXPO_DEBUG = logLevel === 'debug' ? '1' : process.env.EXPO_DEBUG;
  }

  return args;
}

function run() {
  // In some CI systems, npm passes any extra args after the script name.
  // Sanitize those to ensure no conflicting --host slips through.
  const incoming = sanitizeIncomingArgs(process.argv.slice(2));

  const args = buildArgs();
  const finalArgs = ['expo', ...args, ...incoming];

  const child = spawn('npx', finalArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
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
