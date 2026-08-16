/** Free distance (#157, owner decision): straight line times a 1.3 road
 * factor, computed on the device from coordinates we already hold. No
 * routing API exists in this app, deliberately: the paid thing routing
 * providers sell is the traffic-aware TIME, and the card only needs how
 * far. Works offline, costs nothing at any fleet size. This figure is
 * orientation, never billing: the Travelled number on completed cards is
 * the job card's entered distance. */
const ROAD_FACTOR = 1.3;

export function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const la = (a.latitude * Math.PI) / 180;
  const lb = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function roadKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  return haversineKm(a, b) * ROAD_FACTOR;
}

export function formatKm(km: number): string {
  return km >= 10 ? `${Math.round(km)} km` : `${km.toFixed(1)} km`;
}
