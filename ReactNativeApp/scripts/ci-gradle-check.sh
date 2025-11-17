#!/usr/bin/env bash
set -euo pipefail

# PUBLIC_INTERFACE
# ci-gradle-check.sh
# CI-safe wrapper that runs Android Gradle checks only if the native project exists.
# This prevents failures in preview environments where expo prebuild hasn't generated ./android/gradlew yet.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -d "${ROOT_DIR}/android" ] || [ ! -f "${ROOT_DIR}/android/gradlew" ]; then
  echo "Android native project not found (no ./android/gradlew). Skipping Gradle check in preview."
  exit 0
fi

echo "Android native project detected. Running Gradle check..."
cd "${ROOT_DIR}/android"
# Use --no-daemon for CI stability
./gradlew --no-daemon check
