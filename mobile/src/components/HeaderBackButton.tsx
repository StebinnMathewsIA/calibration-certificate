import { usePathname, useRouter } from 'expo-router';
import React from 'react';
import { Pressable } from 'react-native';
import Svg, { Path } from 'react-native-svg';

/**
 * Explicit header back affordance (#43). The native back chevron can fail to
 * render when the screen below has headerShown: false
 * (software-mansion/react-native-screens#1460) — exactly our root stack, where
 * every push sits above the headerless (tabs) screen — which stranded VOs on
 * the work-order screen. Drawing our own chevron guarantees the affordance:
 * pops when possible, otherwise falls back to Home so there is always a way
 * out. Never shown on the sign-in screen (nothing authed to go back to).
 */
export function HeaderBackButton({ tintColor = '#ffffff' }: { tintColor?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  if (pathname === '/') return null;
  return (
    <Pressable
      onPress={() => {
        if (router.canGoBack()) router.back();
        else router.replace('/home');
      }}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Back"
      style={{ paddingVertical: 6, paddingRight: 14 }}
    >
      <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
        <Path
          d="M15 4.5 7.5 12l7.5 7.5"
          stroke={tintColor}
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </Pressable>
  );
}
