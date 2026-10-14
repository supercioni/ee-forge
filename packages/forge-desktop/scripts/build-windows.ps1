<#
 Builds the EE FORGE Windows installer on a Windows machine, from a source tree (this script is part of it).

   powershell -ExecutionPolicy Bypass -File packages\forge-desktop\scripts\build-windows.ps1

 Needs on the BUILD machine only: Node 22+ (with npm) and internet access to the npm registry and to GitHub (the
 Electron and NSIS binaries). The user who installs the result needs none of it.

 Steps: install exactly what pnpm-lock.yaml pins (the pnpm version comes from the root package.json), build the
 Forge packages and the editor, bundle the app, run electron-builder, verify the package content, write
 release\SHA256SUMS.txt and release\build-info.json. Nothing is signed and nothing is uploaded.
#>
param([string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path, [string]$Version = '')
$ErrorActionPreference = 'Stop'
Set-Location $Root
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

$pnpmVersion = ((Get-Content package.json -Raw | ConvertFrom-Json).packageManager -replace '^pnpm@', '')
Write-Host "node $(node --version), pnpm $pnpmVersion"
$tools = Join-Path $Root '.build-tools'
if (-not (Test-Path (Join-Path $tools 'node_modules\.bin\pnpm.cmd'))) {
  npm install --prefix $tools --no-audit --no-fund "pnpm@$pnpmVersion"
  if ($LASTEXITCODE -ne 0) { throw 'could not install pnpm' }
}
$pnpm = Join-Path $tools 'node_modules\.bin\pnpm.cmd'
# Child processes of the build (the notices step runs `pnpm licenses`) find this pnpm; none is installed globally.
$env:Path = (Join-Path $tools 'node_modules\.bin') + ';' + $env:Path

& $pnpm install --frozen-lockfile --filter "@forge/desktop..."
if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed' }
& $pnpm --filter "@forge/desktop..." run build
if ($LASTEXITCODE -ne 0) { throw 'build failed' }
$extra = @(); if ($Version -ne '') { $extra = @('--version', $Version) }
node packages\forge-desktop\scripts\build-installer.mjs --skip-bundle @extra
if ($LASTEXITCODE -ne 0) { throw 'installer build failed' }
