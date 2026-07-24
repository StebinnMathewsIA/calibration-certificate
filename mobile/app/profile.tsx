import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { useAuth } from '../src/auth/AuthContext';
import { getMyTechnician, MyTechnician, patchMyTechnician } from '../src/api/client';
import { Badge, Button, SectionCard, colors } from '../src/components/ui';
import { FormScrollView } from '../src/components/FormScrollView';
import { readCache } from '../src/db/cache';
import {
  certificateName,
  getProfile,
  saveProfile,
  voSignatureCacheKey,
} from '../src/profile/profileStore';

const inputStyle = {
  borderWidth: 1,
  borderColor: colors.line,
  borderRadius: 10,
  paddingHorizontal: 10,
  paddingVertical: 8,
  marginBottom: 10,
  color: colors.ink,
  backgroundColor: '#fff',
} as const;

export default function ProfileScreen() {
  const { identity, accessToken, signOut } = useAuth();
  const router = useRouter();
  const subject = identity?.subject ?? '';

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [pliers, setPliers] = useState('');
  const [signatureSvg, setSignatureSvg] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [technician, setTechnician] = useState<MyTechnician | null>(null);
  const [registerEditable, setRegisterEditable] = useState(false);

  // Load the profile, and pick up a freshly-drawn signature on return.
  useFocusEffect(
    useCallback(() => {
      const p = getProfile(subject);
      if (!loaded) {
        if (p.firstName || p.lastName) {
          setFirstName(p.firstName ?? '');
          setLastName(p.lastName ?? '');
        } else {
          // Best-effort split of the legacy single name / sign-in name.
          const words = (p.displayName ?? identity?.name ?? '')
            .split(/\s+/)
            .filter((w) => Boolean(w) && !w.includes('@'));
          setFirstName(words.slice(0, -1).join(' '));
          setLastName(words.length > 0 ? words[words.length - 1] : '');
        }
        setPliers(p.pliersNumber ?? '');
        setLoaded(true);
      }
      const fresh = readCache<string>(voSignatureCacheKey(subject));
      setSignatureSvg(fresh ?? p.signatureSvg ?? '');
    }, [subject, identity?.name, loaded]),
  );

  // The technician register is the SOURCE OF TRUTH for the name (#63): it is
  // shown read-only and cached into the local store so offline certificate
  // printing and the Home greeting keep working. Offline keeps local values.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getMyTechnician(accessToken)
        .then(({ technician: tech, editable }) => {
          if (cancelled) return;
          setTechnician(tech);
          setRegisterEditable(editable);
          let first = tech.firstName ?? '';
          let last = tech.lastName ?? '';
          if (!first && !last && tech.name) {
            const words = tech.name.split(/\s+/).filter(Boolean);
            first = words.slice(0, -1).join(' ');
            last = words[words.length - 1] ?? '';
          }
          if (first || last) {
            setFirstName(first);
            setLastName(last);
            const p = getProfile(subject);
            saveProfile(subject, {
              ...p,
              firstName: first || undefined,
              lastName: last || undefined,
              displayName: `${first} ${last}`.trim() || p.displayName,
            });
          }
          const p = getProfile(subject);
          if (!p.pliersNumber && tech.pliersNumber) setPliers(tech.pliersNumber);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, [accessToken, subject]),
  );

  const onCertificate = certificateName(
    { firstName, lastName },
    identity?.name ?? '',
  );

  const save = () => {
    // Name comes from the technician register (#63) — only pliers and the
    // signature are self-service. Keep whatever name is cached locally.
    const p = getProfile(subject);
    saveProfile(subject, {
      ...p,
      firstName: firstName.trim() || p.firstName,
      lastName: lastName.trim() || p.lastName,
      displayName: `${firstName.trim()} ${lastName.trim()}`.trim() || p.displayName,
      pliersNumber: pliers.trim(),
      signatureSvg: signatureSvg || undefined,
    });
    // Persist pliers to the technician register too — best-effort; demo
    // alias accounts are read-only there and offline saves stay local.
    if (registerEditable && pliers.trim()) {
      patchMyTechnician(accessToken, { pliersNumber: pliers.trim() }).catch(() => {});
    }
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
        <Text style={{ fontSize: 12, color: colors.muted }}>Name (from the technician register)</Text>
        <Text style={{ fontSize: 16, color: colors.ink, fontWeight: '600', marginBottom: 8 }}>
          {`${firstName} ${lastName}`.trim() ||
            'No name on record yet — it comes from the technician register'}
        </Text>
        {firstName.trim() || lastName.trim() ? (
          <Text style={{ fontSize: 13, color: colors.ink }}>
            On certificate (Initial &amp; Surname): <Text style={{ fontWeight: '700' }}>{onCertificate}</Text>
          </Text>
        ) : null}
        <Text style={{ fontSize: 12, color: colors.muted, marginTop: 8 }}>VO Pliers No.</Text>
        <TextInput style={inputStyle} value={pliers} onChangeText={setPliers} />
        {technician ? (
          <Text style={{ fontSize: 12, color: colors.muted, marginTop: 6 }}>
            OnKey record: {technician.staffCode}
            {technician.manager ? ` · Manager: ${technician.manager}` : ''}
            {technician.email ? `\n${technician.email}` : ''}
            {!registerEditable ? '\nDemo account — register is read-only' : ''}
          </Text>
        ) : null}
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
