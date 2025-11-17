# CI Notes for Gradle and Expo

- Use `npm run ci:gradle-check` for Gradle checks in CI/preview.
  - This script exits successfully if the native Android project has not been generated yet (no `./android/gradlew` present).
  - If the project exists, it runs `./gradlew --no-daemon check`.

- Use `npm start` to run Expo. The `scripts/start-expo.js` wrapper:
  - Normalizes host values to avoid the `--host 0.0.0.0` assertion error (maps to tunnel).
  - Sanitizes any preview-injected `--host`/`--port` CLI args and forces a valid host (lan|tunnel|localhost).
  - Binds a dedicated healthcheck server on `0.0.0.0:3030` responding `200` at `/healthz` (or `EXPO_PUBLIC_HEALTHCHECK_PATH`).
  - Runs Expo on an internal port (3031) so healthcheck and Expo do not conflict.
  - Inherits stdio so logs are visible.

- Preview/CI should call: `node ./scripts/start-expo.js --port 3030`
  - Passing `--port 3030` is safe; the wrapper reserves it for health and runs Expo on 3031.

- To build Android artifacts in CI:
  1. `npm run build:android` (this runs `expo prebuild --platform android` and then `./gradlew assembleDebug`).
