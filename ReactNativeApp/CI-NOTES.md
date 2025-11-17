# CI Notes for Gradle and Expo

- Use `npm run ci:gradle-check` for Gradle checks in CI/preview.
  - This script exits successfully if the native Android project has not been generated yet (no `./android/gradlew` present).
  - If the project exists, it runs `./gradlew --no-daemon check`.

- Use `npm start` to run Expo. The `scripts/start-expo.js` wrapper:
  - Normalizes host values to avoid the `--host 0.0.0.0` assertion error.
  - Sanitizes any preview-injected `--host` CLI args and forces a valid host (lan|tunnel|localhost).
  - Honors `HOST_MODE` when provided.

- To build Android artifacts in CI:
  1. `npm run build:android` (this runs `expo prebuild --platform android` and then `./gradlew assembleDebug`).
