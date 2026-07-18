import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { colors, fonts } from './ui';

/**
 * Brand app-bar wordmark (brand guidelines, "App bar" recipe): "prowalco"
 * lowercase with the final "o" in brand blue — the droplet accent from the
 * logo. Brand green and blue sit directly on the navy bar per the guidelines.
 */
export function BrandWordmark() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
      <Text
        style={{
          fontFamily: fonts.heading,
          fontSize: 22,
          letterSpacing: 0.5,
          color: colors.green,
        }}
      >
        prowalc
        <Text style={{ color: colors.blue }}>o</Text>
      </Text>
    </View>
  );
}

/**
 * Custom stroke-drawn tab icons (react-native-svg — no icon-font dependency).
 * They take the tab bar's tint colour and draw slightly bolder when focused,
 * so state is never colour-alone at a glance.
 */
export function WorkOrdersTabIcon({ color, focused }: { color: string; focused?: boolean }) {
  const sw = focused ? 2.2 : 1.8;
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      {/* Clipboard body + clip */}
      <Rect x={4.5} y={4} width={15} height={17} rx={2.5} stroke={color} strokeWidth={sw} />
      <Rect x={8.5} y={2.2} width={7} height={4} rx={1.5} fill={color} />
      {/* Checklist lines */}
      <Line x1={8} y1={10.5} x2={16} y2={10.5} stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <Line x1={8} y1={14} x2={16} y2={14} stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <Line x1={8} y1={17.5} x2={13} y2={17.5} stroke={color} strokeWidth={sw} strokeLinecap="round" />
    </Svg>
  );
}

/** Circular-arrow refresh glyph — header refresh action (#39). */
export function RefreshIcon({ color, size = 22 }: { color: string; size?: number }) {
  const sw = 2;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M20 12a8 8 0 1 1-2.9-6.16"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
      />
      <Path
        d="M20.2 3.6v4.3h-4.3"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Waste-bin glyph — draft deletion (#41). */
export function TrashIcon({ color, size = 20 }: { color: string; size?: number }) {
  const sw = 1.8;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Line x1={4.5} y1={6.5} x2={19.5} y2={6.5} stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <Path
        d="M9.5 6V4.5A1.5 1.5 0 0 1 11 3h2a1.5 1.5 0 0 1 1.5 1.5V6"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
      />
      <Path
        d="M6.5 6.5l.8 12.1a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-12.1"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Line x1={10} y1={10.5} x2={10} y2={16.5} stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <Line x1={14} y1={10.5} x2={14} y2={16.5} stroke={color} strokeWidth={sw} strokeLinecap="round" />
    </Svg>
  );
}

export function SitesTabIcon({ color, focused }: { color: string; focused?: boolean }) {
  const sw = focused ? 2.2 : 1.8;
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      {/* Dispenser body */}
      <Rect x={4} y={3.5} width={11} height={17} rx={2} stroke={color} strokeWidth={sw} />
      {/* Display window */}
      <Rect x={7} y={6.5} width={5} height={4} rx={0.8} stroke={color} strokeWidth={sw} />
      {/* Base */}
      <Line x1={2.5} y1={21} x2={16.5} y2={21} stroke={color} strokeWidth={sw} strokeLinecap="round" />
      {/* Hose to nozzle */}
      <Path
        d="M15 8.5 h3 a2 2 0 0 1 2 2 v6.5 a1.6 1.6 0 0 1 -3.2 0 v-3"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
      />
      <Circle cx={16.8} cy={17} r={0.9} fill={color} />
    </Svg>
  );
}
