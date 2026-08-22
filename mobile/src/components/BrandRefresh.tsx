/**
 * Pull to refresh with the brand in the gap (#214). RefreshControl gives
 * the native gesture; on iOS its grey spinner is tinted away and the
 * Prowalco droplet pulses in the pulled-open white space instead. Android
 * never opens a gap (its material spinner floats over the content), so it
 * keeps the native indicator in brand green.
 *
 * Wire-up: keep a dedicated "pulling" state for the gesture, separate
 * from any focus-load flag; feeding a focus load's refreshing flag to
 * RefreshControl yanks the list open on every screen visit.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, RefreshControl, View } from 'react-native';
import { colors } from './ui';

export function brandRefreshControl(pulling: boolean, onRefresh: () => void) {
  return (
    <RefreshControl
      refreshing={pulling}
      onRefresh={onRefresh}
      tintColor={Platform.OS === 'ios' ? 'transparent' : undefined}
      colors={[colors.green]}
      progressBackgroundColor="#fff"
    />
  );
}

/** The droplet, pulsing in the pull gap. Render inside the scrollable's
 * first content view; it sits in the negative space iOS holds open while
 * the refresh runs. */
export function BrandRefreshDrop({ pulling }: { pulling: boolean }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!pulling) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 520,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 520,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulling, pulse]);
  if (Platform.OS !== 'ios' || !pulling) return null;
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: -46, left: 0, right: 0, alignItems: 'center' }}
    >
      <Animated.Image
        source={require('../../assets/drop-source.png')}
        style={{
          width: 30,
          height: 30,
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
          transform: [
            { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.05] }) },
          ],
        }}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}
