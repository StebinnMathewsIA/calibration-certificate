/**
 * "Start next" card (#107): the advisory ranking on Home. Overdue work
 * always ranks first, then urgency and proximity from the technician's
 * live location. Every row says WHY it is placed where it is, and the
 * technician is free to pick anything.
 */
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import React, { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { WorkOrderRecord, listWorkOrderRecords } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { fetchThrough } from '../db/cache';
import { rankWorkOrders, type Ranked } from '../scheduling/rank';
import { Badge, colors, fonts } from './ui';

const STATE_BADGE: Record<string, { text: string; tone: 'ok' | 'warn' | 'muted' }> = {
  started: { text: 'In progress', tone: 'ok' },
  paused: { text: 'Paused', tone: 'warn' },
  stopped: { text: 'Stopped', tone: 'ok' },
};

export function NextJobs() {
  const { accessToken } = useAuth();
  const router = useRouter();
  const [ranked, setRanked] = useState<Ranked[] | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    let here: { latitude: number; longitude: number } | null = null;
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.granted) {
        const fix = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        here = { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
      }
    } catch {
      // No fix: the ranking still works on urgency alone.
    }
    try {
      const list = await fetchThrough<WorkOrderRecord[]>('wo:records', () =>
        listWorkOrderRecords(accessToken),
      );
      setRanked(rankWorkOrders(list, here));
    } catch {
      setRanked([]);
    }
  }, [accessToken]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!ranked || ranked.length === 0) return null;
  const shown = expanded ? ranked : ranked.slice(0, 3);

  return (
    <View style={{ marginHorizontal: 12, marginBottom: 10 }}>
      <Text style={{ fontWeight: '700', color: colors.ink, fontSize: 15, marginBottom: 4 }}>
        Suggested next
      </Text>
      <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 6 }}>
        Overdue work first, then urgency and how close you are. You can start any job.
      </Text>
      {shown.map((r, i) => {
        const badge = STATE_BADGE[r.wo.lifecycle?.state ?? 'not_started'];
        return (
          <Pressable
            key={r.wo.id}
            onPress={() => router.push({ pathname: '/wo/[id]', params: { id: r.wo.id } })}
            style={{
              borderWidth: 1,
              borderColor: r.overdue ? colors.red : colors.line,
              backgroundColor: r.overdue ? colors.redTint : colors.card,
              borderRadius: 12,
              padding: 10,
              marginBottom: 6,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text
                style={{
                  fontFamily: fonts.mono,
                  fontSize: 12,
                  color: colors.muted,
                  marginRight: 6,
                }}
              >
                {i + 1}
              </Text>
              <Text style={{ flex: 1, fontWeight: '700', color: colors.ink, fontSize: 14 }}>
                {r.wo.siteName ?? r.wo.externalRef}
              </Text>
              {badge ? <Badge text={badge.text} tone={badge.tone} /> : null}
            </View>
            <Text style={{ color: colors.ink, fontSize: 12, marginTop: 2 }} numberOfLines={2}>
              {r.wo.workRequired}
            </Text>
            <Text
              style={{
                color: r.overdue ? colors.red : colors.muted,
                fontSize: 11,
                marginTop: 3,
                fontWeight: r.overdue ? '700' : '400',
              }}
            >
              {r.why}
            </Text>
          </Pressable>
        );
      })}
      {ranked.length > 3 ? (
        <Text
          onPress={() => setExpanded(!expanded)}
          accessibilityRole="button"
          style={{ color: colors.blueText, fontSize: 12, marginTop: 2 }}
        >
          {expanded ? 'Show fewer' : `Show all ${ranked.length}`}
        </Text>
      ) : null}
    </View>
  );
}
