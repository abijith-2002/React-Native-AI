# Expo Startup and Build Notes

This project uses a wrapper to normalize Expo's host option in preview/CI environments, ensuring the app starts even if a preview system passes an invalid `--host 0.0.0.0`. It also configures the dev server to bind to port 3030 and exposes a readiness healthcheck that the preview system can detect.

- Start commands:
  - npm start (defaults to tunnel mode)
  - npm run start:tunnel
  - npm run start:lan
  - npm run start:localhost
  - npm run android (defaults to tunnel; override with HOST_MODE=lan)
  - npm run ios (defaults to tunnel; override with HOST_MODE=lan)
  - npm run web (defaults to tunnel; override with HOST_MODE=lan)

These call scripts/start-expo.js which:
- Maps EXPO_HOST/HOST=0.0.0.0 to a valid Expo host.
- Honors HOST_MODE=lan|tunnel|localhost if set (highest precedence).
- Defaults to tunnel mode when not specified, to support preview across networks/Android devices.
- Sanitizes any extra `--host` and `--port` arguments injected by the preview system and re-injects valid ones.
- Starts a lightweight standalone healthcheck server on http://0.0.0.0:3030/healthz (configurable via EXPO_PUBLIC_HEALTHCHECK_PATH) that always returns 200.
- Runs Expo dev server on an internal port (3031) to avoid conflicting with the healthcheck listener, keeps `--web` enabled for UI access, and preserves tunnel mode.
- Preview systems should invoke: `node ./scripts/start-expo.js --port 3030` (the wrapper ignores/normalizes conflicting flags and keeps 3030 reserved for health).
- Note: package.json cannot contain comments. This guidance is documented here for maintainers instead of inline comments in package.json.

Environment variables (see .env.example):
- HOST_MODE=lan|tunnel|localhost
- EXPO_HOST / HOST (if '0.0.0.0', wrapper maps to 'lan')
- EXPO_PUBLIC_TRUST_PROXY, EXPO_PUBLIC_LOG_LEVEL, EXPO_PUBLIC_HEALTHCHECK_PATH, etc.

Android build in CI/preview:
- The default `npm run build` is a no-op to avoid Gradle errors in environments without a generated android/ folder.
- A CI-safe `./gradlew` shim is present at the repository root of this container:
  - If `./android/gradlew` exists, it delegates to it.
  - If not, it exits 0 to avoid failing pipelines that call `./gradlew` directly.
- To build Android locally or in CI, run:
  npm run build:android
This will:
  - expo prebuild --platform android
  - cd android && ./gradlew assembleDebug

If you need iOS build scripts, mirror the pattern with `expo prebuild --platform ios` and Xcode build tooling.
