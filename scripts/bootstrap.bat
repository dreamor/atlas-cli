@echo off
REM Atlas CLI bootstrap (Windows batch) — idempotent dependency installer.
REM
REM Fallback when PowerShell is not available. Mirrors bootstrap.sh.
REM Installs:
REM   1. atlas binary       → %ATLAS_HOME%\bin\atlas.exe
REM   2. Node.js runtime    → %ATLAS_HOME%\runtime\node (only if system node < 20)
REM   3. playwright + chromium → %ATLAS_HOME%\lib\node_modules\playwright
REM
REM Requires: Windows 10 1803+ (curl.exe + tar.exe built-in)
REM
REM Env overrides:
REM   ATLAS_HOME              install root (default: %USERPROFILE%\.atlas)
REM   ATLAS_RELEASE_TAG       atlas binary release (default: latest)
REM   GH_REPO                 owner/repo for binary download (default: dreamor/atlas-cli)
REM   NODE_VERSION            vendored node version (default: 20.18.0)
REM   NODE_MIRROR             node tarball mirror (default: https://nodejs.org/dist)
REM   PLAYWRIGHT_VERSION      pinned playwright version (default: 1.49.0)
REM   ATLAS_BOOTSTRAP_YES     non-interactive: skip the size confirmation prompt
REM   ATLAS_SKIP_PLAYWRIGHT   skip playwright/chromium install (read-only commands work without it)

setlocal enabledelayedexpansion

if "%ATLAS_HOME%"=="" set ATLAS_HOME=%USERPROFILE%\.atlas
set ATLAS_BIN=%ATLAS_HOME%\bin
set ATLAS_RUNTIME=%ATLAS_HOME%\runtime
set ATLAS_LIB=%ATLAS_HOME%\lib
if "%NODE_VERSION%"=="" set NODE_VERSION=20.18.0
if "%PLAYWRIGHT_VERSION%"=="" set PLAYWRIGHT_VERSION=1.49.0
if "%ATLAS_RELEASE_TAG%"=="" set ATLAS_RELEASE_TAG=latest
if "%GH_REPO%"=="" set GH_REPO=dreamor/atlas-cli
if "%NODE_MIRROR%"=="" set NODE_MIRROR=https://nodejs.org/dist

echo [bootstrap] ATLAS_HOME=%ATLAS_HOME% PLATFORM=windows-x64

REM ---- ensure_dirs ----
if not exist "%ATLAS_BIN%" mkdir "%ATLAS_BIN%"
if not exist "%ATLAS_RUNTIME%" mkdir "%ATLAS_RUNTIME%"
if not exist "%ATLAS_LIB%" mkdir "%ATLAS_LIB%"

REM ---- confirm_size ----
if not "%ATLAS_BOOTSTRAP_YES%"=="1" (
  set SIZE_MSG=
  if not exist "%ATLAS_BIN%\atlas.exe" set SIZE_MSG=!SIZE_MSG!  atlas binary  ~60MB\n
  where node >nul 2>nul && (
    for /f "tokens=1,2 delims=v." %%a in ('node -v 2^>nul') do set NODE_MAJOR=%%b
    if not defined NODE_MAJOR set NODE_MAJOR=0
  )
  if not defined NODE_MAJOR set NODE_MAJOR=0
  if !NODE_MAJOR! lss 20 (
    if not exist "%ATLAS_RUNTIME%\node\node.exe" set SIZE_MSG=!SIZE_MSG!  Node.js       ~30MB\n
  )
  if not "%ATLAS_SKIP_PLAYWRIGHT%"=="1" (
    if not exist "%ATLAS_LIB%\node_modules\playwright" (
      set SIZE_MSG=!SIZE_MSG!  playwright    ~30MB\n
      set SIZE_MSG=!SIZE_MSG!  chromium      ~120MB\n
    )
  )
  if not "!SIZE_MSG!"=="" (
    echo.
    echo [bootstrap] First-time setup will download:
    echo !SIZE_MSG!
    set /p ANSWER="[bootstrap] Continue? [y/N] "
    if /i not "!ANSWER!"=="y" (
      echo [bootstrap] Aborted.
      exit /b 1
    )
  )
)

REM ---- ensure_atlas ----
if exist "%ATLAS_BIN%\atlas.exe" (
  echo [bootstrap] atlas binary OK (%ATLAS_BIN%\atlas.exe)
) else (
  if "%ATLAS_RELEASE_TAG%"=="latest" (
    set ATLAS_URL=https://github.com/%GH_REPO%/releases/latest/download/atlas-windows-x64.exe
  ) else (
    set ATLAS_URL=https://github.com/%GH_REPO%/releases/download/%ATLAS_RELEASE_TAG%/atlas-windows-x64.exe
  )
  echo [bootstrap] Downloading atlas binary from !ATLAS_URL!
  curl -fsSL --retry 3 -o "%ATLAS_BIN%\atlas.exe" "!ATLAS_URL!"
  if errorlevel 1 (
    echo [bootstrap] Failed to download atlas binary.
    exit /b 1
  )
  echo [bootstrap] atlas binary installed.
)

REM ---- ensure_node + npm/npx shims ----
set ATLAS_NODE_BIN=
where node >nul 2>nul && (
  for /f "tokens=1,2 delims=v." %%a in ('node -v 2^>nul') do set NODE_MAJOR=%%b
  if not defined NODE_MAJOR set NODE_MAJOR=0
) || set NODE_MAJOR=0

if !NODE_MAJOR! geq 20 (
  echo [bootstrap] system node found -- using it
  for /f "delims=" %%a in ('where node') do set ATLAS_NODE_BIN=%%~dpa
  goto :install_shims
)

if exist "%ATLAS_RUNTIME%\node\node.exe" (
  echo [bootstrap] vendored node already at %ATLAS_RUNTIME%\node
  set ATLAS_NODE_BIN=%ATLAS_RUNTIME%\node\
  goto :install_shims
)

set NODE_ZIP_URL=%NODE_MIRROR%/v%NODE_VERSION%/node-v%NODE_VERSION%-win-x64.zip
set TMP_ZIP=%TEMP%\atlas-node-%NODE_VERSION%.zip
echo [bootstrap] Downloading Node %NODE_VERSION% from %NODE_ZIP_URL%
curl -fsSL --retry 3 -o "%TMP_ZIP%" "%NODE_ZIP_URL%"
if errorlevel 1 (
  echo [bootstrap] Failed to download Node.js.
  exit /b 1
)
echo [bootstrap] Extracting...
tar -xf "%TMP_ZIP%" -C "%ATLAS_RUNTIME%"
del "%TMP_ZIP%" 2>nul
move /y "%ATLAS_RUNTIME%\node-v%NODE_VERSION%-win-x64" "%ATLAS_RUNTIME%\node" >nul
set ATLAS_NODE_BIN=%ATLAS_RUNTIME%\node\
echo [bootstrap] Node installed at %ATLAS_RUNTIME%\node

:install_shims
REM node.exe — standalone, safe to copy
if not exist "%ATLAS_BIN%\node.exe" (
  copy "%ATLAS_NODE_BIN%\node.exe" "%ATLAS_BIN%\node.exe" >nul
  echo [bootstrap] copied node.exe to %ATLAS_BIN%\node.exe
)
REM npm.cmd / npx.cmd — absolute-path wrapper to avoid %~dp0 breakage
for %%C in (npm npx) do (
  if not exist "%ATLAS_BIN%\%%C.cmd" (
    if exist "%ATLAS_NODE_BIN%\%%C.cmd" (
      > "%ATLAS_BIN%\%%C.cmd" echo @echo off
      >> "%ATLAS_BIN%\%%C.cmd" echo "%ATLAS_NODE_BIN%\%%C.cmd" %%*
      echo [bootstrap] wrote %%C wrapper to %ATLAS_BIN%\%%C.cmd
    )
  )
)
REM Add to PATH for this session
set PATH=%ATLAS_BIN%;%PATH%

REM ---- ensure_playwright ----
if "%ATLAS_SKIP_PLAYWRIGHT%"=="1" (
  echo [bootstrap] Skipping playwright (ATLAS_SKIP_PLAYWRIGHT=1). auth login and daemon will not work.
  goto :done
)

if not exist "%ATLAS_LIB%\node_modules\playwright" (
  echo [bootstrap] Installing playwright@%PLAYWRIGHT_VERSION% into %ATLAS_LIB%
  if not exist "%ATLAS_LIB%\package.json" (
    pushd "%ATLAS_LIB%"
    call npm.cmd init -y >nul 2>&1
    popd
  )
  pushd "%ATLAS_LIB%"
  call npm.cmd install --silent --no-audit --no-fund playwright@%PLAYWRIGHT_VERSION%
  if errorlevel 1 (
    popd
    echo [bootstrap] npm install playwright failed.
    exit /b 1
  )
  popd
) else (
  echo [bootstrap] playwright already installed (%ATLAS_LIB%\node_modules\playwright)
)

echo [bootstrap] Installing chromium browser if missing
call "%ATLAS_LIB%\node_modules\.bin\playwright.cmd" install chromium

:done
echo.
echo [bootstrap] Done.
echo [bootstrap] To use atlas globally, add to your PATH:
echo     %ATLAS_BIN%
echo.
echo [bootstrap] First-time login (opens browser, requires playwright):
echo     %ATLAS_BIN%\atlas.exe auth login
echo.
echo [bootstrap] Quick test:
echo     %ATLAS_BIN%\atlas.exe --help