/**
 * The four lifecycle verbs as one icon row (#122).
 *
 * They were three stacked full-width buttons sitting BELOW the description
 * and the map, so they took a third of the screen and the technician had to
 * scroll past the job to reach the thing they came to tap. The actions
 * somebody uses twenty times a day should be the most reachable control on
 * the page, not the largest.
 *
 * Every action for the job is always PRESENT, with the ones that do not
 * apply disabled rather than removed. A control that moves under your thumb
 * between visits is a control you tap wrong, and a technician glancing at
 * this row should be able to see what the job's stage allows without
 * counting buttons.
 *
 * Icons are drawn in the brand's hand-made SVG line style (BrandHeader.tsx)
 * and every one carries an accessibilityLabel, because an icon-only control
 * without one is unusable with a screen reader.
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { colors, fonts } from './ui';
import type { WoState } from '../api/client';

type Verb = 'on_the_way' | 'start' | 'pause' | 'stop';

const SIZE = 26;

function VanIcon({ color }: { color: string }) {
  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 24 24" fill="none">
      <Path
        d="M2.5 15.5V8.5a1.5 1.5 0 0 1 1.5-1.5h8.5v8.5"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M12.5 9.5h3.6l3.4 3.4v2.6"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Line x1={2.5} y1={15.5} x2={21.5} y2={15.5} stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Circle cx={7.5} cy={17.5} r={2} stroke={color} strokeWidth={1.8} />
      <Circle cx={16.5} cy={17.5} r={2} stroke={color} strokeWidth={1.8} />
    </Svg>
  );
}

function PlayIcon({ color }: { color: string }) {
  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={1.8} />
      <Path d="M10 8.5l6 3.5-6 3.5z" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
    </Svg>
  );
}

function PauseIcon({ color }: { color: string }) {
  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={1.8} />
      <Line x1={10} y1={8.8} x2={10} y2={15.2} stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1={14} y1={8.8} x2={14} y2={15.2} stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

function CompleteIcon({ color }: { color: string }) {
  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={1.8} />
      <Path
        d="M8.2 12.3l2.6 2.6 5-5.4"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const ICONS: Record<Verb, (p: { color: string }) => React.JSX.Element> = {
  on_the_way: VanIcon,
  start: PlayIcon,
  pause: PauseIcon,
  stop: CompleteIcon,
};

/** Short, because it sits under a 26px icon and a technician reads it at
 * arm's length in daylight. The accessibilityLabel carries the full
 * sentence. */
const LABEL: Record<Verb, string> = {
  on_the_way: 'On the way',
  start: 'Start',
  pause: 'Pause',
  stop: 'Complete',
};

const SPOKEN: Record<Verb, string> = {
  on_the_way: 'On the way to site',
  start: 'Start work',
  pause: 'Pause work',
  stop: 'Work complete',
};

/** Which verbs the state machine allows from here. Mirrors the server's
 * rules deliberately narrowly: this decides what is TAPPABLE, the server
 * decides what is true. */
function allowed(state: WoState, blocksResume: boolean): Set<Verb> {
  switch (state) {
    case 'not_started':
      return new Set<Verb>(['on_the_way', 'start']);
    case 'on_the_way':
      return new Set<Verb>(['start', 'pause']);
    case 'started':
      return new Set<Verb>(['pause', 'stop']);
    case 'paused':
      // A pause reason like incomplete-for-spares bars the technician from
      // resuming; the office reopens it.
      return blocksResume ? new Set<Verb>() : new Set<Verb>(['start', 'stop']);
    default:
      return new Set<Verb>();
  }
}

export function LifecycleActions({
  state,
  blocksResume = false,
  busy = false,
  onAction,
}: {
  state: WoState;
  blocksResume?: boolean;
  busy?: boolean;
  onAction: (verb: Verb) => void;
}) {
  const can = allowed(state, blocksResume);
  const verbs: Verb[] = ['on_the_way', 'start', 'pause', 'stop'];
  return (
    <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12 }}>
      {verbs.map((v) => {
        const Icon = ICONS[v];
        const enabled = can.has(v) && !busy;
        const tint = enabled ? colors.navy : colors.muted;
        return (
          <Pressable
            key={v}
            onPress={() => enabled && onAction(v)}
            disabled={!enabled}
            accessibilityRole="button"
            accessibilityLabel={SPOKEN[v]}
            accessibilityState={{ disabled: !enabled }}
            style={{
              flex: 1,
              alignItems: 'center',
              paddingVertical: 10,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: enabled ? colors.line : 'transparent',
              backgroundColor: enabled ? '#fff' : 'transparent',
              opacity: enabled ? 1 : 0.45,
            }}
          >
            <Icon color={tint} />
            <Text
              style={{
                marginTop: 4,
                fontSize: 11,
                color: tint,
                fontFamily: fonts.bodyMedium,
                textAlign: 'center',
              }}
            >
              {LABEL[v]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
