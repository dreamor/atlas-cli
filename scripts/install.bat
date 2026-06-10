@echo off
REM Atlas CLI one-line installer for Windows (CMD entry point).
REM
REM Usage:
REM   curl -fsSL https://raw.githubusercontent.com/dreamor/atlas-cli/main/scripts/install.bat | cmd
REM   or double-click install.bat after downloading.
REM
REM Auto-detects PowerShell: if available, uses bootstrap.ps1 (richer);
REM otherwise falls back to bootstrap.bat (pure batch, no PowerShell needed).
REM All env overrides (ATLAS_HOME, GH_REPO, ATLAS_BOOTSTRAP_YES, ...) work in both modes.

setlocal enabledelayedexpansion

if "%GH_REPO%"=="" set GH_REPO=dreamor/atlas-cli
if "%GH_BRANCH%"=="" set GH_BRANCH=main

REM ---- detect PowerShell ----
where powershell.exe >nul 2>nul
if !ERRORLEVEL! equ 0 (
  set BOOTSTRAP_SCRIPT=bootstrap.ps1
  set BOOTSTRAP_URL=https://raw.githubusercontent.com/%GH_REPO%/%GH_BRANCH%/scripts/bootstrap.ps1
) else (
  echo [install] PowerShell not found, using batch fallback.
  set BOOTSTRAP_SCRIPT=bootstrap.bat
  set BOOTSTRAP_URL=https://raw.githubusercontent.com/%GH_REPO%/%GH_BRANCH%/scripts/bootstrap.bat
)

set TMP_SCRIPT=%TEMP%\atlas-bootstrap-%RANDOM%.%BOOTSTRAP_SCRIPT:*.=%
echo [install] Fetching %BOOTSTRAP_URL%

curl -fsSL --retry 3 -o "%TMP_SCRIPT%" "%BOOTSTRAP_URL%"
if %ERRORLEVEL% neq 0 (
  echo [install] Failed to download %BOOTSTRAP_SCRIPT%.
  echo [install] Set BOOTSTRAP_URL or GH_REPO/GH_BRANCH if using a fork or private mirror.
  exit /b 1
)

REM Execute the bootstrap script
if /i "%BOOTSTRAP_SCRIPT%"=="bootstrap.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%TMP_SCRIPT%" %*
) else (
  call "%TMP_SCRIPT%" %*
)
set EXIT_CODE=%ERRORLEVEL%

del "%TMP_SCRIPT%" 2>nul

if %EXIT_CODE% neq 0 (
  echo [install] %BOOTSTRAP_SCRIPT% exited with code %EXIT_CODE%
  exit /b %EXIT_CODE%
)