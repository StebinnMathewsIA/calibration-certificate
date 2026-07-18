import {
  BarlowSemiCondensed_500Medium,
  BarlowSemiCondensed_600SemiBold,
} from '@expo-google-fonts/barlow-semi-condensed';
import { Inter_400Regular, Inter_500Medium } from '@expo-google-fonts/inter';
import { RobotoMono_400Regular, RobotoMono_500Medium } from '@expo-google-fonts/roboto-mono';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import React, { useEffect } from 'react';
import { AuthProvider } from '../src/auth/AuthContext';
import { migrate } from '../src/db/database';
import { useSignQueue } from '../src/queue/useSignQueue';
import { colors, fonts } from '../src/components/ui';

function QueueRunner() {
  useSignQueue();
  return null;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    BarlowSemiCondensed_500Medium,
    BarlowSemiCondensed_600SemiBold,
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
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Prowalco Calibration' }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="workorder/[id]" options={{ title: 'Work order' }} />
        <Stack.Screen name="site/[id]" options={{ title: 'Site' }} />
        <Stack.Screen name="dispenser/[id]/identity" options={{ title: 'Dispenser identity' }} />
        <Stack.Screen name="dispenser/[id]/register" options={{ title: 'Components' }} />
        <Stack.Screen name="verification/[id]/results" options={{ title: 'Verification results' }} />
        <Stack.Screen name="verification/[id]/sign" options={{ title: 'Review & sign' }} />
        <Stack.Screen name="verification/[id]/queued" options={{ title: 'Signing status' }} />
        <Stack.Screen name="profile" options={{ title: 'My profile' }} />
        <Stack.Screen
          name="signature"
          // Locked: no swipe-to-dismiss and no back button, so a downward
          // drawing stroke can never close the window — only Save / Cancel do.
          options={{ title: 'Signature', headerBackVisible: false, gestureEnabled: false }}
        />
        <Stack.Screen name="verification/[id]/issued" options={{ title: 'Certificate' }} />
      </Stack>
    </AuthProvider>
  );
}
