# Atlas CLI one-line installer for Windows.
#
# Usage:
#   iwr -useb https://raw.githubusercontent.com/dreamor/atlas-cli/main/scripts/install.ps1 | iex
#
# Downloads scripts/bootstrap.ps1 and runs it. All env overrides for bootstrap.ps1
# (ATLAS_HOME, GH_REPO, NODE_VERSION, ATLAS_BOOTSTRAP_YES, ...) work here too.

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$GhRepo       = if ($env:GH_REPO)        { $env:GH_REPO }        else { 'dreamor/atlas-cli' }
$GhBranch     = if ($env:GH_BRANCH)      { $env:GH_BRANCH }      else { 'main' }
$BootstrapUrl = if ($env:BOOTSTRAP_URL)  { $env:BOOTSTRAP_URL }  else { "https://raw.githubusercontent.com/$GhRepo/$GhBranch/scripts/bootstrap.ps1" }

function Write-Info($msg) { Write-Host "[install] $msg" -ForegroundColor Cyan }
function Write-Err($msg)  { Write-Host "[install] $msg" -ForegroundColor Red }

$tmp = Join-Path $env:TEMP "atlas-bootstrap-$([guid]::NewGuid()).ps1"
try {
  Write-Info "Fetching $BootstrapUrl"
  Invoke-WebRequest -UseBasicParsing -Uri $BootstrapUrl -OutFile $tmp
  # Detect PowerShell 7+ vs Windows PowerShell 5.1
  $pwsh = (Get-Process -Id $pid).Path
  & $pwsh -NoProfile -ExecutionPolicy Bypass -File $tmp @args
  if ($LASTEXITCODE -ne 0) {
    Write-Err "bootstrap.ps1 exited with code $LASTEXITCODE"
    exit $LASTEXITCODE
  }
} catch {
  Write-Err "Failed: $_"
  Write-Err "Set BOOTSTRAP_URL or GH_REPO/GH_BRANCH if using a fork or private mirror."
  exit 1
} finally {
  if (Test-Path $tmp) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}
