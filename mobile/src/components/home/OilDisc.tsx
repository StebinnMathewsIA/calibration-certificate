/**
 * The oil company disc on a work order card (#157). Monogram discs in
 * each brand's colours, resolved from the customer name the work order
 * already carries; the Prowalco mark is the fallback when no company is
 * on record. Monograms rather than image assets, deliberately: they are
 * crisp at any size, cost nothing offline, and adding a company is one
 * line here.
 */
import React from 'react';
import { Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { colors, fonts } from '../ui';
import { OIL_DISC_BG, OIL_LOGOS } from './oilLogos';

type Brand = { label: string; bg: string; fg: string; ring: string };

/** Keyed by a lowercase fragment matched against the customer name.
 * Brands with a bundled vector in OIL_LOGOS render the real mark; the
 * rest keep monogram discs until an official asset is supplied. */
const BRANDS: [string, Brand][] = [
  ['bp', { label: 'bp', bg: '#FFF7D6', fg: '#1E7A34', ring: '#6FBF44' }],
  ['engen', { label: 'E', bg: '#0A4E9B', fg: '#FFFFFF', ring: '#D5382E' }],
  ['shell', { label: 'S', bg: '#FBCE07', fg: '#DD1D21', ring: '#DD1D21' }],
  ['sasol', { label: 'S', bg: '#0B3C7B', fg: '#FFFFFF', ring: '#4FA3D8' }],
  ['total', { label: 'T', bg: '#FFFFFF', fg: '#E3122E', ring: '#3D6BB3' }],
  ['astron', { label: 'A', bg: '#FFFFFF', fg: '#0A4E9B', ring: '#E4231F' }],
  ['caltex', { label: 'C', bg: '#FFFFFF', fg: '#DA2032', ring: '#0A4E9B' }],
  ['puma', { label: 'P', bg: '#1D1D1B', fg: '#FFFFFF', ring: '#E30613' }],
];

export function OilDisc({ customerName, size = 46 }: { customerName: string | null; size?: number }) {
  const key = (customerName ?? '').toLowerCase();
  const match = BRANDS.find(([frag]) => key.includes(frag));
  const brand = match?.[1];
  const logo = match ? OIL_LOGOS[match[0]] : undefined;
  if (logo) {
    // The real mark, on white or on its brand fill (Engen sits on Engen
    // blue, per the owner-supplied treatment), cropped by the disc.
    const bg = (match && OIL_DISC_BG[match[0]]) || '#fff';
    return (
      <View
        accessibilityLabel={customerName ?? undefined}
        style={{
          width: size,
          height: size,
          borderRadius: 999,
          backgroundColor: bg,
          borderWidth: 1.5,
          borderColor: bg === '#fff' ? colors.line : bg,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <SvgXml xml={logo} width={size * 0.64} height={size * 0.64} />
      </View>
    );
  }
  if (!brand) {
    // Prowalco fallback: no oil company on record for this site.
    return (
      <View
        accessibilityLabel="Prowalco"
        style={{
          width: size,
          height: size,
          borderRadius: 999,
          backgroundColor: '#fff',
          borderWidth: 2.5,
          borderColor: colors.green,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontFamily: fonts.heading, fontSize: size * 0.24, color: colors.green }}>
          pro
        </Text>
        <Text style={{ fontFamily: fonts.heading, fontSize: size * 0.24, color: colors.navy, marginTop: -2 }}>
          walco
        </Text>
      </View>
    );
  }
  return (
    <View
      accessibilityLabel={customerName ?? undefined}
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        backgroundColor: brand.bg,
        borderWidth: 2.5,
        borderColor: brand.ring,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontFamily: fonts.heading, fontSize: size * 0.34, color: brand.fg }}>
        {brand.label}
      </Text>
    </View>
  );
}
