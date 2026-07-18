/**
 * Floating pill bottom nav (#33): with only two destinations, a compact
 * centred pill opens the screen up instead of a full-width bar. Active tab
 * sits in a navy rounded square with a white icon; inactive tabs are plain
 * muted icons. Icons only — the buttons carry accessibility labels.
 */
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import React from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from './ui';

export function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: insets.bottom + 12,
        alignItems: 'center',
        // The tab screens are react-native-screens containers stretched over
        // the whole window; without an explicit stacking order the screen
        // layer can win the hit-test and swallow taps meant for the pill
        // (#34). zIndex covers iOS, elevation covers Android.
        zIndex: 10,
        elevation: 10,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          backgroundColor: colors.card,
          borderRadius: 32,
          borderWidth: 1,
          borderColor: colors.line,
          padding: 6,
          gap: 4,
          shadowColor: '#000',
          shadowOpacity: 0.08,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 4,
        }}
      >
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const focused = state.index === index;
          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate({ name: route.name, params: route.params, merge: true });
            }
          };
          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              hitSlop={6}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={options.title ?? route.name}
              style={{
                width: 52,
                height: 52,
                borderRadius: 18,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: focused ? colors.navy : 'transparent',
              }}
            >
              {options.tabBarIcon?.({
                focused,
                color: focused ? '#ffffff' : colors.muted,
                size: 24,
              })}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
