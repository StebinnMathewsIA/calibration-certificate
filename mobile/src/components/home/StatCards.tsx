/**
 * The four number cards (#157): the technician's day at a glance. Jobs
 * complete, spares used, kilometres travelled and labour hours booked,
 * all summed server-side from the day's signed job cards.
 */
import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { HomeStats } from '../../api/client';
import { colors, fonts } from '../ui';

function Stat({
  icon,
  value,
  unit,
  label,
  accent,
}: {
  icon: React.ReactNode;
  value: string;
  unit?: string;
  label: string;
  accent?: boolean;
}) {
  return (
    <View
      style={{
        flexBasis: '48.5%',
        backgroundColor: '#fff',
        borderRadius: 18,
        borderWidth: 1,
        borderColor: colors.line,
        padding: 12,
      }}
    >
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 999,
          backgroundColor: accent ? colors.greenTint : colors.bg,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 7,
        }}
      >
        {icon}
      </View>
      <Text style={{ fontFamily: fonts.heading, fontSize: 24, color: colors.ink, fontVariant: ['tabular-nums'] }}>
        {value}
        {unit ? <Text style={{ fontSize: 14, color: colors.muted }}> {unit}</Text> : null}
      </Text>
      <Text style={{ fontSize: 12, color: colors.muted, marginTop: 1 }}>{label}</Text>
    </View>
  );
}

export function StatCards({ stats }: { stats: HomeStats | null }) {
  const s = stats ?? { jobsComplete: 0, sparesUsed: 0, travelledKm: 0, labourHours: 0 };
  const tick = (
    <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
      <Path d="M4 12.5l5 5L20 6.5" stroke={colors.greenText} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
  const box = (
    <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
      <Path d="M3.5 8l8.5-4.5L20.5 8v8L12 20.5 3.5 16z" stroke={colors.navy} strokeWidth={1.9} strokeLinejoin="round" />
      <Path d="M3.5 8L12 12.5 20.5 8M12 12.5v8" stroke={colors.navy} strokeWidth={1.9} strokeLinejoin="round" />
    </Svg>
  );
  const road = (
    <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
      <Path d="M5 21L9 3M19 21L15 3M12 5v2.5M12 11v2.5M12 17v2.5" stroke={colors.navy} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
  const clock = (
    <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={8.5} stroke={colors.navy} strokeWidth={2} />
      <Path d="M12 7.5V12l3 2" stroke={colors.navy} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        rowGap: 9,
        marginHorizontal: 12,
        marginTop: 10,
      }}
    >
      <Stat icon={tick} value={String(s.jobsComplete)} label="Jobs complete" accent />
      <Stat icon={box} value={String(s.sparesUsed)} label="Spares used" />
      <Stat icon={road} value={String(Math.round(s.travelledKm))} unit="km" label="Travelled" />
      <Stat icon={clock} value={s.labourHours.toFixed(1)} unit="h" label="Labour booked" />
    </View>
  );
}
