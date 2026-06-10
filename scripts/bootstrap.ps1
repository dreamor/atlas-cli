# Atlas CLI bootstrap (Windows) — idempotent dependency installer.
#
# Mirrors scripts/bootstrap.sh. Installs:
#   1. atlas binary       → $AtlasHome\bin\atlas.exe
#   2. Node.js runtime    → $AtlasHome\runtime\node (only if system node < 20)
#   3. playwright + chromium → $AtlasHome\lib\node_modules\playwright + browser cache
#
# Compatible with Windows PowerShell 5.1 (Win10 default) and PowerShell 7+.
#
# Env overrides:
#   ATLAS_HOME              install root (default: $env:USERPROFILE\.atlas)
#   ATLAS_RELEASE_TAG       atlas binary release (default: latest)
#   GH_REPO                 owner/repo for binary download (default: dreamor/atlas-cli)
#   NODE_VERSION            vendored node version (default: 20.18.0)
#   NODE_MIRROR             node tarball mirror (default: https://nodejs.org/dist)
#   PLAYWRIGHT_VERSION      pinned playwright version (default: 1.49.0)
#   PLAYWRIGHT_DOWNLOAD_HOST chromium mirror (passed to npm install)
#   ATLAS_BOOTSTRAP_YES     non-interactive: skip the size confirmation prompt
#   ATLAS_SKIP_PLAYWRIGHT   skip playwright/chromium install

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$AtlasHome        = if ($env:ATLAS_HOME)        { $env:ATLAS_HOME }        else { Join-Path $env:USERPROFILE '.atlas' }
$AtlasBin         = Join-Path $AtlasHome 'bin'
$AtlasRuntime     = Join-Path $AtlasHome 'runtime'
$AtlasLib         = Join-Path $AtlasHome 'lib'
$NodeVersion      = if ($env:NODE_VERSION)      { $env:NODE_VERSION }      else { '20.18.0' }
$PlaywrightVer    = if ($env:PLAYWRIGHT_VERSION){ $env:PLAYWRIGHT_VERSION }else { '1.49.0' }
$ReleaseTag       = if ($env:ATLAS_RELEASE_TAG) { $env:ATLAS_RELEASE_TAG } else { 'latest' }
$GhRepo           = if ($env:GH_REPO)           { $env:GH_REPO }           else { 'dreamor/atlas-cli' }
$NodeMirror       = if ($env:NODE_MIRROR)       { $env:NODE_MIRROR }       else { 'https://nodejs.org/dist' }
$Platform         = 'windows-x64'

function Write-Log($msg)  { Write-Host "[bootstrap] $msg" -ForegroundColor Cyan }
function Write-Warn2($msg){ Write-Host "[bootstrap] $msg" -ForegroundColor Yellow }
function Write-Err2($msg) { Write-Host "[bootstrap] $msg" -ForegroundColor Red }

function Ensure-Dirs {
  foreach ($d in @($AtlasBin, $AtlasRuntime, $AtlasLib)) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
  }
}

function Confirm-Size {
  if ($env:ATLAS_BOOTSTRAP_YES -eq '1') { return }
  if (-not [Environment]::UserInteractive) { return }
  $msg = ''
  $atlasExe = Join-Path $AtlasBin 'atlas.exe'
  if (-not (Test-Path $atlasExe)) { $msg += "  atlas binary  ~60MB`n" }
  $needNode = $true
  try {
    $v = (& node -v) 2>$null
    if ($LASTEXITCODE -eq 0 -and $v -match '^v(\d+)') {
      if ([int]$Matches[1] -ge 20) { $needNode = $false }
    }
  } catch { }
  if ($needNode -and -not (Test-Path (Join-Path $AtlasRuntime 'node\node.exe'))) {
    $msg += "  Node.js       ~30MB`n"
  }
  if ($env:ATLAS_SKIP_PLAYWRIGHT -ne '1' -and -not (Test-Path (Join-Path $AtlasLib 'node_modules\playwright'))) {
    $msg += "  playwright    ~30MB`n"
    $msg += "  chromium      ~120MB`n"
  }
  if ([string]::IsNullOrEmpty($msg)) { return }
  Write-Host ""
  Write-Host "[bootstrap] First-time setup will download:" -ForegroundColor Cyan
  Write-Host $msg
  $answer = Read-Host "[bootstrap] Continue? [y/N]"
  if ($answer -notmatch '^[yY]') { Write-Err2 'Aborted.'; exit 1 }
}

function Ensure-Atlas {
  $atlasExe = Join-Path $AtlasBin 'atlas.exe'

  # Local-repo fallback — 有本地编译二进制优先使用
  $scriptDir = Split-Path -Parent $PSCommandPath
  $repoRoot  = Split-Path -Parent $scriptDir
  $localBin  = Join-Path $repoRoot 'dist-bun\atlas-windows-x64.exe'
  $pkgJson   = Join-Path $repoRoot 'package.json'
  if (Test-Path $pkgJson) {
    if ((Select-String -Path $pkgJson -Pattern 'build:bun:win-x64' -Quiet) -and -not (Test-Path $localBin)) {
      $bun = Get-Command bun -ErrorAction SilentlyContinue
      if ($bun) {
        Write-Log 'Building atlas binary locally via `bun build --compile`'
        Push-Location $repoRoot
        try { & npm.cmd run build:bun:win-x64 | Out-Null } finally { Pop-Location }
      }
    }
    if (Test-Path $localBin) {
      Write-Log "Using local build $localBin"
      Copy-Item $localBin $atlasExe -Force
      return
    }
  }

  # 从 GitHub Releases 下载最新版（每次都覆盖，确保最新）
  $artifact = "atlas-$Platform.exe"
  if ($ReleaseTag -eq 'latest') {
    $url = "https://github.com/$GhRepo/releases/latest/download/$artifact"
  } else {
    $url = "https://github.com/$GhRepo/releases/download/$ReleaseTag/$artifact"
  }
  Write-Log "Downloading atlas binary from $url"
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $atlasExe
  } catch {
    Write-Err2 "Failed to download atlas binary: $_"
    Write-Err2 'Hint: set GH_REPO or ATLAS_RELEASE_TAG, or run `npm run build:bun:win-x64` locally.'
    exit 1
  }
  Write-Log 'atlas binary installed.'
}

function Ensure-Node {
  $script:AtlasNodeBin = $null
  try {
    $v = (& node -v) 2>$null
    if ($LASTEXITCODE -eq 0 -and $v -match '^v(\d+)') {
      if ([int]$Matches[1] -ge 20) {
        Write-Log "system node $v found — using it"
        $script:AtlasNodeBin = Split-Path -Parent (Get-Command node).Path
        Install-NpmShims
        return
      }
      Write-Warn2 "system node $v is too old (need >=20), installing vendored copy"
    }
  } catch { }

  $vendoredNode = Join-Path $AtlasRuntime 'node\node.exe'
  if (Test-Path $vendoredNode) {
    Write-Log "vendored node already at $AtlasRuntime\node"
    $script:AtlasNodeBin = Join-Path $AtlasRuntime 'node'
    Install-NpmShims
    return
  }

  $folder  = "node-v$NodeVersion-win-x64"
  $url     = "$NodeMirror/v$NodeVersion/$folder.zip"
  $tmpZip  = Join-Path $env:TEMP "atlas-node-$NodeVersion.zip"
  Write-Log "Downloading Node $NodeVersion from $url"
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $tmpZip
  Expand-Archive -Path $tmpZip -DestinationPath $AtlasRuntime -Force
  Remove-Item $tmpZip -Force
  $extracted = Join-Path $AtlasRuntime $folder
  Move-Item $extracted (Join-Path $AtlasRuntime 'node') -Force
  $script:AtlasNodeBin = Join-Path $AtlasRuntime 'node'
  Install-NpmShims
  Write-Log "Node installed at $AtlasRuntime\node"
}

# Create wrapper .cmd files in $AtlasBin that reference the real node bin dir.
# We cannot simply copy npm.cmd/npx.cmd because they use %~dp0 relative
# paths internally and would break when moved elsewhere.
function Install-NpmShims {
  $binDir = $script:AtlasNodeBin
  $targetDir = $AtlasBin

  # node.exe — standalone binary, safe to copy
  $srcNode = Join-Path $binDir 'node.exe'
  $dstNode = Join-Path $targetDir 'node.exe'
  if ((Test-Path $srcNode) -and -not (Test-Path $dstNode)) {
    Copy-Item $srcNode $dstNode -Force
    Write-Log "copied node.exe → $dstNode"
  }

  # npm.cmd / npx.cmd — wrap with absolute path to avoid %~dp0 breakage.
  # CMD does not require backslash escaping inside string literals, so emit
  # the raw path verbatim.
  foreach ($cmd in @('npm', 'npx')) {
    $src = Join-Path $binDir "$cmd.cmd"
    $dst = Join-Path $targetDir "$cmd.cmd"
    if ((Test-Path $src) -and -not (Test-Path $dst)) {
      $wrapper = "@echo off`r`n`"$binDir\$cmd.cmd`" %*"
      [System.IO.File]::WriteAllText($dst, $wrapper, [System.Text.Encoding]::ASCII)
      Write-Log "wrote $cmd wrapper → $dst (points to $binDir)"
    }
  }

  # Add $AtlasBin to PATH for this session so npm/npx are resolvable
  if ($env:Path -notlike "*$targetDir*") {
    $env:Path = "$targetDir;$env:Path"
  }
}

function Ensure-Playwright {
  if ($env:ATLAS_SKIP_PLAYWRIGHT -eq '1') {
    Write-Warn2 'Skipping playwright (ATLAS_SKIP_PLAYWRIGHT=1). `auth login` and `daemon` will not work.'
    return
  }
  $pwDir = Join-Path $AtlasLib 'node_modules\playwright'
  $npm   = Join-Path $script:AtlasNodeBin 'npm.cmd'
  if (-not (Test-Path $pwDir)) {
    Write-Log "Installing playwright@$PlaywrightVer into $AtlasLib"
    if (-not (Test-Path (Join-Path $AtlasLib 'package.json'))) {
      Push-Location $AtlasLib
      try { & $npm init -y | Out-Null } finally { Pop-Location }
    }
    Push-Location $AtlasLib
    try {
      & $npm install --silent --no-audit --no-fund "playwright@$PlaywrightVer"
      if ($LASTEXITCODE -ne 0) { throw "npm install playwright failed" }
    } finally { Pop-Location }
  } else {
    Write-Log "playwright OK ($pwDir)"
  }
  $pwCli = Join-Path $AtlasLib 'node_modules\.bin\playwright.cmd'
  Write-Log 'Installing chromium browser if missing'
  & $pwCli install chromium
}

function Print-Done {
  Write-Host ''
  Write-Host '[bootstrap] Done. To use atlas globally, add to your PowerShell profile:' -ForegroundColor Cyan
  Write-Host "    `$env:Path = `"$AtlasBin;`$env:Path`""
  Write-Host "    `$env:ATLAS_HOME = `"$AtlasHome`""
  Write-Host ''
  Write-Host '[bootstrap] First-time login (opens browser, requires playwright):' -ForegroundColor Cyan
  Write-Host "    & `"$AtlasBin\atlas.exe`" auth login"
  Write-Host ''
  Write-Host '[bootstrap] Quick test:' -ForegroundColor Cyan
  Write-Host "    & `"$AtlasBin\atlas.exe`" --help"
}

Write-Log "ATLAS_HOME=$AtlasHome PLATFORM=$Platform"
Ensure-Dirs
Confirm-Size
Ensure-Atlas
Ensure-Node
Ensure-Playwright
Print-Done
