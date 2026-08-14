[CmdletBinding()]
param(
  [string]$EnvironmentFile,
  [switch]$Upload
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$resolvedEnvironmentFile = if ($EnvironmentFile) {
  $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($EnvironmentFile)
} else {
  Join-Path $projectRoot '.env.production'
}

if (-not (Test-Path -LiteralPath $resolvedEnvironmentFile -PathType Leaf)) {
  throw "Environment file not found: $resolvedEnvironmentFile"
}

$secretName = 'PRODUCTION_ENV_BASE64'
$repository = 'yfdevs/drama-sync-center'
$bytes = [IO.File]::ReadAllBytes($resolvedEnvironmentFile)
$base64 = [Convert]::ToBase64String($bytes)

Set-Clipboard -Value $base64
Write-Host "Copied $secretName to the clipboard from $resolvedEnvironmentFile"

if (-not $Upload) {
  Write-Host 'Paste it into GitHub: Settings > Secrets and variables > Actions'
  Write-Host 'Or install GitHub CLI and run: pnpm secret:update -- -Upload'
  exit 0
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw 'GitHub CLI (gh) is not installed. The encoded secret is still available on the clipboard.'
}

$base64 | & gh secret set $secretName --repo $repository
if ($LASTEXITCODE -ne 0) {
  throw "Failed to update $secretName in $repository"
}

Write-Host "Updated GitHub Actions secret $secretName in $repository"
