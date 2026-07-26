<#
.SYNOPSIS
  Create (and optionally boot) an Android **tablet** emulator for testing the
  Prowalco Calibration app on Windows.

.DESCRIPTION
  Installs the required Android SDK packages, then creates a Pixel Tablet AVD
  named "Prowalco_Tablet" (API 35, Google APIs). Idempotent: re-running skips
  work that's already done. See docs/android-tablet-testing.md for the full
  workflow (this only handles the emulator; the app is a dev-client EAS build).

.PARAMETER Name
  AVD name. Default: Prowalco_Tablet

.PARAMETER Api
  Android API level for the system image. Default: 35 (Android 15)

.PARAMETER Abi
  System image ABI. Default: x86_64. Use arm64-v8a on Windows-on-ARM.

.PARAMETER Boot
  After creating the AVD, launch the emulator.

.EXAMPLE
  ./scripts/create-android-tablet-avd.ps1 -Boot
#>
[CmdletBinding()]
param(
  [string]$Name = "Prowalco_Tablet",
  [int]$Api = 35,
  [ValidateSet("x86_64", "arm64-v8a")]
  [string]$Abi = "x86_64",
  [switch]$Boot
)

$ErrorActionPreference = "Stop"

# --- locate the Android SDK ---------------------------------------------------
$sdk = $env:ANDROID_HOME
if (-not $sdk) { $sdk = $env:ANDROID_SDK_ROOT }
if (-not $sdk) { $sdk = Join-Path $env:LOCALAPPDATA "Android\Sdk" }

if (-not (Test-Path $sdk)) {
  Write-Error @"
Android SDK not found at '$sdk'.
Install Android Studio (winget install Google.AndroidStudio) and open it once
so the SDK is downloaded, or set ANDROID_HOME to your SDK path, then re-run.
"@
}
Write-Host "Using Android SDK: $sdk" -ForegroundColor Cyan

function Resolve-SdkTool([string]$relativeGlobs) {
  foreach ($g in $relativeGlobs -split ";") {
    $hit = Get-ChildItem -Path (Join-Path $sdk $g) -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($hit) { return $hit.FullName }
  }
  return $null
}

$sdkmanager = Resolve-SdkTool "cmdline-tools\latest\bin\sdkmanager.bat;cmdline-tools\*\bin\sdkmanager.bat;tools\bin\sdkmanager.bat"
$avdmanager = Resolve-SdkTool "cmdline-tools\latest\bin\avdmanager.bat;cmdline-tools\*\bin\avdmanager.bat;tools\bin\avdmanager.bat"
$emulator   = Join-Path $sdk "emulator\emulator.exe"

if (-not $sdkmanager -or -not $avdmanager) {
  Write-Error @"
Could not find sdkmanager/avdmanager under '$sdk'.
In Android Studio: SDK Manager -> SDK Tools -> tick 'Android SDK Command-line
Tools (latest)', apply, then re-run this script.
"@
}

$image = "system-images;android-$Api;google_apis;$Abi"

# --- install required packages ------------------------------------------------
Write-Host "Installing SDK packages (platform-tools, emulator, $image)..." -ForegroundColor Cyan
# accept licences up front, then install
"y`n" * 20 | & $sdkmanager --licenses | Out-Null
& $sdkmanager "platform-tools" "emulator" $image

# --- create the AVD -----------------------------------------------------------
$existing = & $avdmanager list avd 2>$null | Select-String -SimpleMatch "Name: $Name"
if ($existing) {
  Write-Host "AVD '$Name' already exists - skipping creation." -ForegroundColor Yellow
} else {
  Write-Host "Creating tablet AVD '$Name' (Pixel Tablet profile)..." -ForegroundColor Cyan
  # 'no' declines the 'custom hardware profile' follow-up prompt
  "no`n" | & $avdmanager create avd -n $Name -k $image -d "pixel_tablet" --force
  Write-Host "Created AVD '$Name'." -ForegroundColor Green
}

# --- optional boot ------------------------------------------------------------
if ($Boot) {
  if (-not (Test-Path $emulator)) { Write-Error "emulator.exe not found at $emulator" }
  Write-Host "Booting '$Name'... (this window stays attached to the emulator)" -ForegroundColor Cyan
  & $emulator -avd $Name
} else {
  Write-Host ""
  Write-Host "Done. Boot it with:" -ForegroundColor Green
  Write-Host "  & `"$emulator`" -avd $Name"
  Write-Host "Then follow docs/android-tablet-testing.md (Part B) to install the"
  Write-Host "dev-client .apk and run 'npm start'."
}
