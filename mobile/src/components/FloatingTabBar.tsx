/**
 * Floating pill bottom nav (#33): with only two destinations, a compact
 * centred pill opens the screen up instead of a full-width bar. Active tab
 * sits in a navy rounded square with a white icon; inactive tabs are plain
 * muted icons. Icons only — the buttons carry accessibility labels.
 *
 * The bar sits in the navigator's normal layout flow, NOT position:absolute
 * over the screen container: overlaying react-native-screens content on the
 * new architecture left the pill untappable on device even with an explicit
 * stacking order (#34, #45). In-flow, the pill reserves its own strip and
 * hit-testing is trivial — nothing can swallow the taps.
 */
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { CommonActions } from '@react-navigation/native';
import React from 'react';
import { Pressable, View } from 'react-native';
import { colors } from './ui';

export function FloatingTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  return (
    <View
      style={{
        alignItems: 'center',
        backgroundColor: colors.bg,
        paddingTop: 8,
        paddingBottom: insets.bottom + 10,
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
              // Same dispatch as the stock BottomTabBar: a navigate action
              // targeted at this tab navigator's state (#45).
              navigation.dispatch({
                ...CommonActions.navigate(route.name, route.params),
                target: state.key,
              });
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
