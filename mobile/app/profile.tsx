import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, Image, Pressable, Text, TextInput, View } from 'react-native';
import Svg, { Path, SvgXml } from 'react-native-svg';
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
  TechnicianOption,
  patchMyTechnician,
  setViewAs,
} from '../src/api/client';
import { syncAll } from '../src/sync/syncEngine';
import { CameraCaptureModal } from '../src/components/CameraCaptureModal';
import { Badge, Button, DateInput, SectionCard, colors, fonts } from '../src/components/ui';
import { FormScrollView } from '../src/components/FormScrollView';
import { fetchThrough, readCache, writeCache } from '../src/db/cache';
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
  // The expiry the form filled automatically (#196): user edits win, but
  // re-picking the calibration date re-derives an untouched expiry.
  const autoExpiry = React.useRef('');

  const yearAfter = (iso: string): string => {
    const [y, m, d] = iso.split('-').map(Number);
    const next = new Date(y + 1, m - 1, d);
    if (next.getMonth() !== m - 1) next.setDate(0); // 29 Feb -> 28 Feb
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
  };

  const onCalDatePicked = (iso: string) => {
    setAddCalDate(iso);
    const derived = yearAfter(iso);
    if (!addExpiry || addExpiry === autoExpiry.current) setAddExpiry(derived);
    autoExpiry.current = derived;
  };
  // Role + view-as (#71).
  const [whoami, setWhoami] = useState<Whoami | null>(null);
  const [techList, setTechList] = useState<TechnicianOption[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFilter, setPickerFilter] = useState('');
  const [switching, setSwitching] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      // Through the cache (#84): a transient network failure must not hide
      // the whole roles section from a role holder.
      fetchThrough('whoami:me', () => getWhoami(accessToken))
        .then((w) => {
          if (cancelled) return;
          setWhoami(w);
          if (w.role) {
            // onFresh, or the picker shows the order and counts from the
            // LAST visit: the cached copy paints instantly and the
            // revalidated one would otherwise only reach the cache. This
            // list changes whenever work is allocated, so a visit-old copy
            // is routinely wrong.
            fetchThrough('technicians:list', () => listTechnicians(accessToken), {
              onFresh: (l) => !cancelled && setTechList(l ?? []),
            })
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

  /** Apply a technician-register response to the screen state. Names only
   * persist to the local store for an editable (own) record, so viewing as
   * someone never overwrites the role holder's own identity. */
  const applyTech = useCallback(
    (res: { technician: MyTechnician; editable: boolean } | null) => {
      if (!res?.technician) {
        setTechnician(null);
        setRegisterEditable(false);
        return;
      }
      const { technician: tech, editable } = res;
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
        if (editable) {
          const p = getProfile(subject);
          saveProfile(subject, {
            ...p,
            firstName: first || undefined,
            lastName: last || undefined,
            displayName: `${first} ${last}`.trim() || p.displayName,
          });
        }
      }
      const p = getProfile(subject);
      if (!p.pliersNumber && tech.pliersNumber) setPliers(tech.pliersNumber);
    },
    [subject],
  );

  const switchViewAs = async (staffCode: string | null) => {
    setSwitching(true);
    try {
      const w = await setViewAs(accessToken, staffCode);
      setWhoami(w);
      writeCache('whoami:me', w);
      if (!w.viewAsName && identity?.name) {
        const words = identity.name.split(/\s+/).filter((t) => t && !t.includes('@'));
        const f = words.slice(0, -1).join(' ');
        const l = words.length > 0 ? words[words.length - 1] : '';
        setFirstName(f);
        setLastName(l);
        const p = getProfile(subject);
        saveProfile(subject, {
          ...p,
          firstName: f || undefined,
          lastName: l || undefined,
          displayName: identity.name,
        });
      }
      setPickerOpen(false);
      setPickerFilter('');
      // Refresh the whole device mirror so every screen shows the new scope.
      await syncAll(accessToken);
      // The mirror is fresh now: re-apply the technician record and measures
      // ON SCREEN too (#77) instead of leaving the pre-switch values up.
      applyTech(
        readCache<{ technician: MyTechnician; editable: boolean } | null>('technician:me'),
      );
      const mm = readCache<{ active: MeasureRecord[]; history: MeasureRecord[] }>('measures:my');
      if (mm) {
        setMeasures(mm.active);
        setHistory(mm.history.filter((m) => m.status !== 'active'));
      }
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
        .then((res) => {
          if (!cancelled) applyTech(res);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, [accessToken, applyTech]),
  );

  const onCertificate = certificateName(
    { firstName, lastName },
    identity?.name ?? '',
  );

  // An admin actively viewing as a technician registers measures FOR that
  // technician (#79); managers and demo accounts stay read-only.
  const riding = Boolean(whoami?.viewAsStaffCode);
  const canRegisterMeasures = registerEditable || (whoami?.role === 'admin' && riding);

  const save = () => {
    // Name comes from the technician register (#63); measures go through
    // the add-measure flow (#70): only pliers and the signature save here.
    // While viewing as someone the on-screen name is theirs, so it must
    // never persist into the role holder's own local profile (#77).
    const p = getProfile(subject);
    saveProfile(subject, {
      ...p,
      firstName: riding ? p.firstName : firstName.trim() || p.firstName,
      lastName: riding ? p.lastName : lastName.trim() || p.lastName,
      displayName: riding
        ? p.displayName
        : `${firstName.trim()} ${lastName.trim()}`.trim() || p.displayName,
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
        'A certified measure needs its serial number, calibration certificate number, calibration date and expiry date.',
      );
      return;
    }
    // The dates must make sense before they gate signing (#196).
    const today = new Date().toISOString().slice(0, 10);
    if (addCalDate > today) {
      Alert.alert('Check the calibration date', 'The calibration date cannot be in the future.');
      return;
    }
    if (addExpiry <= addCalDate) {
      Alert.alert('Check the expiry date', 'The expiry date must be after the calibration date.');
      return;
    }
    if (addExpiry <= today) {
      Alert.alert(
        'This measure is already expired',
        `The expiry date ${addExpiry} is not in the future. Only in-date measures can gate verifications; check the lab certificate.`,
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
            'No name on record yet: it comes from the technician register'}
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
            {!registerEditable
              ? riding
                ? '\nRead-only: you are viewing this technician'
                : '\nRead-only for this account'
              : ''}
          </Text>
        ) : null}
      </SectionCard>

      {whoami?.role ? (
        <SectionCard title={`Work as (${whoami.role})`}>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 8 }}>
            Step into a technician's world: their work orders, sites, job cards and insights.
            Anything you do there is recorded under your own name in the audit trail.
          </Text>
          <Badge
            text={whoami.viewAsName ? `Working as ${whoami.viewAsName}` : 'Working as yourself'}
            tone={whoami.viewAsName ? 'warn' : 'ok'}
          />
          {whoami.viewAsName ? (
            <Button
              title="Stop working as"
              kind="secondary"
              busy={switching}
              onPress={() => void switchViewAs(null)}
            />
          ) : null}
          <Button
            title={pickerOpen ? 'Close technician list' : 'Choose a technician…'}
            kind="secondary"
            onPress={() => {
              const opening = !pickerOpen;
              setPickerOpen(opening);
              // Opening the picker is the moment the order and the counts
              // matter, so go to the network rather than trusting cache.
              if (opening) {
                fetchThrough('technicians:list', () => listTechnicians(accessToken), {
                  force: true,
                })
                  .then((l) => setTechList(l ?? []))
                  .catch(() => {});
              }
            }}
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
                  <View
                    key={t.staffCode}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                      paddingVertical: 8,
                      borderTopWidth: 1,
                      borderColor: colors.line,
                    }}
                  >
                    <Text
                      onPress={() => (switching ? undefined : void switchViewAs(t.staffCode))}
                      style={{ flex: 1, color: colors.blueText, fontSize: 14 }}
                    >
                      {t.name ?? t.staffCode}{' '}
                      <Text style={{ color: colors.muted, fontSize: 12 }}>({t.staffCode})</Text>
                    </Text>
                    {/* The counts are why the list is in this order; without
                        them the ordering looks arbitrary. Defaulted because a
                        device may still hold a cached list from before these
                        fields existed. */}
                    {(t.testWorkOrders ?? 0) > 0 ? (
                      <Badge
                        text={
                          (t.writableTestWorkOrders ?? 0) > 0
                            ? `${t.writableTestWorkOrders} test, writable`
                            : `${t.testWorkOrders} test, read only`
                        }
                        tone={(t.writableTestWorkOrders ?? 0) > 0 ? 'ok' : 'muted'}
                      />
                    ) : null}
                    <Text
                      style={{
                        color: (t.openWorkOrders ?? 0) > 0 ? colors.ink : colors.muted,
                        fontSize: 12,
                        fontWeight: (t.openWorkOrders ?? 0) > 0 ? '700' : '400',
                        fontVariant: ['tabular-nums'],
                      }}
                    >
                      {t.openWorkOrders ?? 0} open
                    </Text>
                  </View>
                ))}
            </View>
          ) : null}
        </SectionCard>
      ) : null}

      <SectionCard title="My certified proving measures">
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 8 }}>
          Only certified equipment may be used. A verification cannot start until the 200L, 20L
          and 5L measures are registered and in date. Registering a new measure supersedes the
          old one; history is kept.
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

        {canRegisterMeasures ? (
          <View style={{ borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10, marginTop: 10 }}>
            <Text style={{ fontWeight: '700', color: colors.ink, marginBottom: 6 }}>
              Register a newly certified measure
            </Text>
            {!registerEditable && whoami?.viewAsName ? (
              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 6 }}>
                As admin, this registers the measure for {whoami.viewAsName}.
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
              {['200L', '20L', '5L'].map((s) => {
                // Status on the chip (#196): the register reads at a glance.
                const m = measures.find((x) => x.size === s);
                const today = new Date().toISOString().slice(0, 10);
                const days = m
                  ? Math.floor(
                      (new Date(`${m.expiryDate}T00:00:00`).getTime() -
                        new Date(`${today}T00:00:00`).getTime()) /
                        86400000,
                    )
                  : null;
                const status = !m
                  ? { text: 'not registered', color: colors.muted }
                  : days! < 0
                    ? { text: 'expired', color: colors.red }
                    : days! <= 30
                      ? { text: `${days} d left`, color: colors.amber }
                      : { text: `${days} d`, color: colors.muted };
                const sel = addSize === s;
                return (
                  <Pressable
                    key={s}
                    onPress={() => setAddSize(sel ? null : s)}
                    accessibilityRole="button"
                    accessibilityLabel={`${s} measure, ${status.text}`}
                    style={{
                      flex: 1,
                      borderWidth: 1.5,
                      borderColor: sel ? colors.green : colors.line,
                      backgroundColor: sel ? colors.green : '#fff',
                      borderRadius: 12,
                      paddingVertical: 8,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ fontFamily: fonts.heading, fontSize: 15, color: sel ? colors.navy : colors.ink }}>
                      {s}
                    </Text>
                    <Text style={{ fontSize: 10.5, color: sel ? colors.navy : status.color, marginTop: 1 }}>
                      {status.text}
                    </Text>
                  </Pressable>
                );
              })}
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
                    <Text style={{ fontSize: 12, color: colors.muted }}>Calibration date</Text>
                    <DateInput
                      value={addCalDate}
                      onChange={onCalDatePicked}
                      maximumDate={new Date()}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, color: colors.muted }}>
                      Expiry date{addExpiry && addExpiry === autoExpiry.current ? ' (1 year later)' : ''}
                    </Text>
                    <DateInput
                      value={addExpiry}
                      onChange={setAddExpiry}
                      minimumDate={
                        /^\d{4}-\d{2}-\d{2}$/.test(addCalDate)
                          ? new Date(`${addCalDate}T00:00:00`)
                          : undefined
                      }
                    />
                  </View>
                </View>
                {measures.some((m) => m.size === addSize) ? (
                  <Text style={{ fontSize: 12, color: colors.amber, marginTop: 6, marginBottom: 2 }}>
                    Registering this retires the current {addSize} measure{' '}
                    {measures.find((m) => m.size === addSize)?.serialNumber}. Its history is kept.
                  </Text>
                ) : null}
                <Button
                  title={`Register ${addSize} measure`}
                  onPress={() => void submitMeasure()}
                  busy={addBusy}
                />
              </>
            ) : null}
          </View>
        ) : (
          <Text style={{ fontSize: 12, color: colors.muted, marginTop: 8 }}>
            {riding
              ? 'The measures register is read-only while viewing as a technician (admins can register on their behalf).'
              : 'The measures register is read-only for this account.'}
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
        {signatureSvg ? (
          // The signature itself, with the edit pencil at its top right
          // (#198): what prints on certificates is what the card shows.
          <View
            style={{
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: 12,
              backgroundColor: '#fff',
              padding: 8,
              marginBottom: 8,
            }}
          >
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/signature',
                  params: {
                    cacheKey: voSignatureCacheKey(subject),
                    title: 'Your signature',
                    hint: 'Sign in the box below. This becomes your VO signature on certificates.',
                  },
                })
              }
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Update my signature"
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                zIndex: 1,
                width: 34,
                height: 34,
                borderRadius: 999,
                backgroundColor: colors.bg,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M4 20l1.2-4.2L16.6 4.4a2.05 2.05 0 012.9 2.9L8.2 18.8 4 20z"
                  stroke={colors.navy}
                  strokeWidth={2}
                  strokeLinejoin="round"
                />
              </Svg>
            </Pressable>
            <SvgXml xml={signatureSvg} width="100%" height={90} />
          </View>
        ) : (
          <>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 8 }}>
              Draw your signature once. It is saved on this device and embedded into every
              certificate you sign, so the VO signature looks like yours.
            </Text>
            <Badge text="No signature yet" tone="warn" />
            <Button
              title="Add my signature"
              kind="secondary"
              onPress={() =>
                router.push({
                  pathname: '/signature',
                  params: {
                    cacheKey: voSignatureCacheKey(subject),
                    title: 'Your signature',
                    hint: 'Sign in the box below. This becomes your VO signature on certificates.',
                  },
                })
              }
            />
          </>
        )}
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
