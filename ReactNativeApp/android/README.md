# Android Stub for Preview

This directory intentionally contains a minimal stub so that external CI systems or quality checks that try to invoke `./gradlew` do not fail with "No such file or directory". 

- For preview, use Expo/Metro dev server:
  - `npm run ci:preview` (binds to port 3030)
  - Healthcheck: `/healthz` on the same port
- Native builds are intentionally skipped in preview. To enable real native builds, run:
  - `npm run prebuild:android` (generates a full android project)
  - Update CI to use the generated native project
