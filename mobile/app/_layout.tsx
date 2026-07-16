import { Stack } from 'expo-router';
import React, { useEffect } from 'react';
import { AuthProvider } from '../src/auth/AuthContext';
import { migrate } from '../src/db/database';
import { useSignQueue } from '../src/queue/useSignQueue';
import { colors } from '../src/components/ui';

function QueueRunner() {
  useSignQueue();
  return null;
}

export default function RootLayout() {
  useEffect(() => {
    migrate();
  }, []);

  return (
    <AuthProvider>
      <QueueRunner />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.green },
          headerTintColor: '#fff',
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
