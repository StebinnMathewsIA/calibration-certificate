import { Tabs } from 'expo-router';
import React from 'react';
import { Text } from 'react-native';
import { colors, fonts } from '../../src/components/ui';
import { HeaderProfileButton } from '../../src/components/HeaderProfileButton';

const icon = (glyph: string) => ({ color }: { color: string }) =>
  <Text style={{ fontSize: 18, color }}>{glyph}</Text>;

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.navy },
        headerTintColor: '#fff',
        headerTitleStyle: { fontFamily: fonts.heading },
        headerRight: () => <HeaderProfileButton />,
        // Bottom nav recipe: white bar, hairline top border, active items in
        // the dark pass-green (never raw brand green as small text).
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopWidth: 1,
          borderTopColor: colors.line,
        },
        tabBarActiveTintColor: colors.greenText,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: fonts.bodyMedium },
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
