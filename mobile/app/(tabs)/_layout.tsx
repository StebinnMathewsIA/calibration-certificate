import { Tabs } from 'expo-router';
import React from 'react';
import {
  BrandWordmark,
  SitesTabIcon,
  WorkOrdersTabIcon,
} from '../../src/components/BrandHeader';
import { colors, fonts } from '../../src/components/ui';
import { HeaderProfileButton } from '../../src/components/HeaderProfileButton';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        // Brand app bar: flat navy, wordmark left, avatar right (no shadows).
        headerStyle: { backgroundColor: colors.navy },
        headerShadowVisible: false,
        headerTintColor: '#fff',
        headerTitleAlign: 'left',
        headerTitle: () => <BrandWordmark />,
        headerRight: () => <HeaderProfileButton />,
        // Bottom nav recipe: white bar, hairline top border only, active items
        // in the dark pass-green (never raw brand green as small text).
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopWidth: 1,
          borderTopColor: colors.line,
          elevation: 0,
          height: 60,
          paddingTop: 6,
        },
        tabBarActiveTintColor: colors.greenText,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: fonts.bodyMedium, fontSize: 11, marginBottom: 6 },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Work orders',
          tabBarIcon: ({ color, focused }) => <WorkOrdersTabIcon color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="sites"
        options={{
          title: 'Sites',
          tabBarIcon: ({ color, focused }) => <SitesTabIcon color={color} focused={focused} />,
        }}
      />
    </Tabs>
  );
}
