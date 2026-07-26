import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, Image, Text, TextInput, View } from 'react-native';
import { useAuth } from '../src/auth/AuthContext';
import {
  MeasureRecord,
  MyTechnician,
  Whoami,
  addMeasure,
  getMyMeasures,
  getMyTechnician,
  getWhoami,
  listTechnicians,
  patchMyTechnician,
  setViewAs,
} from '../src/api/client';
import { syncAll } from '../src/sync/syncEngine';
import { CameraCaptureModal } from '../src/components/CameraCaptureModal';
import { Badge, Button, SectionCard, colors } from '../src/components/ui';
import { FormScrollView } from '../src/components/FormScrollView';
import { fetchThrough, readCache } from '../src/db/cache';
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
  // Certified measures register (#70): NO defaults — blank until the VO
  // registers their own certified measures. Adding one supersedes the old
  // measure of that size; history is kept forever.
  const [measures, setMeasures] = useState<MeasureRecord[]>([]);
  const [history, setHistory] = useState<MeasureRecord[]>([]);
  const [measurePhotos, setMeasurePhotos] = useState<Record<string, string>>({});
  const [photoTarget, setPhotoTarget] = useState<string | null>(null);
  // "Add certified measure" form.
  const [addSize, setAddSize] = useState<string | null>(null);
  const [addSerial, setAddSerial] = useState('');
  const [addCert, setAddCert] = useState('');
  const [addCalDate, setAddCalDate] = useState('');
  const [addExpiry, setAddExpiry] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  // Role + view-as (#71).
  const [whoami, setWhoami] = useState<Whoami | null>(null);
  const [techList, setTechList] = useState<{ staffCode: string; name: string | null }[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFilter, setPickerFilter] = useState('');
  const [switching, setSwitching] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getWhoami(accessToken)
        .then((w) => {
          if (cancelled) return;
          setWhoami(w);
          if (w.role) {
            listTechnicians(accessToken)
              .then((l) => !cancelled && setTechList(l ?? []))
              .catch(() => {});
          }
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, [accessToken]),
  );

  const switchViewAs = async (staffCode: string | null) => {
    setSwitching(true);
    try {
      const w = await setViewAs(accessToken, staffCode);
      setWhoami(w);
      setPickerOpen(false);
      setPickerFilter('');
      // Refresh the whole device mirror so every screen shows the new scope.
      await syncAll(accessToken);
      Alert.alert(
        'View updated',
        w.viewAsName
          ? `You are now viewing the app as ${w.viewAsName}.`
          : 'You are back to your own view.',
      );
    } catch (err) {
      Alert.alert('Could not switch view', err instanceof Error ? err.message : String(err));
    } finally {
      setSwitching(false);
    }
  };

  /** Mirror the active measures into the local store — the offline
   * verification gate reads it. */
  const mirrorMeasures = useCallback(
    (active: MeasureRecord[]) => {
      const p = getProfile(subject);
      saveProfile(subject, {
        ...p,
        measures: active.map((m) => ({
          size: m.size,
          serialNumber: m.serialNumber,
          certificateNumber: m.certificateNumber,
          calibrationDate: m.calibrationDate,
          expiryDate: m.expiryDate,
        })),
      });
    },
    [subject],
  );

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
        // Offline: last mirrored active measures + device photos.
        if (p.measures?.length) {
          setMeasures(p.measures.map((m) => ({ ...m, calibrationDate: m.calibrationDate ?? null })));
        }
        setMeasurePhotos(p.measurePhotos ?? {});
        setLoaded(true);
      }
      const fresh = readCache<string>(voSignatureCacheKey(subject));
      setSignatureSvg(fresh ?? p.signatureSvg ?? '');
    }, [subject, identity?.name, loaded]),
  );

  // The measures register (#70): server is the source of truth; the local
  // mirror updates whenever it loads.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      fetchThrough('measures:my', () => getMyMeasures(accessToken))
        .then(({ active, history: past }) => {
          if (cancelled) return;
          setMeasures(active);
          setHistory(past.filter((m) => m.status !== 'active'));
          mirrorMeasures(active);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, [accessToken, mirrorMeasures]),
  );

  // The technician register is the SOURCE OF TRUTH for the name (#63): it is
  // shown read-only and cached into the local store so offline certificate
  // printing and the Home greeting keep working. Offline keeps local values.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      fetchThrough('technician:me', () => getMyTechnician(accessToken))
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
    // Name comes from the technician register (#63); measures go through
    // the add-measure flow (#70) — only pliers and the signature save here.
    const p = getProfile(subject);
    saveProfile(subject, {
      ...p,
      firstName: firstName.trim() || p.firstName,
      lastName: lastName.trim() || p.lastName,
      displayName: `${firstName.trim()} ${lastName.trim()}`.trim() || p.displayName,
      pliersNumber: pliers.trim(),
      signatureSvg: signatureSvg || undefined,
    });
    if (registerEditable && pliers.trim()) {
      patchMyTechnician(accessToken, { pliersNumber: pliers.trim() }).catch(() => {});
    }
    Alert.alert('Profile saved', 'Your name, VO number and signature will be used on certificates you sign.');
    router.back();
  };

  const submitMeasure = async () => {
    if (!addSize) return;
    if (
      !addSerial.trim() ||
      !addCert.trim() ||
      !/^\d{4}-\d{2}-\d{2}$/.test(addCalDate) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(addExpiry)
    ) {
      Alert.alert(
        'Measure incomplete',
        'A certified measure needs its serial number, calibration certificate number, calibration date and expiry date (YYYY-MM-DD).',
      );
      return;
    }
    setAddBusy(true);
    try {
      const body = {
        size: addSize,
        serialNumber: addSerial.trim(),
        certificateNumber: addCert.trim(),
        calibrationDate: addCalDate,
        expiryDate: addExpiry,
      };
      await addMeasure(accessToken, body);
      // Optimistic local supersede — the next sync confirms from the server.
      const replaced = measures.find((m) => m.size === addSize);
      const active = [
        ...measures.filter((m) => m.size !== addSize),
        { ...body, status: 'active' },
      ].sort((a, b) => a.size.localeCompare(b.size));
      setMeasures(active);
      if (replaced) setHistory((h) => [{ ...replaced, status: 'superseded' }, ...h]);
      mirrorMeasures(active);
      setAddSize(null);
      setAddSerial('');
      setAddCert('');
      setAddCalDate('');
      setAddExpiry('');
    } catch (err) {
      Alert.alert('Could not register measure', err instanceof Error ? err.message : String(err));
    } finally {
      setAddBusy(false);
    }
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

      {whoami?.role ? (
        <SectionCard title={`View as (${whoami.role})`}>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 8 }}>
            See the app exactly as a technician does — their work orders, sites and insights.
            Read-only: you can never sign or edit records as them.
          </Text>
          <Badge
            text={whoami.viewAsName ? `Viewing as ${whoami.viewAsName}` : 'Viewing as yourself'}
            tone={whoami.viewAsName ? 'warn' : 'ok'}
          />
          {whoami.viewAsName ? (
            <Button
              title="Stop viewing as"
              kind="secondary"
              busy={switching}
              onPress={() => void switchViewAs(null)}
            />
          ) : null}
          <Button
            title={pickerOpen ? 'Close technician list' : 'Choose a technician…'}
            kind="secondary"
            onPress={() => setPickerOpen(!pickerOpen)}
          />
          <Button
            title="Certificate archive search"
            kind="secondary"
            onPress={() => router.push('/archive')}
          />
          {whoami.role === 'admin' ? (
            <Button
              title="Roles & team allocations"
              kind="secondary"
              onPress={() => router.push('/admin')}
            />
          ) : null}
          {pickerOpen ? (
            <View>
              <TextInput
                style={inputStyle}
                value={pickerFilter}
                onChangeText={setPickerFilter}
                placeholder="Search by name or staff code"
              />
              {techList
                .filter((t) => {
                  const q = pickerFilter.trim().toLowerCase();
                  if (!q) return true;
                  return (
                    (t.name ?? '').toLowerCase().includes(q) ||
                    t.staffCode.toLowerCase().includes(q)
                  );
                })
                .slice(0, 12)
                .map((t) => (
                  <Text
                    key={t.staffCode}
                    onPress={() => (switching ? undefined : void switchViewAs(t.staffCode))}
                    style={{
                      paddingVertical: 8,
                      borderTopWidth: 1,
                      borderColor: colors.line,
                      color: colors.blueText,
                      fontSize: 14,
                    }}
                  >
                    {t.name ?? t.staffCode}{' '}
                    <Text style={{ color: colors.muted, fontSize: 12 }}>({t.staffCode})</Text>
                  </Text>
                ))}
            </View>
          ) : null}
        </SectionCard>
      ) : null}

      <SectionCard title="My certified proving measures">
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 8 }}>
          Only certified equipment may be used. A verification cannot start until your 200L, 20L
          and 5L measures are registered and in date. Registering a new measure supersedes the old
          one — history is kept.
        </Text>
        {measures.length === 0 ? (
          <Badge text="No certified measures registered yet" tone="bad" />
        ) : null}
        {measures.map((m) => {
          const today = new Date().toISOString().slice(0, 10);
          const soon = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
          const expired = m.expiryDate < today;
          const dueSoon = !expired && m.expiryDate <= soon;
          const photo = measurePhotos[m.size];
          return (
            <View
              key={m.size}
              style={{ borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8, marginTop: 8 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                <Text style={{ fontWeight: '700', color: colors.ink, flex: 1 }}>
                  {m.size} · {m.serialNumber}
                </Text>
                <Badge
                  text={expired ? '✗ Expired' : dueSoon ? '⚠ Due soon' : '✓ In date'}
                  tone={expired ? 'bad' : dueSoon ? 'warn' : 'ok'}
                />
              </View>
              <Text style={{ fontSize: 12, color: colors.muted }}>
                Cert {m.certificateNumber}
                {m.calibrationDate ? ` · calibrated ${m.calibrationDate}` : ''} · expires{' '}
                {m.expiryDate}
              </Text>
              {photo ? (
                <Image
                  source={{ uri: photo }}
                  style={{ width: '100%', height: 120, borderRadius: 8, marginVertical: 8 }}
                  resizeMode="cover"
                />
              ) : null}
              <Button
                title={photo ? `Retake ${m.size} photo` : `Photograph ${m.size} measure`}
                kind="secondary"
                onPress={() => setPhotoTarget(m.size)}
              />
            </View>
          );
        })}

        {registerEditable ? (
          <View style={{ borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10, marginTop: 10 }}>
            <Text style={{ fontWeight: '700', color: colors.ink, marginBottom: 6 }}>
              Register a newly certified measure
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
              {['200L', '20L', '5L'].map((s) => (
                <View key={s} style={{ flex: 1 }}>
                  <Button
                    title={s}
                    kind={addSize === s ? 'primary' : 'secondary'}
                    onPress={() => setAddSize(addSize === s ? null : s)}
                  />
                </View>
              ))}
            </View>
            {addSize ? (
              <>
                <Text style={{ fontSize: 12, color: colors.muted }}>Serial number</Text>
                <TextInput
                  style={inputStyle}
                  value={addSerial}
                  onChangeText={setAddSerial}
                  autoCapitalize="characters"
                  placeholder="PRO-…"
                />
                <Text style={{ fontSize: 12, color: colors.muted }}>Calibration certificate no.</Text>
                <TextInput
                  style={inputStyle}
                  value={addCert}
                  onChangeText={setAddCert}
                  autoCapitalize="characters"
                />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, color: colors.muted }}>Cal. date (YYYY-MM-DD)</Text>
                    <TextInput
                      style={inputStyle}
                      value={addCalDate}
                      onChangeText={setAddCalDate}
                      placeholder="2026-03-19"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, color: colors.muted }}>Expiry (YYYY-MM-DD)</Text>
                    <TextInput
                      style={inputStyle}
                      value={addExpiry}
                      onChangeText={setAddExpiry}
                      placeholder="2027-03-19"
                    />
                  </View>
                </View>
                <Button
                  title={`Register ${addSize} measure${measures.some((m) => m.size === addSize) ? ' (supersedes current)' : ''}`}
                  onPress={() => void submitMeasure()}
                  busy={addBusy}
                />
              </>
            ) : null}
          </View>
        ) : (
          <Text style={{ fontSize: 12, color: colors.muted, marginTop: 8 }}>
            Demo account — the measures register is read-only.
          </Text>
        )}

        {history.length > 0 ? (
          <View style={{ borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10, marginTop: 10 }}>
            <Text style={{ fontWeight: '700', color: colors.ink, marginBottom: 4 }}>
              Measure history
            </Text>
            {history.map((m, i) => (
              <Text key={`${m.id ?? i}`} style={{ fontSize: 12, color: colors.muted, marginTop: 3 }}>
                {m.size} · {m.serialNumber} · cert {m.certificateNumber} · expired {m.expiryDate}
                {m.supersededAt ? ` · superseded ${m.supersededAt.slice(0, 10)}` : ''}
              </Text>
            ))}
          </View>
        ) : null}
      </SectionCard>

      <CameraCaptureModal
        visible={photoTarget !== null}
        title={photoTarget ? `${photoTarget} proving measure` : ''}
        fileStem={`measure-${photoTarget ?? 'x'}-${subject.slice(0, 8)}`}
        onClose={() => setPhotoTarget(null)}
        onCaptured={(uri) => {
          if (!photoTarget) return;
          const next = { ...measurePhotos, [photoTarget]: `${uri}?t=${Date.now()}` };
          setMeasurePhotos(next);
          const p = getProfile(subject);
          saveProfile(subject, { ...p, measurePhotos: next });
        }}
      />

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
