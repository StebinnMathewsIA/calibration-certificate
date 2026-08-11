/**
 * One primary button that carries the job forward (#144).
 *
 * This replaces the four-icon row from #122, on the owner's direction
 * after using it on site. The row showed every verb at once, disabled
 * where it did not apply, and that produced two failures. A job only ever
 * has one next step, On my way, then Start, then Complete, so four
 * choices were three too many. And the disabled buttons created a trap:
 * from "on the way", the button wired to the stand-down confirmation
 * (#127) was itself disabled, so a technician who could not reach site
 * had no reachable way to say so and was funnelled into Pause, whose
 * reasons are about work in progress and can hand the job back for good.
 *
 * So: one large primary naming the next step, and at most one smaller
 * action beside it for the thing that is NOT the next step (Cannot get
 * there while travelling, Pause while working, Complete while paused).
 *
 * Icons stay in the brand's hand-made SVG line style, beside the label
 * rather than instead of it, and everything carries an
 * accessibilityLabel.
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { colors, fonts } from './ui';
import type { WoState } from '../api/client';

export type LifecycleVerb = 'on_the_way' | 'start' | 'pause' | 'stop' | 'stand_down';

const SIZE = 22;

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

/** The van turning back: the stand-down affordance (#127), reachable at
 * last. A cross rather than a fuller drawing, because at 22px beside a
 * label the mark has to read at a glance and "not going" is what it
 * says. */
function CannotIcon({ color }: { color: string }) {
  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={1.8} />
      <Line x1={9} y1={9} x2={15} y2={15} stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1={15} y1={9} x2={9} y2={15} stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

interface Action {
  verb: LifecycleVerb;
  label: string;
  spoken: string;
  Icon: (p: { color: string }) => React.JSX.Element;
}

/** The next step, and at most one alternative beside it. Mirrors the
 * server's state machine deliberately narrowly: this decides what is
 * TAPPABLE, the server decides what is true. */
function actionsFor(
  state: WoState,
  blocksResume: boolean,
): { primary: Action | null; side: Action | null } {
  switch (state) {
    case 'not_started':
      return {
        primary: { verb: 'on_the_way', label: 'On my way', spoken: 'On my way to site', Icon: VanIcon },
        side: null,
      };
    case 'on_the_way':
      return {
        primary: { verb: 'start', label: 'Start work', spoken: 'Start work and open the job card', Icon: PlayIcon },
        side: {
          verb: 'stand_down',
          label: 'Cannot get there',
          spoken: 'Cannot get there, put the job back on my list',
          Icon: CannotIcon,
        },
      };
    case 'started':
      return {
        primary: { verb: 'stop', label: 'Complete', spoken: 'Work complete', Icon: CompleteIcon },
        side: { verb: 'pause', label: 'Pause', spoken: 'Pause work', Icon: PauseIcon },
      };
    case 'paused':
      // A pause reason like incomplete-for-spares bars the technician
      // from resuming; the office reopens it. The screen explains that,
      // so this renders nothing rather than a dead button.
      if (blocksResume) return { primary: null, side: null };
      return {
        primary: { verb: 'start', label: 'Resume', spoken: 'Resume work', Icon: PlayIcon },
        side: { verb: 'stop', label: 'Complete', spoken: 'Work complete', Icon: CompleteIcon },
      };
    default:
      return { primary: null, side: null };
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
  onAction: (verb: LifecycleVerb) => void;
}) {
  const { primary, side } = actionsFor(state, blocksResume);
  if (!primary) return null;

  return (
    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
      <Pressable
        onPress={() => !busy && onAction(primary.verb)}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={primary.spoken}
        accessibilityState={{ disabled: busy }}
        style={{
          flex: 2,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          paddingVertical: 14,
          borderRadius: 12,
          backgroundColor: colors.green,
          opacity: busy ? 0.6 : 1,
        }}
      >
        <primary.Icon color={colors.navy} />
        <Text style={{ fontSize: 15, color: colors.navy, fontFamily: fonts.bodyMedium }}>
          {primary.label}
        </Text>
      </Pressable>
      {side ? (
        <Pressable
          onPress={() => !busy && onAction(side.verb)}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={side.spoken}
          accessibilityState={{ disabled: busy }}
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: 8,
            paddingHorizontal: 6,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.line,
            backgroundColor: '#fff',
            opacity: busy ? 0.6 : 1,
          }}
        >
          <side.Icon color={colors.navy} />
          <Text
            style={{
              marginTop: 2,
              fontSize: 11,
              color: colors.navy,
              fontFamily: fonts.bodyMedium,
              textAlign: 'center',
            }}
          >
            {side.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
