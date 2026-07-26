# Testing on an Android tablet emulator (Windows)

This guide gets the Prowalco Calibration app running on an **Android tablet
emulator** on a **Windows** machine, using an **EAS cloud build** of the
dev client.

> **Why not just Expo Go?** This app ships native modules that Expo Go does not
> contain — `react-native-quick-crypto` (binary SHA-256 of the PDF),
> `expo-local-authentication` (biometric sign gate), `expo-secure-store`,
> `expo-sqlite`. You must run a **dev client** build, not Expo Go. See
> `mobile/package.json` and the plugin list in `mobile/app.json`.

> **Why a cloud build?** With the EAS path you don't need a working local
> Android *compile* toolchain (NDK, Gradle, native SDK build). Expo compiles the
> `.apk` in the cloud; you only need the emulator to run it, plus Node to serve
> the JS bundle over Metro. The backend and Supabase are already deployed
> (URLs baked into `mobile/eas.json` / `app.config.js`), so you don't run any
> server locally either.

The whole loop, once set up: **boot the tablet AVD → drag the dev-client `.apk`
on → `npm start` → the app connects to Metro over Wi-Fi/USB bridge.** After the
first build you only rebuild when you add or upgrade a native module; day-to-day
JS changes hot-reload over Metro.

---

## Part A — one-time setup

### 1. Install the tools

| Tool | How | Notes |
|---|---|---|
| **Node.js LTS** | https://nodejs.org (or `winget install OpenJS.NodeJS.LTS`) | v20+ |
| **Git** | `winget install Git.Git` | |
| **Android Studio** | https://developer.android.com/studio (or `winget install Google.AndroidStudio`) | Brings the SDK, emulator, AVD Manager, and `adb`. |
| **EAS CLI** | `npm install -g eas-cli` | The cloud build tool. |
| **Expo account** | `eas login` (free — sign up at https://expo.dev if needed) | Required for cloud builds. |

Enable hardware acceleration (makes the emulator usable instead of a slideshow):

1. Windows Search → **"Turn Windows features on or off"**.
2. Tick **Windows Hypervisor Platform**. (Leave Hyper-V as-is; the modern
   Android emulator uses WHPX.) Reboot.

> If Docker Desktop / WSL2 / Hyper-V are already using the hypervisor, the
> emulator still works via WHPX — no extra action needed. If the emulator later
> complains about acceleration, open Android Studio → **SDK Manager → SDK Tools**
> and confirm **Android Emulator hypervisor driver** is installed.

### 2. Create the Android tablet AVD (Android Virtual Device)

**GUI route (easiest):**

1. Open Android Studio → **More Actions → Virtual Device Manager** (or
   **Tools → Device Manager** inside a project).
2. **Create Device** → category **Tablet** → pick **Pixel Tablet**
   (10.95", 2560×1600, the reference Android tablet) → **Next**.
3. System image: choose an **API 35** (Android 15) image, ABI **x86_64**,
   target **"Google APIs"**. Click the download arrow, accept the licence,
   wait for it. → **Next**.
4. Name it **`Prowalco_Tablet`** → **Finish**.

> On **Windows on ARM** (Snapdragon devices) pick the **arm64-v8a** image
> instead of x86_64.

**Command-line route** (no Android Studio window needed) — see
`scripts/create-android-tablet-avd.ps1`, or run the equivalent by hand:

```powershell
# Adjust the SDK path if you installed it elsewhere
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path += ";$sdk\cmdline-tools\latest\bin;$sdk\emulator;$sdk\platform-tools"

sdkmanager "platform-tools" "emulator" "system-images;android-35;google_apis;x86_64"
# creates a Pixel Tablet profile AVD called Prowalco_Tablet
avdmanager create avd -n Prowalco_Tablet -k "system-images;android-35;google_apis;x86_64" -d "pixel_tablet"
```

### 3. Build the dev client in the cloud

From the repo root, in a terminal:

```powershell
cd mobile
npm install
eas init            # links this app to your Expo project (first time only)
eas build --profile development --platform android
```

`eas build` runs for ~10–20 min in the cloud. When it finishes it prints a
**build page URL** and a direct **`.apk` download link**. Download that `.apk`
to your PC. (The `development` profile in `mobile/eas.json` already carries the
correct `EXPO_PUBLIC_*` values — the deployed API + Supabase — so the build is
fully configured.)

> You rebuild the `.apk` **only** when native dependencies change. Editing
> screens, forms, schema, styles, etc. is pure JS and reloads live over Metro —
> no rebuild.

---

## Part B — the run loop (every time)

### 1. Boot the tablet

```powershell
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
& "$sdk\emulator\emulator.exe" -avd Prowalco_Tablet
```

(or just hit ▶ next to `Prowalco_Tablet` in Android Studio's Device Manager).
Wait until you see the Android home screen. Confirm the device is visible:

```powershell
& "$sdk\platform-tools\adb.exe" devices
# should list:  emulator-5554   device
```

### 2. Install the dev-client APK (first run, and after any rebuild)

Drag the downloaded `.apk` file **onto the emulator window** — it installs
automatically. Or:

```powershell
& "$sdk\platform-tools\adb.exe" install -r path\to\your-build.apk
```

You'll now have a **"Prowalco Calibration (dev)"** app icon on the tablet.

### 3. Start Metro and connect

```powershell
cd mobile
npm start          # = expo start --dev-client
```

Then press **`a`** in the Metro terminal to launch on the running emulator, or
open the **Prowalco Calibration** app on the tablet and tap the dev-server URL.
The app loads, talks to the deployed backend + Supabase, and JS edits
hot-reload.

---

## App-specific emulator tips

This app leans on device features. The emulator can simulate all of them:

- **Biometric sign gate.** Signing a certificate requires
  `expo-local-authentication`. On the emulator: **Settings → Security →
  Fingerprint**, enroll one (it'll ask you to "touch the sensor" — simulate the
  touch from a second terminal with
  `adb -e emu finger touch 1`). Then during the app's sign step, trigger the
  same command to pass the prompt. If no biometric is enrolled the app falls
  back to device PIN — set a PIN under **Settings → Security** to exercise that
  path.
- **GPS (audit trail, POPIA consent).** Emulator toolbar (⋯ **Extended
  controls**) → **Location** → set lat/long → **Send**. Try a Johannesburg
  point, e.g. `-26.2041, 28.0473`.
- **Camera / barcode scan** (seals, totaliser, serial QR). Extended controls →
  **Camera** uses a virtual scene; for barcode testing, point the virtual
  camera at an on-screen QR, or use the "VirtualScene" wall images.
- **Tablet layout.** Pixel Tablet is landscape-first at 2560×1600. `app.json`
  sets `orientation: portrait` and `ios.supportsTablet: true`; rotate the
  emulator (Ctrl+Left/Right, or the rotate button) to check both orientations
  for the certificate form and PDF preview.
- **Offline sign queue.** To test the durable queue + idempotent retry: put the
  emulator in **Airplane mode** (or Extended controls → **Cellular → Data
  status: Denied**), complete a sign, confirm it queues, then restore
  connectivity and confirm the certificate issues exactly once.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `adb: command not found` | Add `%LOCALAPPDATA%\Android\Sdk\platform-tools` to your PATH, or use the full path as shown above. |
| Emulator boots to a black screen / very slow | Hardware acceleration isn't active. Re-check **Windows Hypervisor Platform** is enabled and reboot; in Extended controls the emulator reports the active accelerator. |
| App opens but can't reach Metro | Make sure `npm start` is running; press `a`; or in the dev client enter `exp://<your-PC-LAN-IP>:8081`. On stubborn networks: `adb reverse tcp:8081 tcp:8081`. |
| "Something went wrong" reaching the API | The backend is the deployed Render service (free tier — first request after idle can take ~30–60 s to wake). Retry once it's warm. |
| Google/Microsoft/Apple sign-in fails | Those providers must be enabled in the Supabase dashboard (see `docs/supabase-setup.md`). The emulator itself doesn't need Google Play — sign-in is a browser (PKCE) flow via `expo-web-browser`. |
| Build fails on a native module | Confirm `mobile/package.json` versions match the Expo SDK (`npx expo install --check`), then rebuild. |

---

## TL;DR

```powershell
# one-time
winget install Google.AndroidStudio OpenJS.NodeJS.LTS Git.Git
npm i -g eas-cli && eas login
# create Prowalco_Tablet AVD (GUI or scripts/create-android-tablet-avd.ps1)
cd mobile && npm install && eas init
eas build --profile development --platform android   # download the .apk

# every run
emulator -avd Prowalco_Tablet          # boot tablet
adb install -r your-build.apk          # first time / after native changes
npm start                              # then press `a`
```
