# install.ps1 — install dsh-plugin-github into a DSH profile (direct copy + manifest patch).
# Usage:  powershell -ExecutionPolicy Bypass -File .\install.ps1 [-ProfileDir <path>]
# Defaults to the packaged web profile. Backs up package.json before patching.
param(
  [string]$ProfileDir = "$env:USERPROFILE\.dsh\profiles\web"
)

$ErrorActionPreference = "Stop"
$PluginDir = $PSScriptRoot
$PluginName = "dsh-plugin-github"

if (-not (Test-Path (Join-Path $PluginDir "package.json"))) {
  throw "package.json not found in $PluginDir (run this script from the plugin directory)"
}
if (-not (Test-Path (Join-Path $ProfileDir "package.json"))) {
  throw "profile package.json not found at $ProfileDir"
}

# 1. Back up the profile manifest.
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = Join-Path $ProfileDir "package.json.bak-$stamp"
Copy-Item (Join-Path $ProfileDir "package.json") $backup -Force
Write-Host "backed up manifest -> $backup"

# 2. Copy the plugin into the profile's hoisted node_modules.
$target = Join-Path $ProfileDir "node_modules\$PluginName"
if (Test-Path $target) { Remove-Item $target -Recurse -Force }
New-Item -ItemType Directory -Path $target -Force | Out-Null
foreach ($rel in @("lib", "cordis.patch.yml", "package.json", "README.md", "README.zh.md")) {
  $src = Join-Path $PluginDir $rel
  if (Test-Path $src) {
    Copy-Item $src (Join-Path $target $rel) -Recurse -Force
  }
}
Write-Host "copied plugin -> $target"

# 3. Patch the profile manifest (idempotent).
$manifestPath = Join-Path $ProfileDir "package.json"
$m = Get-Content $manifestPath -Raw | ConvertFrom-Json -AsHashtable

if (-not $m.ContainsKey("dependencies")) { $m["dependencies"] = @{} }
$dep = $m["dependencies"]
if (-not ($dep -is [System.Collections.IDictionary])) {
  # ConvertFrom-Json -AsHashtable yields IDictionary; guard just in case.
  throw "unexpected dependencies shape"
}
# Absolute file: spec with forward slashes (matches how the plugin center pins artifacts).
$fileSpec = "file:$($PluginDir -replace '\\','/')"
$dep[$PluginName] = $fileSpec
$m["dependencies"] = $dep

if (-not $m.ContainsKey("dsh")) { $m["dsh"] = @{} }
$dsh = $m["dsh"]
if (-not ($dsh -is [System.Collections.IDictionary])) { throw "unexpected dsh shape" }
if (-not $dsh.ContainsKey("profile")) { $dsh["profile"] = @{} }
$profile = $dsh["profile"]
if (-not ($profile -is [System.Collections.IDictionary])) { throw "unexpected dsh.profile shape" }
if (-not $profile.ContainsKey("bundles")) { $profile["bundles"] = @() }
$bundles = [System.Collections.ArrayList]@($profile["bundles"])
if (-not $bundles.Contains($PluginName)) { [void]$bundles.Add($PluginName) }
$profile["bundles"] = @($bundles)
$dsh["profile"] = $profile
$m["dsh"] = $dsh

$json = $m | ConvertTo-Json -Depth 20
Set-Content -Path $manifestPath -Value $json -Encoding UTF8
Write-Host "updated $manifestPath"

Write-Host ""
Write-Host "done. contents of dsh.profile.bundles now:" 
$final = Get-Content $manifestPath -Raw | ConvertFrom-Json
$final.dsh.profile.bundles | ForEach-Object { Write-Host "  - $_" }
Write-Host ""
Write-Host "Reload / restart DeepSeek Harness so the host re-composes the profile (the new tools appear after reload)."