#!/usr/bin/env node
/**
 * PUBLIC_INTERFACE
 * sanitizeArgs
 * Ensures that any forwarded npm arguments do not include conflicting Expo host flags.
 * This prevents cases like: npm start -- --host 0.0.0.0 --lan
 * We remove any '--host'/'--tunnel'/'--localhost'/'--lan' occurrences from npm_config_argv
 * and rely on scripts to pass '--lan' explicitly.
 */
function sanitizeArgs() {
  /** This is a public function. */
  try {
    const raw = process.env.npm_config_argv;
    if (!raw) return;

    const parsed = JSON.parse(raw);
    const original = Array.isArray(parsed.original) ? parsed.original : [];
    const sanitized = [];
    let skipNext = false;

    for (let i = 0; i < original.length; i++) {
      if (skipNext) {
        skipNext = false;
        continue;
      }
      const arg = original[i];

      // Remove any host/lan/tunnel/localhost flags to avoid duplicates
      if (arg === '--host' || arg === '--lan' || arg === '--tunnel' || arg === '--localhost') {
        // if it's '--host', also skip the next value (like '0.0.0.0')
        if (arg === '--host') {
          skipNext = true;
        }
        continue;
      }
      // Also remove '--host=...' if used as single token
      if (arg.startsWith('--host=')) {
        continue;
      }

      sanitized.push(arg);
    }

    // Write back sanitized args for child npm lifecycle usage if any
    process.env.npm_config_argv = JSON.stringify({ remain: [], cooked: sanitized, original: sanitized });
  } catch {
    // Non-fatal if parsing fails; proceed without changes.
  }
}

sanitizeArgs();
