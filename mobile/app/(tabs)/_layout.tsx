import { Tabs } from 'expo-router';
import React from 'react';
import { Text } from 'react-native';
import { colors } from '../../src/components/ui';
import { HeaderProfileButton } from '../../src/components/HeaderProfileButton';

const icon = (glyph: string) => ({ color }: { color: string }) =>
  <Text style={{ fontSize: 18, color }}>{glyph}</Text>;

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.green },
        headerTintColor: '#fff',
        headerRight: () => <HeaderProfileButton />,
        tabBarActiveTintColor: colors.green,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{ title: 'Work orders', tabBarIcon: icon('🗒️') }}
      />
      <Tabs.Screen
        name="sites"
        options={{ title: 'Sites', tabBarIcon: icon('⛽') }}
      />
    </Tabs>
  );
}
