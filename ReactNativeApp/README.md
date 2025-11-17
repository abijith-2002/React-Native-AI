# ReactNativeApp (Expo)

This app uses Expo with Metro bundler. The preview environment expects the dev server to be reachable and report ready status on a fixed port.

## Local development
- Install dependencies: `npm install`
- Start Expo (Metro on 3030): `npm run start`
- Start for web on 3030: `npm run web`

## CI/Preview usage
- Use `npm run ci:preview` to start the Expo dev server (Metro) on port 3030 without invoking native builds.
- Do not run Gradle for preview; native projects are not generated until `expo prebuild`.
- The `npm run build` script is a no-op message for preview environments to avoid triggering Gradle inadvertently.

## Host and binding
- Expo CLI must be passed a single valid host option. We use `--lan` exclusively (equivalent to `--host lan`).
- Do NOT pass an additional `--host 0.0.0.0`; that is invalid and conflicts with `--lan`.
- NPM argument forwarding is sanitized by a `prestart` script to strip any extra host flags appended by external tooling.
- Metro still binds to `0.0.0.0` so external health checks can connect. This is controlled via:
  - metro.config.js (server config and port)
  - EXPO_DEV_HOST env (defaults to `0.0.0.0`) consumed by app.config.js

## Healthcheck
The Metro server exposes a simple healthcheck endpoint at:
- Path: `/healthz` (override with EXPO_PUBLIC_HEALTHCHECK_PATH)
- Port: 3030 (override with METRO_PORT)
- Readiness check example: `curl -i http://localhost:3030${EXPO_PUBLIC_HEALTHCHECK_PATH:-/healthz}` should return `200 OK` with a small JSON body.

## Environment
See `.env.example` for environment variables you can configure:
- METRO_PORT (default: 3030)
- EXPO_DEV_HOST (default: 0.0.0.0)
- EXPO_PUBLIC_* flags consumed by app.config.js
- EXPO_PUBLIC_HEALTHCHECK_PATH (default: /healthz)

## Expected start command
External systems should run:
- `npm start` which resolves to:
  - `EXPO_DEV_HOST=0.0.0.0 METRO_PORT=3030 expo start --lan --port 3030`
- This ensures Metro binds to 0.0.0.0:3030 and the healthcheck is available.
