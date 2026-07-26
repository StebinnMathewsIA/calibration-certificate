/**
 * Mini map preview + "Open in Google Maps" (#73). The preview is an
 * OpenStreetMap embed in the existing WebView (no native map module, no API
 * key — OTA-deliverable); the button hands off to the Google Maps app via
 * the universal maps URL. Offline the preview goes blank but the handoff
 * still works. No GPS: falls back to an address search button; neither:
 * renders nothing.
 */
import React from 'react';
import { Linking, Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { WebView } from 'react-native-webview';
import { colors } from './ui';

/** Navigation-arrow glyph in the brand line style (no emoji, per owner). */
function DirectionsIcon({ color, size = 22 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3.5 L20.5 20 L12 16 L3.5 20 Z"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function parseWktPoint(wkt?: string | null): { lat: number; lon: number } | null {
  const m = /POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i.exec(wkt ?? '');
  if (!m) return null;
  const lon = parseFloat(m[1]);
  const lat = parseFloat(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat === 0 && lon === 0) return null;
  return { lat, lon };
}

export function MiniMap({
  gpsWkt,
  address,
  height = 150,
}: {
  gpsWkt?: string | null;
  address?: string | null;
  height?: number;
}) {
  const point = parseWktPoint(gpsWkt);
  if (!point && !(address ?? '').trim()) return null;

  const openMaps = () => {
    const query = point ? `${point.lat},${point.lon}` : encodeURIComponent(address!.trim());
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`).catch(() => {});
  };

  const d = 0.004; // ~400 m box around the marker
  const embedUrl = point
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${point.lon - d},${point.lat - d},${point.lon + d},${point.lat + d}&layer=mapnik&marker=${point.lat},${point.lon}`
    : null;

  const iconButton = (
    <Pressable
      onPress={openMaps}
      accessibilityRole="button"
      accessibilityLabel="Open directions in Google Maps"
      hitSlop={8}
      style={{
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: colors.line,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <DirectionsIcon color={colors.navy} />
    </Pressable>
  );

  return (
    <View style={{ marginTop: 8 }}>
      {embedUrl ? (
        <View
          style={{
            height,
            borderRadius: 12,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: colors.line,
          }}
        >
          <View style={{ flex: 1 }} pointerEvents="none">
            <WebView
              source={{ uri: embedUrl }}
              originWhitelist={['*']}
              setSupportMultipleWindows={false}
              scrollEnabled={false}
            />
          </View>
          <View style={{ position: 'absolute', bottom: 10, right: 10 }}>{iconButton}</View>
        </View>
      ) : (
        <View style={{ alignItems: 'flex-start' }}>{iconButton}</View>
      )}
    </View>
  );
}
