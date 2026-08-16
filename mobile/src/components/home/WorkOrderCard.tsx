/**
 * The work order card of the Home redesign (#157), built to the owner's
 * reviewed mock. White card always; the oil company disc left; status as
 * an ICON at top right (tick complete, pause stopped or paused, dashed
 * circle upcoming, navigation arrow on the way), except in progress,
 * which carries a play pill with the live time on job. A two line
 * excerpt shows the work required on live and upcoming cards and the
 * work performed on paused and complete ones. The when-tag (overdue in
 * red, otherwise the due day) sits bottom right, opposite the reference.
 */
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { WorkOrderRecord } from '../../api/client';
import { formatDay, formatDuration, overdueDays } from '../../util/format';
import { formatKm } from '../../util/geo';
import { colors, fonts } from '../ui';

type Kind = 'in_progress' | 'on_the_way' | 'upcoming' | 'done';

/** Which of the three Home sections a record belongs to (#157). */
export function homeSection(wo: WorkOrderRecord): 'live' | 'upcoming' | 'done' {
  const s = wo.lifecycle?.state ?? 'not_started';
  if (s === 'started' || s === 'on_the_way') return 'live';
  if (s === 'not_started') return 'upcoming';
  return 'done'; // paused, stopped, signed_off
}

const cardKind = (wo: WorkOrderRecord): Kind => {
  const s = wo.lifecycle?.state ?? 'not_started';
  if (s === 'started') return 'in_progress';
  if (s === 'on_the_way') return 'on_the_way';
  if (s === 'not_started') return 'upcoming';
  return 'done';
};

/** Net minutes on the job: wall clock since start minus completed pauses. */
function minutesOnJob(wo: WorkOrderRecord): number {
  const l = wo.lifecycle;
  if (!l?.startedAt) return 0;
  const end = l.stoppedAt ? new Date(l.stoppedAt).getTime() : Date.now();
  const gross = (end - new Date(l.startedAt).getTime()) / 1000;
  return Math.max(0, Math.round((gross - (l.pausedSeconds ?? 0)) / 60));
}

function StateGlyph({ kind, state }: { kind: Kind; state: string }) {
  const disc = (bg: string, child: React.ReactNode, label: string) => (
    <View
      accessibilityLabel={label}
      style={{
        width: 32,
        height: 32,
        borderRadius: 999,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {child}
    </View>
  );
  if (kind === 'done' && state === 'signed_off') {
    return disc(
      colors.greenTint,
      <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
        <Path d="M4 12.5l5 5L20 6.5" stroke={colors.greenText} strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>,
      'Complete',
    );
  }
  if (kind === 'done') {
    return disc(
      colors.mist,
      <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
        <Path d="M9 5v14M15 5v14" stroke={colors.muted} strokeWidth={2.6} strokeLinecap="round" />
      </Svg>,
      state === 'paused' ? 'Paused' : 'Stopped',
    );
  }
  if (kind === 'on_the_way') {
    return disc(
      colors.blueTint,
      <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
        <Path d="M21 3L10.5 13.5M21 3l-7 18-3.5-7.5L3 10z" stroke={colors.blueText} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>,
      'On the way',
    );
  }
  // upcoming
  return (
    <View
      accessibilityLabel="Not started"
      style={{
        width: 32,
        height: 32,
        borderRadius: 999,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: colors.line,
      }}
    />
  );
}

function MetaCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, width: '48%' }}>
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 999,
          backgroundColor: colors.bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 11.5, color: colors.muted }}>{label}</Text>
        <Text
          style={{ fontSize: 13.5, color: colors.ink, fontFamily: fonts.bodyMedium, fontVariant: ['tabular-nums'] }}
          numberOfLines={1}
        >
          {value}
        </Text>
      </View>
    </View>
  );
}

const ClockIcon = (
  <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
    <Circle cx={12} cy={12} r={8.5} stroke={colors.navy} strokeWidth={2} />
    <Path d="M12 7.5V12l3 2" stroke={colors.navy} strokeWidth={2} strokeLinecap="round" />
  </Svg>
);
const TimerIcon = (
  <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
    <Path d="M10 2h4M12 8v5l2.5 2" stroke={colors.navy} strokeWidth={2} strokeLinecap="round" />
    <Circle cx={12} cy={14} r={7.5} stroke={colors.navy} strokeWidth={2} />
  </Svg>
);
const RoadIcon = (
  <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
    <Path d="M5 21L9 3M19 21L15 3M12 5v2.5M12 11v2.5M12 17v2.5" stroke={colors.navy} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
const BoxIcon = (
  <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
    <Path d="M3.5 8l8.5-4.5L20.5 8v8L12 20.5 3.5 16z" stroke={colors.navy} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M3.5 8L12 12.5 20.5 8M12 12.5v8" stroke={colors.navy} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
const CalendarIcon = (
  <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
    <Rect x={4} y={5.5} width={16} height={15} rx={2.5} stroke={colors.navy} strokeWidth={2} />
    <Path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" stroke={colors.navy} strokeWidth={2} strokeLinecap="round" />
  </Svg>
);

import { OilDisc } from './OilDisc';

export function WorkOrderCard({
  wo,
  distanceKm,
  expanded = false,
}: {
  wo: WorkOrderRecord;
  /** Straight-line road-factor estimate to site, when position is known. */
  distanceKm?: number | null;
  /** Full work text instead of the two line clamp, plus the status
   * detail line: the map's pin card (#158). */
  expanded?: boolean;
}) {
  const router = useRouter();
  const kind = cardKind(wo);
  const state = wo.lifecycle?.state ?? 'not_started';

  // The play pill ticks while the card is on screen (#157): minute
  // granularity, so a once-a-minute rerender is exactly enough.
  const [, bump] = useState(0);
  useEffect(() => {
    if (kind !== 'in_progress') return;
    const t = setInterval(() => bump((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, [kind]);

  const jc = wo.jobCardSummary;
  // Recorded labour supersedes the timer (#157, owner rule).
  const recordedMin = jc && jc.labourMinutes > 0 ? jc.labourMinutes : null;
  const excerpt =
    kind === 'done'
      ? { label: 'Work performed', text: jc?.workPerformed ?? null }
      : { label: 'Work required', text: wo.workRequired };
  const late = overdueDays(wo.completeBy);

  const cells: { icon: React.ReactNode; label: string; value: string }[] = [];
  const est = formatDuration(wo.estimatedDurationMinutes);
  if (est) cells.push({ icon: ClockIcon, label: 'Estimated', value: est });
  if (kind === 'upcoming' || kind === 'on_the_way') {
    const day = formatDay(wo.completeBy);
    if (day) cells.push({ icon: CalendarIcon, label: 'Complete by', value: day });
  }
  if (kind === 'done') {
    const t = recordedMin ?? (minutesOnJob(wo) || null);
    if (t != null)
      cells.push({
        icon: TimerIcon,
        label: recordedMin != null ? 'Time recorded' : 'Time on job',
        value: formatDuration(t)!,
      });
  }
  if (kind !== 'upcoming' && kind !== 'on_the_way' && jc && jc.travelledKm > 0) {
    cells.push({ icon: RoadIcon, label: 'Travelled', value: formatKm(jc.travelledKm) });
  }
  if (kind === 'on_the_way' && distanceKm != null) {
    cells.push({ icon: RoadIcon, label: 'Distance to site', value: formatKm(distanceKm) });
  }
  if (kind !== 'upcoming' && jc) {
    cells.push({
      icon: BoxIcon,
      label: 'Spares',
      value: `${jc.sparesCount} item${jc.sparesCount === 1 ? '' : 's'}`,
    });
  }

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/wo/[id]', params: { id: wo.id } })}
      accessibilityRole="button"
      accessibilityLabel={`Open work order ${wo.siteName ?? wo.externalRef ?? ''}`}
      style={{
        backgroundColor: '#fff',
        borderRadius: 20,
        borderWidth: 1,
        borderColor: colors.line,
        padding: 14,
        marginHorizontal: 12,
        marginTop: 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <OilDisc customerName={wo.customerName} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={{ fontFamily: fonts.heading, fontSize: 16, color: colors.ink }}
            numberOfLines={1}
          >
            {wo.siteName ?? wo.externalRef ?? 'Work order'}
          </Text>
          <Text style={{ fontSize: 12.5, color: colors.muted, marginTop: 1 }} numberOfLines={1}>
            {[wo.customerName, wo.assetDescription ?? wo.assetCode].filter(Boolean).join(' · ') ||
              'Oil company not on record'}
          </Text>
        </View>
        {kind === 'in_progress' ? (
          <View
            accessibilityLabel={`In progress, ${formatDuration(minutesOnJob(wo)) ?? '0 min'} on job`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
              backgroundColor: colors.blueTint,
              borderRadius: 999,
              paddingVertical: 6,
              paddingHorizontal: 11,
            }}
          >
            <Svg width={11} height={11} viewBox="0 0 24 24" fill="none">
              <Path d="M8 5.5v13l10-6.5z" stroke={colors.blueText} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
            <Text
              style={{ color: colors.blueText, fontSize: 12.5, fontFamily: fonts.bodyMedium, fontVariant: ['tabular-nums'] }}
            >
              {formatDuration(minutesOnJob(wo)) ?? '0 min'}
            </Text>
          </View>
        ) : (
          <StateGlyph kind={kind} state={state} />
        )}
      </View>

      {excerpt.text ? (
        <View style={{ marginTop: 9 }}>
          <Text style={{ fontSize: 10.5, letterSpacing: 0.6, color: colors.muted, textTransform: 'uppercase', fontFamily: fonts.bodyMedium }}>
            {excerpt.label}
          </Text>
          <Text
            style={{ fontSize: 12.5, lineHeight: 18, color: colors.muted, marginTop: 1 }}
            numberOfLines={expanded ? undefined : 2}
          >
            {excerpt.text}
          </Text>
        </View>
      ) : null}

      {expanded && wo.statusDescription ? (
        <Text style={{ fontSize: 12, color: colors.muted, marginTop: 7 }}>
          Status {wo.statusDescription}
          {wo.importanceDescription ? ` · ${wo.importanceDescription}` : ''}
        </Text>
      ) : null}

      {cells.length > 0 ? (
        <>
          <View style={{ height: 1, backgroundColor: colors.line, marginTop: 11, marginBottom: 10 }} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 9, justifyContent: 'space-between' }}>
            {cells.map((c) => (
              <MetaCell key={c.label} icon={c.icon} label={c.label} value={c.value} />
            ))}
          </View>
        </>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
        <Text style={{ fontFamily: fonts.mono, fontSize: 11.5, color: colors.muted }}>
          {wo.externalRef ?? ''}
        </Text>
        {late != null ? (
          <View style={{ backgroundColor: colors.redTint, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 }}>
            <Text style={{ color: colors.red, fontSize: 12, fontFamily: fonts.bodyMedium }}>
              Overdue by {late} day{late === 1 ? '' : 's'}
            </Text>
          </View>
        ) : kind === 'upcoming' && formatDay(wo.completeBy) ? (
          <View style={{ backgroundColor: colors.mist, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 }}>
            <Text style={{ color: colors.muted, fontSize: 12 }}>Due {formatDay(wo.completeBy)}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
