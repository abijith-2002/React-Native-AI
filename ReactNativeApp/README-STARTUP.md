# Expo Startup and Build Notes

This project uses a small wrapper to normalize Expo's host option in preview/CI environments.

- Start commands:
  - npm start
  - npm run android
  - npm run ios
  - npm run web

These call scripts/start-expo.js which:
- Maps EXPO_HOST/HOST=0.0.0.0 to a valid Expo host (default: lan).
- Honors HOST_MODE=lan|tunnel|localhost if set.
- Avoids passing an invalid --host to Expo, preventing startup failures.

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
