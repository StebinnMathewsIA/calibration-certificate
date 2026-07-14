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
        <Stack.Screen name="home" options={{ title: 'Calibrations' }} />
        <Stack.Screen name="certificate/[id]/edit" options={{ title: 'Calibration form' }} />
        <Stack.Screen name="certificate/[id]/review" options={{ title: 'Review & sign' }} />
        <Stack.Screen name="certificate/[id]/issued" options={{ title: 'Certificate' }} />
      </Stack>
    </AuthProvider>
  );
}
