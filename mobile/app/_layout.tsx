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
        <Stack.Screen name="home" options={{ title: 'Work orders' }} />
        <Stack.Screen name="workorder/[id]" options={{ title: 'Work order' }} />
        <Stack.Screen name="dispenser/[id]/identity" options={{ title: 'Dispenser identity' }} />
        <Stack.Screen name="dispenser/[id]/register" options={{ title: 'Components' }} />
        <Stack.Screen name="verification/[id]/results" options={{ title: 'Verification results' }} />
        <Stack.Screen name="verification/[id]/sign" options={{ title: 'Review & sign' }} />
        <Stack.Screen
          name="verification/[id]/signature"
          options={{ title: 'Client signature', presentation: 'modal' }}
        />
        <Stack.Screen name="verification/[id]/issued" options={{ title: 'Certificate' }} />
      </Stack>
    </AuthProvider>
  );
}
