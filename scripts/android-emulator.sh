#!/usr/bin/env bash
#
# Android emulator helper for the Prowalco calibration app.
#
#   bash scripts/android-emulator.sh doctor    check the local toolchain
#   bash scripts/android-emulator.sh install   install the SDK packages needed
#   bash scripts/android-emulator.sh create    create the AVD
#   bash scripts/android-emulator.sh up        boot the AVD (creates if missing)
#   bash scripts/android-emulator.sh run       build and install the app on it
#   bash scripts/android-emulator.sh finger    simulate a fingerprint touch
#   bash scripts/android-emulator.sh geo       set a GPS fix (default: Johannesburg)
#
# Full walkthrough: docs/android-emulator.md
#
# Overridable with environment variables:
#   AVD_NAME    (default prowalco-api36)
#   API_LEVEL   (default 36, matches the compile/target SDK of Expo SDK 54)
#   ANDROID_HOME / ANDROID_SDK_ROOT
set -euo pipefail

AVD_NAME="${AVD_NAME:-prowalco-api36}"
API_LEVEL="${API_LEVEL:-36}"
NDK_VERSION="27.1.12297006"
BUILD_TOOLS="36.0.0"
CMAKE_VERSION="3.22.1"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The emulator needs a system image matching the host CPU: Apple Silicon and
# ARM Linux run arm64-v8a, everything else x86_64. Both are in the app's
# reactNativeArchitectures, so either works.
case "$(uname -m)" in
  arm64 | aarch64) ABI="arm64-v8a" ;;
  *) ABI="x86_64" ;;
esac
SYSTEM_IMAGE="system-images;android-${API_LEVEL};google_apis_playstore;${ABI}"

say() { printf '%s\n' "$*"; }
fail() { printf 'error: %s\n' "$*" >&2; exit 1; }
report() { printf '  %-12s %s\n' "$1" "$2"; }

resolve_sdk() {
  local candidate
  for candidate in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" \
    "$HOME/Library/Android/sdk" "$HOME/Android/Sdk" \
    "${LOCALAPPDATA:-$HOME}/Android/Sdk"; do
    if [ -n "$candidate" ] && [ -d "$candidate/platform-tools" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

SDK="$(resolve_sdk || true)"
ADB="${SDK:+$SDK/platform-tools/adb}"
EMULATOR="${SDK:+$SDK/emulator/emulator}"

sdk_tool() {
  # cmdline-tools live under latest/ on a current install, but older setups
  # (and Android Studio's own bootstrap) leave a versioned directory instead.
  local name="$1" path
  for path in "$SDK/cmdline-tools/latest/bin/$name" "$SDK/cmdline-tools"/*/bin/"$name" \
    "$SDK/tools/bin/$name"; do
    [ -x "$path" ] && { printf '%s' "$path"; return 0; }
  done
  return 1
}

java_major() {
  command -v java >/dev/null 2>&1 || return 1
  java -version 2>&1 | sed -n 's/.*version "\([0-9]*\).*/\1/p' | head -1
}

require_sdk() {
  [ -n "$SDK" ] || fail "Android SDK not found. Install Android Studio, then set ANDROID_HOME (see docs/android-emulator.md)."
}

cmd_doctor() {
  local problems=0 major image_dir existing

  say "Toolchain for the Prowalco app on an Android emulator (${ABI}, API ${API_LEVEL})"
  say ""

  major="$(java_major || true)"
  case "$major" in ''|*[!0-9]*) major="" ;; esac
  if [ -z "$major" ]; then
    report "JDK" "MISSING. Install JDK 17 (Temurin, or Android Studio's bundled JBR)."
    problems=$((problems + 1))
  elif [ "$major" -lt 17 ]; then
    report "JDK" "TOO OLD (found $major). React Native 0.81 needs 17 or newer."
    problems=$((problems + 1))
  else
    report "JDK" "ok (major $major)"
  fi

  if [ -z "$SDK" ]; then
    report "SDK root" "MISSING. Install Android Studio, then export ANDROID_HOME."
    say ""
    say "Nothing else can be checked without the SDK. See docs/android-emulator.md section 1."
    return 1
  fi
  report "SDK root" "ok ($SDK)"

  [ -x "$ADB" ] && report "adb" "ok" || { report "adb" "MISSING (platform-tools)"; problems=$((problems + 1)); }
  [ -x "$EMULATOR" ] && report "emulator" "ok" || { report "emulator" "MISSING (emulator package)"; problems=$((problems + 1)); }
  sdk_tool sdkmanager >/dev/null && report "sdkmanager" "ok" || { report "sdkmanager" "MISSING (cmdline-tools;latest)"; problems=$((problems + 1)); }

  [ -d "$SDK/platforms/android-${API_LEVEL}" ] &&
    report "platform" "ok (android-${API_LEVEL})" ||
    { report "platform" "MISSING (platforms;android-${API_LEVEL})"; problems=$((problems + 1)); }

  # quick-crypto compiles C++ through CMake, so the NDK is not optional here.
  [ -d "$SDK/ndk/$NDK_VERSION" ] &&
    report "NDK" "ok ($NDK_VERSION)" ||
    { report "NDK" "MISSING ($NDK_VERSION, needed by react-native-quick-crypto)"; problems=$((problems + 1)); }
  [ -d "$SDK/cmake" ] &&
    report "cmake" "ok" ||
    { report "cmake" "MISSING (cmake;$CMAKE_VERSION)"; problems=$((problems + 1)); }

  image_dir="$SDK/system-images/android-${API_LEVEL}/google_apis_playstore/${ABI}"
  [ -d "$image_dir" ] &&
    report "image" "ok (google_apis_playstore ${ABI})" ||
    { report "image" "MISSING ($SYSTEM_IMAGE)"; problems=$((problems + 1)); }

  if [ -x "$EMULATOR" ] && "$EMULATOR" -list-avds 2>/dev/null | grep -qx "$AVD_NAME"; then
    report "AVD" "ok ($AVD_NAME)"
  else
    # An AVD made in Android Studio's Device Manager works just as well, it
    # just has a different name.
    existing="$({ [ -x "$EMULATOR" ] && "$EMULATOR" -list-avds 2>/dev/null; } | tr '\n' ' ')"
    if [ -n "${existing// /}" ]; then
      report "AVD" "'$AVD_NAME' not found, but these exist: ${existing% }"
      report "" "use one with: AVD_NAME=<name> $0 up"
    else
      report "AVD" "not created yet (run: $0 create)"
    fi
  fi

  [ -d "$REPO_ROOT/mobile/node_modules" ] &&
    report "node_modules" "ok" ||
    { report "node_modules" "MISSING (cd mobile && npm install)"; problems=$((problems + 1)); }

  say ""
  if [ "$problems" -eq 0 ]; then
    say "All good. Next: $0 up, then $0 run"
  else
    say "$problems item(s) need attention. '$0 install' fixes the SDK packages."
  fi
  return 0
}

cmd_install() {
  require_sdk
  local sdkmanager
  sdkmanager="$(sdk_tool sdkmanager)" || fail "sdkmanager not found. In Android Studio: SDK Manager, SDK Tools tab, tick 'Android SDK Command-line Tools (latest)'."

  say "Accepting licences (answer y to each prompt)..."
  "$sdkmanager" --licenses || true

  say "Installing SDK packages..."
  "$sdkmanager" --install \
    "platform-tools" \
    "emulator" \
    "platforms;android-${API_LEVEL}" \
    "build-tools;${BUILD_TOOLS}" \
    "ndk;${NDK_VERSION}" \
    "cmake;${CMAKE_VERSION}" \
    "$SYSTEM_IMAGE"
  say "Done. Next: $0 create"
}

cmd_create() {
  require_sdk
  local avdmanager avd_config
  avdmanager="$(sdk_tool avdmanager)" || fail "avdmanager not found. Install cmdline-tools first: $0 install"

  if "$EMULATOR" -list-avds 2>/dev/null | grep -qx "$AVD_NAME"; then
    say "AVD '$AVD_NAME' already exists. Delete it with: $avdmanager delete avd -n $AVD_NAME"
    return 0
  fi

  [ -d "$SDK/system-images/android-${API_LEVEL}/google_apis_playstore/${ABI}" ] ||
    fail "System image missing. Run: $0 install"

  say "Creating AVD '$AVD_NAME' (pixel_7, $SYSTEM_IMAGE)..."
  echo "no" | "$avdmanager" create avd --name "$AVD_NAME" --package "$SYSTEM_IMAGE" --device "pixel_7"

  # A stock AVD is short on RAM and disk for a React Native debug build with
  # Hermes plus the SQLite store and rendered PDFs.
  avd_config="${ANDROID_AVD_HOME:-$HOME/.android/avd}/${AVD_NAME}.avd/config.ini"
  if [ -f "$avd_config" ]; then
    {
      echo "hw.ramSize=4096"
      echo "vm.heapSize=512"
      echo "disk.dataPartition.size=8192"
      echo "hw.keyboard=yes"
    } >>"$avd_config"
    say "Tuned $avd_config (4 GB RAM, 8 GB data, hardware keyboard)."
  fi
  say "Done. Next: $0 up"
}

emulator_running() {
  [ -x "$ADB" ] && "$ADB" devices | grep -q "^emulator-.*device$"
}

cmd_up() {
  require_sdk
  if emulator_running; then
    say "An emulator is already running."
  else
    "$EMULATOR" -list-avds 2>/dev/null | grep -qx "$AVD_NAME" || cmd_create
    say "Booting '$AVD_NAME'..."
    nohup "$EMULATOR" -avd "$AVD_NAME" -netdelay none -netspeed full \
      >"${TMPDIR:-/tmp}/${AVD_NAME}.log" 2>&1 &
    disown || true

    say "Waiting for boot (this takes a minute on a cold start)..."
    "$ADB" wait-for-device
    local waited=0
    until [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
      sleep 3
      waited=$((waited + 3))
      [ "$waited" -ge 300 ] && fail "Emulator did not finish booting in 5 minutes. Log: ${TMPDIR:-/tmp}/${AVD_NAME}.log"
    done
    say "Booted."
  fi

  # Metro and a locally hosted backend are both reached over the host loopback.
  "$ADB" reverse tcp:8081 tcp:8081 >/dev/null 2>&1 || true
  cmd_geo >/dev/null 2>&1 || true

  say ""
  say "Two things still have to be done by hand inside the emulator, once per AVD:"
  say "  1. Settings, Security and privacy, Device unlock: set a PIN"
  say "  2. Same screen, Fingerprint Unlock: add a fingerprint, and when it asks"
  say "     you to touch the sensor run: $0 finger"
  say "Without both, the Sign step fails with 'Identity confirmation cancelled'."
  say ""
  say "Then: $0 run"
}

cmd_run() {
  require_sdk
  emulator_running || fail "No emulator running. Start one first: $0 up"
  [ -d "$REPO_ROOT/mobile/node_modules" ] || fail "Dependencies not installed. Run: cd mobile && npm install"
  say "Building the dev client and installing it (the first build takes 10 to 20 minutes)..."
  cd "$REPO_ROOT/mobile"
  exec npx expo run:android
}

cmd_finger() {
  require_sdk
  emulator_running || fail "No emulator running."
  "$ADB" -e emu finger touch "${1:-1}"
  say "Fingerprint ${1:-1} touched."
}

cmd_geo() {
  require_sdk
  emulator_running || fail "No emulator running."
  # Longitude first, then latitude. Default is Johannesburg, matching the
  # JHB branch code the app ships with.
  local lon="${1:-28.0473}" lat="${2:--26.2041}"
  "$ADB" -e emu geo fix "$lon" "$lat"
  say "Location set to $lat, $lon."
}

case "${1:-doctor}" in
  doctor) cmd_doctor ;;
  install) cmd_install ;;
  create) cmd_create ;;
  up) cmd_up ;;
  run) cmd_run ;;
  finger) shift; cmd_finger "$@" ;;
  geo) shift; cmd_geo "$@" ;;
  *)
    say "usage: $0 {doctor|install|create|up|run|finger|geo}"
    say "see docs/android-emulator.md"
    exit 1
    ;;
esac
