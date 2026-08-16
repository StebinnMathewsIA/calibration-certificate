/**
 * The full work order map (#158): every open work order pinned around
 * the technician's position, same brand style as the Home strip. Tap a
 * pin and its card rises over the map, expanded (full work text plus
 * status detail); tap the card to open the work order, tap the map to
 * dismiss. On builds without the native module the screen explains
 * itself, same as the strip.
 */
import * as Location from 'expo-location';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { WorkOrderRecord, listWorkOrderRecords } from '../src/api/client';
import { useAuth } from '../src/auth/AuthContext';
import { HomeMap, MapPin, pinsFor } from '../src/components/home/HomeMap';
import { WorkOrderCard } from '../src/components/home/WorkOrderCard';
import { colors } from '../src/components/ui';
import { fetchThrough } from '../src/db/cache';
import { roadKm } from '../src/util/geo';
import { parseWktPoint } from '../src/components/MiniMap';

export default function MapScreen() {
  const { accessToken } = useAuth();
  const [records, setRecords] = useState<WorkOrderRecord[]>([]);
  const [here, setHere] = useState<{ latitude: number; longitude: number } | null>(null);
  const [selected, setSelected] = useState<WorkOrderRecord | null>(null);

  useEffect(() => {
    fetchThrough<WorkOrderRecord[]>('wo:records', () => listWorkOrderRecords(accessToken), {
      onFresh: setRecords,
    })
      .then(setRecords)
      .catch(() => {});
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted) return;
        const fix = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setHere({ latitude: fix.coords.latitude, longitude: fix.coords.longitude });
      } catch {
        // No fix: the map frames the pins alone.
      }
    })();
  }, [accessToken]);

  const onPinPress = useCallback((pin: MapPin) => setSelected(pin.wo), []);

  const open = records.filter((w) => w.lifecycle?.state !== 'signed_off');
  const selectedDistance = (() => {
    if (!selected || !here) return null;
    const p = parseWktPoint(selected.gpsLocation);
    return p ? roadKm(here, { latitude: p.lat, longitude: p.lon }) : null;
  })();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <HomeMap here={here} pins={pinsFor(open)} fill interactive onPinPress={onPinPress} />
      {selected ? (
        <>
          {/* Tap the map (through this scrim) to dismiss the card. */}
          <Pressable
            onPress={() => setSelected(null)}
            accessibilityRole="button"
            accessibilityLabel="Dismiss the work order card"
            style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
          />
          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 12,
              maxHeight: '62%',
            }}
          >
            <ScrollView>
              <WorkOrderCard wo={selected} distanceKm={selectedDistance} expanded />
            </ScrollView>
            <Pressable
              onPress={() => setSelected(null)}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={{
                position: 'absolute',
                top: -4,
                right: 18,
                width: 30,
                height: 30,
                borderRadius: 999,
                backgroundColor: colors.navy,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
                <Path d="M6 6l12 12M18 6L6 18" stroke="#fff" strokeWidth={2.6} strokeLinecap="round" />
              </Svg>
            </Pressable>
          </View>
        </>
      ) : open.length > 0 ? (
        <View
          style={{
            position: 'absolute',
            bottom: 16,
            alignSelf: 'center',
            backgroundColor: '#fff',
            borderRadius: 999,
            borderWidth: 1,
            borderColor: colors.line,
            paddingVertical: 7,
            paddingHorizontal: 14,
          }}
        >
          <Text style={{ fontSize: 12.5, color: colors.muted }}>
            {open.filter((w) => parseWktPoint(w.gpsLocation)).length} work orders pinned. Tap a
            pin for its details.
          </Text>
        </View>
      ) : null}
    </View>
  );
}
