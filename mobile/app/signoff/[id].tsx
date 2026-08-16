/**
 * Client sign-off, on its own page (#162), and sign-off IS completion
 * (#165, owner rule): the client's name, contact details and signature,
 * and the seal finishes the job. Complete on the work order page routes
 * here; the server stops and signs off the job in one act at seal.
 *
 * A job stopped before signing (the old flow) still seals here and moves
 * straight to signed off.
 */
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput } from 'react-native';
import { JobCardBundle, getJobCard, signJobCard } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { Badge, Button, SectionCard, colors } from '../../src/components/ui';
import { FormScrollView } from '../../src/components/FormScrollView';
import { readCache } from '../../src/db/cache';
import { hasProfileSignature, voSignatureCacheKey } from '../../src/profile/profileStore';

const styles = StyleSheet.create({
  field: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    color: colors.ink,
    backgroundColor: '#fff',
    fontSize: 15,
    marginBottom: 8,
  },
});

export default function SignOffScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { accessToken, identity } = useAuth();

  const [bundle, setBundle] = useState<JobCardBundle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [clientName, setClientName] = useState('');
  const [clientContact, setClientContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [, bump] = useState(0);
  const dirty = React.useRef(false);

  const load = useCallback(() => {
    getJobCard(accessToken, String(id), {
      onFresh: (fresh) => {
        setBundle(fresh);
        if (!dirty.current) {
          setClientName(fresh.jobCard?.clientName ?? '');
          setClientContact(fresh.jobCard?.clientContact ?? '');
        }
      },
    })
      .then((b) => {
        setBundle(b);
        if (!dirty.current) {
          setClientName(b.jobCard?.clientName ?? '');
          setClientContact(b.jobCard?.clientContact ?? '');
        }
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)));
    // The signature screen writes to the cache and comes straight back:
    // re-render so the captured state shows without a data change.
    bump((n) => n + 1);
  }, [accessToken, id]);

  useFocusEffect(useCallback(() => load(), [load]));

  if (loadError) {
    return (
      <FormScrollView>
        <SectionCard title="Could not open the sign-off">
          <Text style={{ color: colors.ink, fontSize: 14 }}>{loadError}</Text>
          <Button title="Try again" onPress={load} />
          <Button title="Go back" kind="secondary" onPress={() => router.back()} />
        </SectionCard>
      </FormScrollView>
    );
  }
  if (!bundle) return <Text style={{ padding: 16, color: colors.muted }}>Loading…</Text>;

  const signed = bundle.jobCard?.state === 'signed';
  const capturedSignature = readCache<string>(`jobcard-sign:${id}`);
  const started =
    bundle.lifecycleState !== 'not_started' && bundle.lifecycleState !== 'on_the_way';
  const performedOk = (bundle.jobCard?.workPerformed ?? '').trim().length > 0;
  // Without the technician's own signature the Artisan block on the
  // document comes out blank (#128). Same gate as before.
  const signedByTech = hasProfileSignature(identity?.subject ?? '', readCache);

  const blockers: string[] = [];
  if (!started) blockers.push('start the job');
  if (!performedOk) blockers.push('describe the work performed on the work order page');
  if (!clientName.trim()) blockers.push("enter the client's name");
  if (!clientContact.trim()) blockers.push("enter the client's contact details");
  if (!capturedSignature) blockers.push('capture the signature');
  if (!signedByTech) blockers.push('add your signature to your profile');

  const canSeal = blockers.length === 0 && !signed;

  const capture = () => {
    router.push({
      pathname: '/signature',
      params: {
        cacheKey: `jobcard-sign:${id}`,
        title: 'Client signature',
        hint: 'Hand the phone to the client. Signing accepts the work recorded on this job card.',
      },
    });
  };

  const seal = async () => {
    const clientSig = readCache<string>(`jobcard-sign:${id}`);
    if (!clientSig) {
      capture();
      return;
    }
    setBusy(true);
    try {
      await signJobCard(accessToken, String(id), {
        clientName: clientName.trim(),
        clientContact: clientContact.trim(),
        clientSignature: clientSig,
        techSignature: readCache<string>(voSignatureCacheKey(identity?.subject ?? '')) ?? undefined,
      });
      Alert.alert('Job complete', 'The client has accepted the work and the job is signed off.');
      router.back();
    } catch (err) {
      Alert.alert('Could not sign', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormScrollView>
      <SectionCard title={bundle.workOrderCode ?? 'Sign-off'}>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{bundle.siteName}</Text>
        {(bundle.jobCard?.workPerformed ?? '').trim() ? (
          <Text style={{ color: colors.ink, fontSize: 13, marginTop: 6 }} numberOfLines={4}>
            {bundle.jobCard?.workPerformed}
          </Text>
        ) : null}
      </SectionCard>

      {signed ? (
        <SectionCard title="Signed">
          <Badge text="Signed" tone="ok" />
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
            Accepted by {bundle.jobCard?.clientName}
            {bundle.jobCard?.clientContact ? ` (${bundle.jobCard.clientContact})` : ''} on{' '}
            {bundle.jobCard?.signedAt?.slice(0, 16).replace('T', ' ')}. A signed job card cannot
            be changed.
          </Text>
          <Button title="Back to the work order" onPress={() => router.back()} />
        </SectionCard>
      ) : (
        <SectionCard title="Accepted by client">
          <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 3 }}>Name</Text>
          <TextInput
            style={styles.field}
            value={clientName}
            onChangeText={(t) => {
              dirty.current = true;
              setClientName(t);
            }}
            placeholder="Name of the person accepting the work"
            accessibilityLabel="Client name"
          />
          <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 3 }}>Contact details</Text>
          <TextInput
            style={styles.field}
            value={clientContact}
            onChangeText={(t) => {
              dirty.current = true;
              setClientContact(t);
            }}
            placeholder="Phone number or email"
            keyboardType="email-address"
            autoCapitalize="none"
            accessibilityLabel="Client contact details"
          />
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
            {capturedSignature
              ? 'Signature captured. Sign off completes the job and locks the card.'
              : 'Hand the phone to the client on the signature pad.'}
          </Text>
          {!capturedSignature ? (
            <Button
              title="Capture client signature"
              onPress={capture}
              disabled={!clientName.trim() || !clientContact.trim()}
            />
          ) : (
            <>
              <Button title="Sign off" onPress={() => void seal()} busy={busy} disabled={!canSeal} />
              <Button title="Re-capture signature" kind="secondary" onPress={capture} />
            </>
          )}
          {blockers.length > 0 ? (
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
              Still to do: {blockers.join(', ')}.
            </Text>
          ) : null}
          {!signedByTech ? (
            <Button title="Add my signature" kind="secondary" onPress={() => router.push('/profile')} />
          ) : null}
        </SectionCard>
      )}
    </FormScrollView>
  );
}
