import React from 'react';
import Svg, { Path, Rect } from 'react-native-svg';
import { Provider } from '../auth/AuthContext';

/**
 * Official identity-provider marks, rendered from each provider's canonical
 * vector path data so they stay crisp at any size and are brand-accurate.
 *  - Microsoft: the four-square logo (#F25022 / #7FBA00 / #00A4EF / #FFB900)
 *  - Google:    the four-colour "G" (Google identity-button guidelines)
 *  - Apple:     the Apple mark (rendered in `appleTint`, default white for the
 *               black Apple button)
 */
export function ProviderLogo({
  provider,
  size,
  appleTint = '#ffffff',
}: {
  provider: Provider;
  size: number;
  appleTint?: string;
}) {
  if (provider === 'microsoft') {
    return (
      <Svg width={size} height={size} viewBox="0 0 23 23">
        <Rect x="1" y="1" width="10" height="10" fill="#F25022" />
        <Rect x="12" y="1" width="10" height="10" fill="#7FBA00" />
        <Rect x="1" y="12" width="10" height="10" fill="#00A4EF" />
        <Rect x="12" y="12" width="10" height="10" fill="#FFB900" />
      </Svg>
    );
  }

  if (provider === 'google') {
    return (
      <Svg width={size} height={size} viewBox="0 0 48 48">
        <Path
          fill="#4285F4"
          d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
        />
        <Path
          fill="#34A853"
          d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
        />
        <Path
          fill="#FBBC05"
          d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
        />
        <Path
          fill="#EA4335"
          d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
        />
      </Svg>
    );
  }

  // Apple — single-colour mark; viewBox proportioned to the official glyph.
  return (
    <Svg width={size} height={size} viewBox="0 0 814 1000">
      <Path
        fill={appleTint}
        d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 197.6 99.2zm-233.7-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"
      />
    </Svg>
  );
}
