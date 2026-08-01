# Running the app on an Android emulator

How to get the Prowalco calibration app running on an Android Virtual Device
(AVD) on your own machine. A helper script automates most of it:

```bash
bash scripts/android-emulator.sh doctor    # what is installed, what is missing
bash scripts/android-emulator.sh install   # install the SDK packages
bash scripts/android-emulator.sh up        # create (if needed) and boot the AVD
bash scripts/android-emulator.sh run       # build and install the app
```

The rest of this document explains what those steps do, what still has to be
done by hand, and how to read the errors when something fails.

## Expo Go will not work, and why

The app depends on native modules that are not in the Expo Go binary:
`react-native-quick-crypto` (SHA-256 of the rendered PDF and the device
signing key), `expo-local-authentication` (the biometric gate before signing)
and `expo-sqlite` (the offline store and sign queue). The emulator therefore
needs a **development build**, the same requirement as a physical device.

Three things about this app trip up a stock AVD. They are worth knowing before
you start, because each one fails in a way that looks like an app bug:

1. **Signing needs a screen lock.** `enqueueForSigning`
   (`mobile/src/queue/signQueue.ts:51`) calls `LocalAuthentication.authenticateAsync`
   with device fallback allowed, so Android accepts either a biometric or the
   device PIN. A fresh AVD has neither, so the prompt cannot be shown and the
   Sign step fails with "Identity confirmation cancelled".
2. **Sign-in needs a browser.** `AuthContext` opens the Supabase PKCE flow with
   `WebBrowser.openAuthSessionAsync`, which uses a Chrome Custom Tab. A plain
   AOSP system image has no browser, so pick a Google APIs or Google Play
   image.
3. **The first build compiles C++.** `react-native-quick-crypto` builds through
   CMake, so the NDK and CMake have to be installed, not just the SDK platform.
   Missing them produces a late Gradle failure that does not name the cause.

## 0. Check your machine can run an emulator at all

| Host | Emulator | Notes |
|---|---|---|
| Windows on x86_64 (Intel, AMD) | Yes | Use Windows Hypervisor Platform, see section 1 |
| **Windows on ARM (Snapdragon, Copilot+ PCs)** | **No** | Google publishes no emulator binaries for win-arm64. The official requirement is an x86_64 CPU, and the tracking issue ([264614669](https://issuetracker.google.com/issues/264614669)) is open |
| macOS, Intel or Apple Silicon | Yes | Apple Silicon runs arm64 images natively |
| Linux on x86_64 | Yes | Needs KVM |

On Windows on ARM the symptoms are confusing rather than explicit: **Android
Emulator** cannot be ticked in SDK Tools, and the **Android Emulator hypervisor
driver (AEHD)** fails to install because it is an x86-only driver (and is being
retired on 31 December 2026 regardless). Neither error says "wrong CPU". Do not
spend time on the SDK Manager: there is nothing to install.

### The no-emulator route: a real tablet, built in the cloud

This needs no local toolchain, no terminal, and no emulator, and it runs on the
hardware the app is actually for:

1. On GitHub: **Actions**, **eas-build**, **Run workflow**
2. Platform **android**, profile **preview**, run it
3. About 15 minutes later the run summary links to the Expo build page with an
   install QR code and an APK
4. Open it on an Android tablet and install

The `preview` profile is standalone: the JavaScript is embedded, so nothing has
to keep running on a computer, and it already points at the deployed backend
and Supabase project. The workflow needs an `EXPO_TOKEN` repository secret and
fails immediately with an explanation if it is missing.

Use this if your machine cannot run an emulator, and prefer it in general for
anything about real-world feel: touch targets, the signature pad with a finger,
sunlight readability, poor connectivity.

## 1. Prerequisites

| Component | Version | Notes |
|---|---|---|
| Node | 20 or newer | CI uses 22 |
| JDK | 17 | React Native 0.81 needs 17 or newer. Android Studio's bundled JBR is fine |
| Android SDK platform | API 36 | Expo SDK 54 compiles and targets API 36, minimum is API 24 |
| Build tools | 36.0.0 | |
| NDK | 27.1.12297006 | Required by react-native-quick-crypto |
| CMake | 3.22.1 | Same |
| System image | API 35 or 36, Google Play or Google APIs | Needs a browser for the OAuth tab |

Install Android Studio (it brings the SDK, the emulator and a usable JDK), then
point your shell at the SDK. On macOS or Linux add to `~/.zshrc` or `~/.bashrc`:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"     # macOS
# export ANDROID_HOME="$HOME/Android/Sdk"           # Linux
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"
```

Then check everything at once:

```bash
bash scripts/android-emulator.sh doctor
```

It reports one line per component. `bash scripts/android-emulator.sh install`
installs the SDK packages listed above through `sdkmanager` (it will ask you to
accept licences first).

### If you already have Android Studio

It covers most of the table above: the SDK platform, platform-tools, build
tools, the emulator, a bundled JDK (the JetBrains Runtime, currently 21, which
satisfies the 17-or-newer requirement) and the Device Manager for creating
AVDs. Three things it does **not** install by default, all of which this app
needs:

- **NDK 27.1.12297006** and **CMake 3.22.1**, because quick-crypto compiles C++
- **Android SDK Command-line Tools (latest)**, which provide `sdkmanager` and
  `avdmanager`, used by the helper script

Add them in Android Studio: Settings, Languages and Frameworks, Android SDK,
**SDK Tools** tab. Tick "Show Package Details" to choose the exact NDK and
CMake versions rather than the newest ones, then tick "Android SDK Command-line
Tools (latest)". Or install the command-line tools there and let the script do
the rest with `bash scripts/android-emulator.sh install`.

Two more things to check on an existing Android Studio setup:

- **`ANDROID_HOME` is usually not exported to your shell.** Android Studio
  knows where the SDK is, your terminal does not. Export it as above, or copy
  the path from Settings, Android SDK, "Android SDK Location".
- **No separate JDK needed.** If `scripts/android-emulator.sh doctor` reports
  the JDK missing, point at the bundled one:
  `export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`
  on macOS, `~/android-studio/jbr` on Linux,
  `C:\Program Files\Android\Android Studio\jbr` on Windows. If Gradle later
  complains about an unsupported Java or Kotlin version, install a JDK 17 and
  point `JAVA_HOME` there instead.

**Already made an AVD in Device Manager?** Use it. Either boot it from the
Device Manager Play button and skip straight to
`bash scripts/android-emulator.sh run`, or pass the name:
`AVD_NAME=Pixel_Tablet_API_36 bash scripts/android-emulator.sh up`. `doctor`
lists the AVDs it can see. It needs to be a tablet profile on a Google Play or
Google APIs image (for the OAuth browser tab), API 35 or 36.

### On Windows

`scripts/android-emulator.sh` is a bash script, so run it from **Git Bash**
(installed with Git for Windows), not PowerShell or cmd. The SDK normally
lives at `C:\Users\<you>\AppData\Local\Android\Sdk`.

Nothing here depends on the script. Every command has a point-and-click or npm
equivalent, which is also the answer if you would rather not install Git Bash:

| Script command | Equivalent |
|---|---|
| `doctor` | Android Studio, Settings, Android SDK, SDK Tools tab: check NDK and CMake are ticked |
| `install` | Same screen, tick the packages (use "Show Package Details" for exact versions) |
| `create` | Device Manager, plus button, Create Virtual Device |
| `up` | Device Manager, play button next to the device |
| `run` | `npx expo run:android` in `mobile/` |
| `finger` | Emulator window, three dots for Extended Controls, Fingerprint, Touch Sensor |
| `geo` | Extended Controls, Location, set coordinates, Send |

Do not open this repository as an Android Studio project. It is an Expo
project: Android Studio is here for the SDK and the emulator only, and the
`mobile/android/` folder it would open is generated output.

Hardware acceleration matters more than anything else for emulator speed: KVM
on Linux (check with `ls -l /dev/kvm`), the Windows Hypervisor Platform on
Windows, and Hypervisor.framework on macOS, which needs no setup.

## 2. Create and boot the AVD

```bash
bash scripts/android-emulator.sh up
```

This creates `prowalco-tablet-api36` (Pixel Tablet, API 36, Google Play image,
matched to your CPU architecture) if it does not exist, boots it, raises the
RAM to 4 GB and the data partition to 8 GB, forwards Metro's port 8081 to the
host, and sets a GPS fix over Johannesburg. Override any of it:
`AVD_NAME=... DEVICE=... API_LEVEL=... bash scripts/android-emulator.sh up`,
and `avdmanager list device` shows the device ids your SDK has.

**Use a tablet profile, not a phone.** The field devices are Android tablets,
one per technician (`docs/ARCHITECTURE-V2.md` section 3.1), so a phone AVD
tests a form factor nobody will use. Two things to keep in mind when reading
the result:

- The app is currently locked to portrait (`orientation` in `mobile/app.json`),
  so a tablet emulator stays portrait when you rotate it.
- There is no tablet-specific layout code in the app yet, no width
  breakpoints, so the screens are phone layouts stretched to tablet width.
  Judge the emulator against that, not against a redesign that does not exist.

A Pixel Tablet AVD is a generous stand-in for the real hardware: the target is
cheap Android tablets, so anything that feels marginal on the emulator will be
worse in the field.

If you would rather use the Android Studio GUI: Device Manager, Create Virtual
Device, **Tablet** category (Pixel Tablet or Medium Tablet), a **Google Play**
system image for API 35 or 36, then on the **Additional settings** tab:

| Setting | Value | Why |
|---|---|---|
| Internal storage | 8 GB or more | The debug build plus Gradle's artefacts fill a stock AVD |
| RAM | 4096 MB (3072 on an 8 GB machine) | The default is under 2 GB |
| VM heap size | 512 MB | Rendering the certificate PDF is the heaviest thing the app does |
| Graphics acceleration | Hardware | Automatic can silently fall back to software rendering |
| Rear camera | Webcam0 | Makes the barcode scanner testable, see section 6 |
| Default boot | Quick | Later boots take seconds instead of minutes |

### Set a screen lock and a fingerprint (once per AVD)

This is the step that cannot be scripted, and skipping it breaks signing.

1. In the emulator: Settings, Security and privacy, Device unlock, Screen lock.
   Set a PIN. **This alone is enough to get past the signing prompt**, because
   the app allows device-credential fallback.
2. To exercise the real biometric path, stay on that screen and add a
   fingerprint. When Android asks you to touch the sensor, run this on the
   host:

   ```bash
   bash scripts/android-emulator.sh finger
   ```

   Repeat it for each touch the enrolment wizard asks for. The same command
   answers the fingerprint prompt later when you tap Sign in the app.

### Open Chrome once

Launch Chrome in the emulator and dismiss its first-run screens. Otherwise the
sign-in Custom Tab opens onto Chrome's welcome flow instead of the Microsoft or
Google login page, which looks like a broken redirect.

## 3. Get the app onto the emulator

Two routes. Use the local build if you are going to change code, and the EAS
build if you only want to look at the app.

### Route A: build locally (best for a dev loop)

```bash
cd mobile
npm install
npx expo run:android      # or: bash scripts/android-emulator.sh run
```

This runs `expo prebuild` (generating `mobile/android/`), compiles the dev
client, installs it on the running emulator and starts Metro. The first build
takes 10 to 20 minutes because Gradle downloads its dependencies and CMake
compiles the quick-crypto sources. Later runs take a minute or two, and if you
have only changed JavaScript you do not need to rebuild at all: `npm start`
and reload.

`mobile/android/` is generated output and is gitignored. Never edit it by hand
and never commit it. If native config changes (a new native module, an edit to
`app.json` or `app.config.js`), regenerate it with
`npx expo prebuild --platform android --clean`.

### Route B: install an EAS development build

No local Android toolchain is needed beyond `adb`, but you need an Expo account
and each build takes around 15 minutes in the cloud.

```bash
cd mobile
npm install
npx eas-cli login
npx eas-cli build --profile development --platform android
adb install /path/to/downloaded.apk
npx expo start --dev-client
```

The `development` profile produces a universal APK (the project builds
`armeabi-v7a`, `arm64-v8a`, `x86`, `x86_64`), so the same file installs on the
emulator and on a physical tablet.

## 4. Sign in

The app ships pointing at the deployed backend and Supabase project
(`mobile/app.config.js`), so there is nothing to configure for a normal run.
Sign-in works on the emulator provided that, in the Supabase dashboard:

- the Azure, Google or Apple provider you want to test is enabled
  (`docs/supabase-setup.md` section 4), and
- `prowalco-cal://auth-callback` is in the redirect allow-list.

That deep link is what `Linking.createURL('auth-callback')` returns in a
development build, and the generated manifest registers both `prowalco-cal`
and `exp+prowalco-cal`. You can confirm the emulator honours it without
signing in:

```bash
adb shell am start -W -a android.intent.action.VIEW -d "prowalco-cal://auth-callback"
```

Sign in with Apple is iOS-only in its native form. On Android it goes through
the same browser flow as the others.

## 5. Point the app at a local backend (optional)

The emulator reaches your host machine at **10.0.2.2**, not `localhost`.

```bash
cd backend && .venv/bin/uvicorn app.main:app --reload    # host, port 8000
```

Then set `EXPO_PUBLIC_API_URL=http://10.0.2.2:8000` in `mobile/.env` and
restart Metro with `npx expo start --dev-client --clear`. Plain HTTP works
because debug builds allow cleartext traffic. Do not commit that change to
`mobile/.env`.

Alternatively keep the URL as `localhost` and map the port instead:
`adb reverse tcp:8000 tcp:8000`.

## 6. Emulator controls for the on-device features

| Feature | How to drive it |
|---|---|
| Biometric prompt | `bash scripts/android-emulator.sh finger` while the prompt is showing |
| GPS (POPIA consent capture) | `bash scripts/android-emulator.sh geo [lon] [lat]`, or the Location tab in Extended Controls. Without a fix the app records no coordinates and carries on |
| Camera (seal and totaliser photos) | Set the AVD's rear camera to **Webcam0** when creating it (Additional settings, Camera) so it uses your machine's webcam. VirtualScene, the default, is a synthetic room: fine for proving capture works, useless for anything you need to read back |
| Barcode scanning | Practical only with the webcam: hold a printed barcode, or one on a phone screen, up to it. If the emulator camera is black, another app has the webcam or the machine has none, so switch the rear camera back to VirtualScene and leave scanning for a physical device |
| Signature pad | Draw with the mouse. Worth confirming on a real tablet with a finger before sign-off |
| Offline and sign-queue behaviour | Extended Controls, Cellular, set Data status to Denied, or use the emulator's airplane mode |

## 7. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| "Identity confirmation cancelled" when tapping Sign | No screen lock on the AVD. Set a PIN (section 2) |
| Fingerprint prompt never accepts | Run `scripts/android-emulator.sh finger` on the host while the prompt is open |
| Sign-in opens a tab that goes nowhere | Chrome's first-run screen, or the redirect URL is not allow-listed in Supabase |
| Gradle fails with a CMake or NDK error | NDK 27.1.12297006 or CMake missing. `scripts/android-emulator.sh install` |
| "Dependant package with key emulator not found" when creating an AVD | The **Android Emulator** SDK package is not installed. SDK Tools tab, tick it, Apply. If it is already ticked, untick, Apply, re-tick, Apply, which forces a reinstall of a stale package list |
| `SDK location not found` | `ANDROID_HOME` not exported, or `mobile/android/local.properties` missing after a manual prebuild |
| App installs but shows a blank white screen | Metro is not running or not reachable. `npm start` in `mobile/`, then `adb reverse tcp:8081 tcp:8081` |
| `INSTALL_FAILED_INSUFFICIENT_STORAGE` | The AVD's data partition is too small. Recreate it with at least 8 GB |
| `adb: no devices/emulators found` | The emulator has not finished booting. `adb wait-for-device` |
| Windows: "Android Emulator hypervisor driver (installer)" fails to install | On an **ARM** PC this is terminal, AEHD is x86-only and so is the emulator: see section 0. On an x86_64 PC it is optional and usually the wrong accelerator anyway (AEHD needs admin rights and cannot coexist with Hyper-V, which WSL2, Docker Desktop and Defender's virtualization-based security all enable). Use Windows Hypervisor Platform instead: Turn Windows features on or off, tick it, reboot |
| **Android Emulator** cannot be ticked in SDK Tools | Almost always an ARM Windows machine. Section 0 |
| Windows: emulator will not start, no accelerator found | Tick **Windows Hypervisor Platform** in Windows features and reboot. If Task Manager, Performance, CPU shows "Virtualization: Disabled", enable VT-x or SVM in the BIOS first, nothing works without it |
| Emulator is very slow | Hardware acceleration is off. Check `/dev/kvm` on Linux, or use an arm64 image on Apple Silicon |
| Metro cannot resolve `@prowalco/schema` | Run `npm install` in `mobile/`. The package is a `file:` dependency on `shared/schema`, whose `dist/` is committed |

A note on `npx expo prebuild`: it warns that `userInterfaceStyle: automatic`
needs `expo-system-ui` on Android. That is harmless for running the app. It
only means Android will not follow the system dark-mode setting.

## What still needs a physical device

The emulator covers most of the flow, but not everything. Real biometrics,
barcode scanning, the touchscreen signature, PDF rendering differences and
poor-connectivity behaviour at a forecourt all need real hardware. The
checklist is `docs/TESTING.md`.
