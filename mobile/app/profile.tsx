import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { useAuth } from '../src/auth/AuthContext';
import { Badge, Button, SectionCard, colors } from '../src/components/ui';
import { FormScrollView } from '../src/components/FormScrollView';
import { readCache } from '../src/db/cache';
import { getProfile, saveProfile, voSignatureCacheKey } from '../src/profile/profileStore';

const inputStyle = {
  borderWidth: 1,
  borderColor: colors.line,
  borderRadius: 6,
  paddingHorizontal: 10,
  paddingVertical: 8,
  marginBottom: 10,
  color: colors.ink,
  backgroundColor: '#fff',
} as const;

export default function ProfileScreen() {
  const { identity, signOut } = useAuth();
  const router = useRouter();
  const subject = identity?.subject ?? '';

  const [displayName, setDisplayName] = useState('');
  const [pliers, setPliers] = useState('');
  const [signatureSvg, setSignatureSvg] = useState('');
  const [loaded, setLoaded] = useState(false);

  // Load the profile, and pick up a freshly-drawn signature on return.
  useFocusEffect(
    useCallback(() => {
      const p = getProfile(subject);
      if (!loaded) {
        setDisplayName(p.displayName ?? identity?.name ?? '');
        setPliers(p.pliersNumber ?? '');
        setLoaded(true);
      }
      const fresh = readCache<string>(voSignatureCacheKey(subject));
      setSignatureSvg(fresh ?? p.signatureSvg ?? '');
    }, [subject, identity?.name, loaded]),
  );

  const save = () => {
    saveProfile(subject, {
      displayName: displayName.trim() || identity?.name,
      pliersNumber: pliers.trim(),
      signatureSvg: signatureSvg || undefined,
    });
    Alert.alert('Profile saved', 'Your name, VO number and signature will be used on certificates you sign.');
    router.back();
  };

  return (
    <FormScrollView>
      <SectionCard title="My profile">
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 8 }}>
          Signed in as {identity?.name}. These details are used on the certificates you sign as the
          Verifying Officer.
        </Text>
        <Text style={{ fontSize: 12, color: colors.muted }}>Name (as it should appear on the certificate)</Text>
        <TextInput style={inputStyle} value={displayName} onChangeText={setDisplayName} />
        <Text style={{ fontSize: 12, color: colors.muted }}>VO Pliers No.</Text>
        <TextInput style={inputStyle} value={pliers} onChangeText={setPliers} />
      </SectionCard>

      <SectionCard title="My signature">
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 8 }}>
          Draw your signature once. It is saved on this device and embedded into every certificate
          you sign, so the VO signature looks like yours.
        </Text>
        <Badge
          text={signatureSvg ? 'Signature saved ✓' : 'No signature yet'}
          tone={signatureSvg ? 'ok' : 'warn'}
        />
        <Button
          title={signatureSvg ? 'Update my signature' : 'Add my signature'}
          kind="secondary"
          onPress={() =>
            router.push({
              pathname: '/signature',
              params: {
                cacheKey: voSignatureCacheKey(subject),
                title: 'Your signature',
                hint: 'Sign in the box below — this becomes your VO signature on certificates.',
              },
            })
          }
        />
      </SectionCard>

      <View style={{ marginHorizontal: 12 }}>
        <Button title="Save profile" onPress={save} />
      </View>

      <SectionCard title="Account">
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 8 }}>
          Signed in as {identity?.name}.
        </Text>
        <Button
          title="Sign out"
          kind="danger"
          onPress={() =>
            Alert.alert('Sign out', 'Sign out of this device?', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Sign out',
                style: 'destructive',
                onPress: async () => {
                  await signOut();
                  router.replace('/');
                },
              },
            ])
          }
        />
      </SectionCard>
    </FormScrollView>
  );
}
