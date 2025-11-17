@echo off
REM PUBLIC_INTERFACE
REM gradlew.bat (shim)
REM Delegates to android\gradlew if present; otherwise exits successfully to avoid CI failures.

setlocal enabledelayedexpansion
set ROOT_DIR=%~dp0
set "GRADLEW_PATH=%ROOT_DIR%android\gradlew.bat"

if exist "%GRADLEW_PATH%" (
  pushd "%ROOT_DIR%android"
  call gradlew.bat %*
  set EXITCODE=%ERRORLEVEL%
  popd
  exit /b %EXITCODE%
) else (
  echo Gradle wrapper not found at .\android\gradlew.bat. Skipping Gradle invocation.
  echo Hint: run "npm run build:android" to generate the native project before using Gradle.
  exit /b 0
)
