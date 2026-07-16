import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Button, colors, styles } from '../../../src/components/ui';
import { SignaturePad } from '../../../src/components/SignaturePad';
import { writeCache } from '../../../src/db/cache';

/**
 * Full-screen client-signature capture. Kept OFF the sign screen's ScrollView
 * so the drawing gesture never fights vertical scrolling. The captured SVG is
 * stashed in the cache under `signature:<id>`; the sign screen reads it back.
 */
export default function SignatureScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [svg, setSvg] = useState('');

  const save = () => {
    if (!svg) {
      Alert.alert('No signature yet', 'Ask the client to sign in the box before saving.');
      return;
    }
    writeCache(`signature:${id}`, svg);
    router.back();
  };

  return (
    <View style={[styles.screen, { padding: 16, justifyContent: 'center' }]}>
      <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 6 }}>
        Client signature
      </Text>
      <Text style={{ color: colors.muted, marginBottom: 16 }}>
        Hand the device to the client and ask them to sign in the box below.
      </Text>
      <SignaturePad onChange={setSvg} />
      <View style={{ marginTop: 20 }}>
        <Button title="Save signature" onPress={save} />
        <Button title="Cancel" kind="secondary" onPress={() => router.back()} />
      </View>
    </View>
  );
}
