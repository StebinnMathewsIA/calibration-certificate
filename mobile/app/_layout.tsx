// Buffer global FIRST (#164): react-native-quick-crypto's sign path ends
// in Buffer.from(...), and Hermes has no Buffer. Without this, the device
// signature throws, the upload goes out headerless, and the signing
// service 403s every retry. The polyfill ships inside quick-crypto's own
// dependency tree.
import { Buffer } from '@craftzdog/react-native-buffer';

if (!(globalThis as { Buffer?: unknown }).Buffer) {
  (globalThis as { Buffer?: unknown }).Buffer = Buffer;
}

import { Barlow_500Medium, Barlow_600SemiBold } from '@expo-google-fonts/barlow';
import { Inter_400Regular, Inter_500Medium } from '@expo-google-fonts/inter';
import { RobotoMono_400Regular, RobotoMono_500Medium } from '@expo-google-fonts/roboto-mono';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import React, { useEffect } from 'react';
import { AuthProvider } from '../src/auth/AuthContext';
import { migrate } from '../src/db/database';
import { useSignQueue } from '../src/queue/useSignQueue';
import { useSync } from '../src/sync/useSync';
import { FreshnessGate } from '../src/components/FreshnessGate';
import { HeaderBackButton } from '../src/components/HeaderBackButton';
import { colors, fonts } from '../src/components/ui';
import { installCrashJournal } from '../src/diag/crashJournal';

// Fatal JS errors leave a record on the device (#148). Installed at module
// scope, before anything renders, so a crash during the first frame is
// still caught.
installCrashJournal();

function QueueRunner() {
  useSignQueue();
  useSync();
  return null;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Barlow_500Medium,
    Barlow_600SemiBold,
    Inter_400Regular,
    Inter_500Medium,
    RobotoMono_400Regular,
    RobotoMono_500Medium,
  });

  useEffect(() => {
    migrate();
  }, []);

  if (!fontsLoaded) return null;

  return (
    <AuthProvider>
      <QueueRunner />
      <Stack
        screenOptions={{
          // Brand app bar: flat navy structure, white Barlow title, minimal
          // back affordance (no iOS back-label clutter, no shadows).
          headerStyle: { backgroundColor: colors.navy },
          headerShadowVisible: false,
          headerTintColor: '#fff',
          headerTitleStyle: { fontFamily: fonts.heading },
          headerBackButtonDisplayMode: 'minimal',
          // Own chevron on every stack screen (#43): the native back button
          // can vanish above a headerShown:false screen (react-native-screens
          // #1460), which left the work-order screen with no way home.
          headerLeft: ({ tintColor }) => <HeaderBackButton tintColor={tintColor} />,
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Prowalco Calibration' }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="workorder/[id]" options={{ title: 'Work order' }} />
        {/* My day pushes wo/[id]. Without this line the header showed the
            raw route name, "wo/[id]", to the technician. */}
        <Stack.Screen name="wo/[id]" options={{ title: 'Work order' }} />
        <Stack.Screen name="spares/[id]" options={{ title: 'Spares' }} />
        <Stack.Screen name="signoff/[id]" options={{ title: 'Client sign-off' }} />
        <Stack.Screen name="jobcard/[id]" options={{ title: 'Job card' }} />
        <Stack.Screen name="site/[id]" options={{ title: 'Site' }} />
        <Stack.Screen name="map" options={{ title: 'Work order map' }} />
        <Stack.Screen name="dispenser/[id]/identity" options={{ title: 'Dispenser identity' }} />
        <Stack.Screen name="dispenser/[id]/register" options={{ title: 'Components' }} />
        <Stack.Screen name="verification/[id]/results" options={{ title: 'Verification results' }} />
        <Stack.Screen name="verification/[id]/sign" options={{ title: 'Review & sign' }} />
        <Stack.Screen name="verification/[id]/queued" options={{ title: 'Signing status' }} />
        <Stack.Screen name="profile" options={{ title: 'My profile' }} />
        <Stack.Screen name="van/[staff]" options={{ title: 'Van stock' }} />
        <Stack.Screen name="technician/[staff]" options={{ title: 'Technician' }} />
        <Stack.Screen
          name="signature"
          // Locked: no swipe-to-dismiss and no back button, so a downward
          // drawing stroke can never close the window — only Save / Cancel do.
          options={{
            title: 'Signature',
            headerBackVisible: false,
            gestureEnabled: false,
            headerLeft: () => null,
          }}
        />
        <Stack.Screen name="verification/[id]/issued" options={{ title: 'Certificate' }} />
      </Stack>
      {/* After the Stack so the overlay renders above it (#150). */}
      <FreshnessGate />
    </AuthProvider>
  );
}
