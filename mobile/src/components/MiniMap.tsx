/**
 * Mini map preview + "Open in Google Maps" (#73). The preview is an
 * OpenStreetMap embed in the existing WebView (no native map module, no API
 * key — OTA-deliverable); the button hands off to the Google Maps app via
 * the universal maps URL. Offline the preview goes blank but the handoff
 * still works. No GPS: falls back to an address search button; neither:
 * renders nothing.
 */
import React from 'react';
import { Linking, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Button, colors } from './ui';

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
            marginBottom: 8,
          }}
          pointerEvents="none"
        >
          <WebView
            source={{ uri: embedUrl }}
            originWhitelist={['*']}
            setSupportMultipleWindows={false}
            scrollEnabled={false}
          />
        </View>
      ) : null}
      <Button title="Open in Google Maps" kind="secondary" onPress={openMaps} />
    </View>
  );
}
