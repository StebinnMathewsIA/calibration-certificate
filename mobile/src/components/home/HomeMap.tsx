/**
 * The Home map strip (#157): the technician's position with the
 * surrounding open work orders as oil-disc pins, overdue pins chipped
 * red with their days, the rest with their straight-line road-factor
 * distance.
 *
 * The native map is REQUIRED LAZILY, and that is the load-bearing
 * decision here: react-native-maps is a native module, so it only exists
 * on phones that have installed the new EAS build. This same JS bundle
 * also ships over the air to phones running the OLD build, where the
 * require throws; those render the quiet placeholder instead of
 * crashing on launch. When the new build lands, the map lights up with
 * no further code change.
 */
import React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { WorkOrderRecord } from '../../api/client';
import { parseWktPoint } from '../MiniMap';
import { formatKm, roadKm } from '../../util/geo';
import { overdueDays } from '../../util/format';
import { colors, fonts } from '../ui';
import { OilDisc } from './OilDisc';
import { MAP_STYLE } from './mapStyle';

type Maps = typeof import('react-native-maps') | null;
let maps: Maps = null;
let mapsError: string | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  maps = require('react-native-maps');
} catch (e) {
  // Old native build, or the module failed to link: the placeholder
  // carries the REAL reason, because "install the new build" turned out
  // to be a guess when a freshly built binary showed the same thing.
  maps = null;
  mapsError = e instanceof Error ? e.message : String(e);
}

export type MapPin = {
  wo: WorkOrderRecord;
  latitude: number;
  longitude: number;
};

export function pinsFor(records: WorkOrderRecord[]): MapPin[] {
  const pins: MapPin[] = [];
  for (const wo of records) {
    const p = parseWktPoint(wo.gpsLocation);
    if (p) pins.push({ wo, latitude: p.lat, longitude: p.lon });
  }
  return pins;
}

function PinBubble({ pin, here }: { pin: MapPin; here: { latitude: number; longitude: number } | null }) {
  const late = overdueDays(pin.wo.completeBy);
  const chip =
    late != null
      ? { text: `${late} d`, color: colors.red }
      : here
        ? { text: formatKm(roadKm(here, pin)), color: colors.ink }
        : null;
  return (
    <View style={{ alignItems: 'center' }}>
      <OilDisc customerName={pin.wo.customerName} size={30} />
      {chip ? (
        <View
          style={{
            marginTop: 2,
            backgroundColor: '#fff',
            borderRadius: 999,
            paddingVertical: 1,
            paddingHorizontal: 6,
            borderWidth: 1,
            borderColor: colors.line,
          }}
        >
          <Text style={{ fontSize: 10, color: chip.color, fontFamily: fonts.bodyMedium }}>
            {chip.text}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function HomeMap({
  here,
  pins,
  height,
  fill = false,
  interactive = false,
  onPress,
  onPinPress,
}: {
  here: { latitude: number; longitude: number } | null;
  pins: MapPin[];
  height?: number;
  /** Fill the parent (the full-screen map) instead of a fixed strip. */
  fill?: boolean;
  /** Pan and zoom; the Home strip keeps them off and taps through. */
  interactive?: boolean;
  /** Tap anywhere on a non-interactive strip (#158): opens the full map. */
  onPress?: () => void;
  /** Tap a pin on the interactive map (#158). */
  onPinPress?: (pin: MapPin) => void;
}) {
  const frame = fill
    ? { flex: 1 as const }
    : {
        height: height ?? 130,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: colors.line,
        overflow: 'hidden' as const,
      };
  if (!maps || (!here && pins.length === 0)) {
    // No native module yet, or nothing to place: the quiet placeholder.
    return (
      <View
        style={[frame, { backgroundColor: '#F4F6F9', alignItems: 'center', justifyContent: 'center' }]}
      >
        <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center', paddingHorizontal: 16 }}>
          {maps
            ? 'The map appears once your position or a work order location is known.'
            : `The map module did not load: ${(mapsError ?? 'not in this build').slice(0, 160)}`}
        </Text>
      </View>
    );
  }

  const MapView = maps.default;
  const { Marker, PROVIDER_GOOGLE } = maps;

  // Frame the technician plus their nearest pins; fall back to the pins
  // alone when position is unknown.
  const focus = here ?? pins[0];
  const framed = interactive ? pins : pins.slice(0, 6);
  const lats = [focus.latitude, ...framed.map((p) => p.latitude)];
  const lons = [focus.longitude, ...framed.map((p) => p.longitude)];
  const latDelta = Math.max(0.05, (Math.max(...lats) - Math.min(...lats)) * 1.6);
  const lonDelta = Math.max(0.05, (Math.max(...lons) - Math.min(...lons)) * 1.6);

  const map = (
    <MapView
      style={{ flex: 1 }}
      provider={PROVIDER_GOOGLE}
      customMapStyle={MAP_STYLE}
      initialRegion={{
        latitude: (Math.max(...lats) + Math.min(...lats)) / 2,
        longitude: (Math.max(...lons) + Math.min(...lons)) / 2,
        latitudeDelta: latDelta,
        longitudeDelta: lonDelta,
      }}
      toolbarEnabled={false}
      showsPointsOfInterest={false}
      showsCompass={false}
      scrollEnabled={interactive}
      zoomEnabled={interactive}
      rotateEnabled={false}
      pitchEnabled={false}
      onPress={interactive ? undefined : onPress}
      {...(Platform.OS === 'ios' ? {} : { liteMode: false })}
    >
      {here ? (
        <Marker coordinate={here} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
          <View
            style={{
              width: 16,
              height: 16,
              borderRadius: 999,
              backgroundColor: colors.navy,
              borderWidth: 3,
              borderColor: '#fff',
            }}
          />
        </Marker>
      ) : null}
      {pins.map((p) => (
        <Marker
          key={p.wo.id}
          coordinate={{ latitude: p.latitude, longitude: p.longitude }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
          onPress={
            onPinPress
              ? (e: { stopPropagation?: () => void }) => {
                  e.stopPropagation?.();
                  onPinPress(p);
                }
              : undefined
          }
        >
          <PinBubble pin={p} here={here} />
        </Marker>
      ))}
    </MapView>
  );

  if (!interactive && onPress) {
    // The strip is one tap target (#158): gestures are off, and a
    // transparent pressable above the map catches the tap reliably on
    // both platforms.
    return (
      <View style={frame}>
        {map}
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel="Open the full work order map"
          style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
        />
      </View>
    );
  }
  return <View style={frame}>{map}</View>;
}
