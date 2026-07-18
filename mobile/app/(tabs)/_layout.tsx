import { Tabs } from 'expo-router';
import React from 'react';
import {
  BrandWordmark,
  SitesTabIcon,
  WorkOrdersTabIcon,
} from '../../src/components/BrandHeader';
import { colors } from '../../src/components/ui';
import { FloatingTabBar } from '../../src/components/FloatingTabBar';
import { HeaderProfileButton } from '../../src/components/HeaderProfileButton';

export default function TabsLayout() {
  return (
    <Tabs
      // Bottom nav: floating brand pill (#33) — navy active square, custom
      // brand vectors, card surface. Replaces the full-width bar.
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        // Brand app bar: flat navy, wordmark left, avatar right (no shadows).
        headerStyle: { backgroundColor: colors.navy },
        headerShadowVisible: false,
        headerTintColor: '#fff',
        headerTitleAlign: 'left',
        headerTitle: () => <BrandWordmark />,
        headerRight: () => <HeaderProfileButton />,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Work orders',
          // Home renders its own greeting header (#32) — no wordmark bar.
          headerShown: false,
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
