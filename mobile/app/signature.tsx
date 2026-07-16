import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Button, colors, styles } from '../src/components/ui';
import { SignaturePad } from '../src/components/SignaturePad';
import { writeCache } from '../src/db/cache';

/**
 * Full-screen, locked signature capture (no swipe/back dismiss — Save or
 * Cancel only). Generic: it writes the drawn SVG to the `cacheKey` it is given,
 * so it serves both the client signature (per verification) and the VO's own
 * profile signature. The caller reads the value back from the same key.
 */
export default function SignatureScreen() {
  const { cacheKey, title, hint } = useLocalSearchParams<{
    cacheKey: string;
    title?: string;
    hint?: string;
  }>();
  const router = useRouter();
  const [svg, setSvg] = useState('');

  const save = () => {
    if (!svg) {
      Alert.alert('No signature yet', 'Please draw a signature in the box before saving.');
      return;
    }
    writeCache(cacheKey, svg);
    router.back();
  };

  return (
    <View style={[styles.screen, { padding: 16, justifyContent: 'center' }]}>
      <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 6 }}>
        {title ?? 'Signature'}
      </Text>
      <Text style={{ color: colors.muted, marginBottom: 16 }}>
        {hint ?? 'Sign in the box below.'}
      </Text>
      <SignaturePad onChange={setSvg} />
      <View style={{ marginTop: 20 }}>
        <Button title="Save signature" onPress={save} />
        <Button title="Cancel" kind="secondary" onPress={() => router.back()} />
      </View>
    </View>
  );
}
