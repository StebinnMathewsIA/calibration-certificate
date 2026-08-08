/**
 * Job card capture and sign-off (#105). The end of a technician's job:
 * what was done, what it cost, and the client's signature accepting it.
 *
 * Two decisions worth knowing while reading this.
 *
 * EVERYTHING IS ENTERED PER VISIT (#121). Labour and travel belong to an
 * attendance on site, not to the job as a whole, because a job worked over
 * three visits is three lots of driving.
 *
 * DISTANCE IS ONE NUMBER PER VISIT (owner decision). It becomes two OnKey
 * lines, VEH_TECH and TRA_TECH, because that is how the real data is
 * booked: 127 of the 128 work orders carrying both had identical
 * quantities. Making the technician type it twice to satisfy somebody
 * else's data model would be the app serving OnKey rather than the person
 * on the forecourt.
 *
 * NOTHING IS PREFILLED FROM THE LIFECYCLE TIMER. It used to be, and the
 * first real job card printed one minute of measured time four lines above
 * four point two hours of charged labour, on the page the client signs.
 * The timer measures how long the app sat in a state.
 */
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  JobCardBundle,
  JobCardPart,
  JobCardVisit,
  StockItem,
  getJobCard,
  saveJobCard,
  searchStock,
  signJobCard,
  stockCount,
} from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { Badge, Button, SectionCard, colors, fonts } from '../../src/components/ui';
import { FormScrollView } from '../../src/components/FormScrollView';
import { readCache } from '../../src/db/cache';
import { JobCard } from '../../src/pdf/jobCardHtml';
import { renderJobCardPdf } from '../../src/pdf/renderPdf';
import { voSignatureCacheKey } from '../../src/profile/profileStore';

// StyleSheet.create, not a bare object: it types fontVariant as
// FontVariant[] rather than widening it to string[], which TextInput rejects.
const styles = StyleSheet.create({
  numField: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    color: colors.ink,
    backgroundColor: '#fff',
    fontSize: 16,
    fontVariant: ['tabular-nums'],
  },
});
const numField = styles.numField;

/** Bundle to printable document. Tasks are empty for now: OnKey's task
 * table is where they live and we do not sync it yet, and the template
 * already prints nothing rather than the 31 blank rows the original had. */
const toJobCard = (b: JobCardBundle): JobCard => ({
  workOrderCode: b.workOrderCode ?? '',
  siteCode: b.document.siteCode ?? '',
  siteName: b.siteName ?? '',
  siteAddress: b.document.siteAddress,
  sitePhone: b.document.sitePhone,
  oilCompany: b.document.oilCompany,
  assetCode: b.document.assetCode,
  assetDescription: b.document.assetDescription,
  importance: b.document.importance,
  requester: b.document.customerName,
  workRequired: b.workRequired,
  workPerformed: b.jobCard?.workPerformed ?? null,
  visits: b.jobCard?.visits ?? [],
  lines: b.document.lines,
  tasks: [],
  technicianName: b.document.technicianName ?? '',
  clientName: b.jobCard?.clientName ?? null,
  signedAt: b.jobCard?.signedAt ?? null,
});

/** A labelled number box. Separate component because a visit needs four of
 * them and inlining that made the row unreadable. */
function VisitField({
  label,
  value,
  editable,
  onChange,
  onBlur,
}: {
  label: string;
  value: number;
  editable: boolean;
  onChange: (raw: string) => void;
  onBlur: () => void;
}) {
  // Held as text while it is being typed: binding straight to the number
  // would turn "0." into "0" under the technician's finger.
  const [text, setText] = useState(value ? String(value) : '');
  React.useEffect(() => {
    setText(value ? String(value) : '');
  }, [value]);
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 3 }}>{label}</Text>
      <TextInput
        style={numField}
        value={text}
        onChangeText={(t) => {
          setText(t);
          onChange(t);
        }}
        onBlur={onBlur}
        editable={editable}
        keyboardType="decimal-pad"
        placeholder="0"
        accessibilityLabel={label}
      />
    </View>
  );
}

const blankVisit = (seq: number): JobCardVisit => ({
  date: new Date().toISOString().slice(0, 10),
  distanceKm: 0,
  labourHours: 0,
  labourOt15Hours: 0,
  labourOt20Hours: 0,
});

/** Empty means zero, not NaN. A technician clearing a field to retype it
 * must not produce a saved value of NaN. */
const toNum = (s: string): number => {
  const n = Number(String(s).replace(',', '.').trim());
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export default function JobCardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { accessToken, identity } = useAuth();

  const [bundle, setBundle] = useState<JobCardBundle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [visits, setVisits] = useState<JobCardVisit[]>([]);
  const [parts, setParts] = useState<JobCardPart[]>([]);
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<StockItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [partCount, setPartCount] = useState<number | null>(null);
  const [performed, setPerformed] = useState('');
  const [clientName, setClientName] = useState('');
  const [busy, setBusy] = useState(false);
  // Set the moment the technician edits anything. A background refresh may
  // update the header (signed, lifecycle) at any time, but it must never
  // reach into fields somebody is typing into. A ref, not state: it must not
  // re-run the focus effect and refetch on the first keystroke.
  const dirty = React.useRef(false);
  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    dirty.current = true;
    set(v);
  };

  const setVisitField = (index: number, key: keyof JobCardVisit, raw: string) => {
    dirty.current = true;
    setVisits((prev) =>
      prev.map((v, i) => (i === index ? { ...v, [key]: toNum(raw) } : v)),
    );
  };

  const total = (key: keyof JobCardVisit): string => {
    const n = visits.reduce((sum, v) => sum + (Number(v[key]) || 0), 0);
    return n % 1 ? n.toFixed(1) : String(n);
  };

  const seedFields = useCallback((b: JobCardBundle) => {
    const jc = b.jobCard;
    // One empty visit to start, because a job card with no visit has
    // nowhere to type. NOT prefilled from the lifecycle timer: that is
    // what printed one minute of measured time next to four hours of
    // charged labour (#121).
    setVisits(jc?.visits?.length ? jc.visits : [blankVisit(1)]);
    setParts(jc?.parts ?? []);
    setPerformed(jc?.workPerformed ?? '');
    setClientName(jc?.clientName ?? '');
  }, []);

  const load = useCallback(() => {
    getJobCard(accessToken, String(id), {
      // The cached copy renders instantly; when the network answers with
      // something different the header follows it, and the fields only if
      // they are still untouched.
      onFresh: (fresh) => {
        setBundle(fresh);
        if (!dirty.current) seedFields(fresh);
      },
    })
      .then((b) => {
        setBundle(b);
        if (!dirty.current) seedFields(b);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, [accessToken, id, seedFields]);

  useFocusEffect(useCallback(() => load(), [load]));

  // The register loads with nothing typed, so the field is a PICK LIST and
  // not a guessing game (#119). Debounced because a technician types a code
  // one character at a time and every keystroke would otherwise be a round
  // trip over forecourt signal.
  React.useEffect(() => {
    const q = search.trim();
    setSearching(true);
    let live = true;
    const timer = setTimeout(
      () => {
        searchStock(accessToken, q)
          .then((r) => live && setHits(r))
          .catch(() => live && setHits([]))
          .finally(() => live && setSearching(false));
      },
      q ? 250 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [search, accessToken]);

  React.useEffect(() => {
    stockCount(accessToken)
      .then(setPartCount)
      .catch(() => {});
  }, [accessToken]);

  type SaveBody = Parameters<typeof saveJobCard>[2];

  const persist = useCallback(
    (over: Partial<SaveBody> = {}) => {
      void saveJobCard(accessToken, String(id), {
        visits,
        parts,
        workPerformed: performed,
        ...over,
      }).catch(() => {});
    },
    [accessToken, id, visits, parts, performed],
  );

  if (loadError) {
    return (
      <FormScrollView>
        <SectionCard title="Could not open the job card">
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

  // Capturing a signature and sealing the job card are DIFFERENT ACTS and
  // used to share one condition (#118). Capturing is collecting evidence
  // while the client is standing in front of you; sealing is finishing the
  // job. Requiring the work to be stopped before the client could sign
  // meant a technician who paused for spares and left site could never get
  // a signature at all, because by the time the job stops the client is
  // long gone. The original OnKey card asks for a signature confirming
  // ARRIVAL, so this was never an end-of-job act.
  const started = bundle.lifecycleState !== 'not_started' && bundle.lifecycleState !== 'on_the_way';
  const canCapture =
    !signed && started && performed.trim().length > 0 && clientName.trim().length > 0;
  // Sealing still requires the work to be stopped. That gate is correct.
  const canSign = canCapture && bundle.lifecycleState === 'stopped' && !!capturedSignature;

  /** Only what is actually missing. Listing all three conditions when two
   * are met reads as if nothing has been done. */
  const blockers: string[] = [];
  if (!started) blockers.push('start the job');
  if (!performed.trim()) blockers.push('describe the work performed');
  if (!clientName.trim()) blockers.push("enter the client's name");
  if (canCapture && !capturedSignature) blockers.push('capture the signature');
  else if (canCapture && bundle.lifecycleState !== 'stopped') blockers.push('stop the work');

  /** Adding the same part twice bumps the quantity rather than making a
   * second line: two lines for one item is a costing sheet nobody can
   * check against the van. */
  const addPart = (hit: StockItem) => {
    dirty.current = true;
    const at = parts.findIndex((p) => p.itemCode === hit.itemCode);
    const next =
      at >= 0
        ? parts.map((p, i) => (i === at ? { ...p, quantity: p.quantity + 1 } : p))
        : [
            ...parts,
            {
              itemCode: hit.itemCode,
              description: hit.description ?? hit.itemCode,
              quantity: 1,
              unit: hit.unit,
            },
          ];
    setParts(next);
    setSearch('');
    setHits([]);
    persist({ parts: next });
  };

  const setPartQuantity = (index: number, raw: string) => {
    setParts((prev) => prev.map((p, i) => (i === index ? { ...p, quantity: toNum(raw) } : p)));
  };

  /** The same full-screen locked window the verification certificate uses:
   * no swipe-to-dismiss and no back button, so a downward stroke cannot
   * close it mid-signature. The drawing lands in the cache under a job-card
   * key so it never mixes with the VO's own saved signature. */
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

  const sign = async () => {
    const clientSig = readCache<string>(`jobcard-sign:${id}`);
    if (!clientSig) {
      capture();
      return;
    }
    setBusy(true);
    try {
      await signJobCard(accessToken, String(id), {
        clientName: clientName.trim(),
        clientSignature: clientSig,
        techSignature: readCache<string>(voSignatureCacheKey(identity?.subject ?? '')) ?? undefined,
      });
      Alert.alert('Job card signed', 'The work order has been signed off.');
      router.back();
    } catch (err) {
      Alert.alert('Could not sign', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /** The signed document, rendered on-device and handed to the client. The
   * costing lines come from the server, built by the same function that
   * queues them to OnKey, so the client is shown what is actually booked. */
  const share = async () => {
    if (!bundle) return;
    setBusy(true);
    try {
      const { uri } = await renderJobCardPdf(toJobCard(bundle), {
        customerSignatureSvg: bundle.jobCard?.clientSignature ?? undefined,
        technicianSignatureSvg: bundle.jobCard?.techSignature ?? undefined,
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
      } else {
        Alert.alert('Job card ready', uri);
      }
    } catch (err) {
      Alert.alert('Could not build the job card', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormScrollView>
      <SectionCard title={bundle.workOrderCode ?? 'Job card'}>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{bundle.siteName}</Text>
        {signed ? (
          <View style={{ marginTop: 6 }}>
            <Badge text="Signed" tone="ok" />
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
              Signed by {bundle.jobCard?.clientName} on{' '}
              {bundle.jobCard?.signedAt?.slice(0, 16).replace('T', ' ')}. A signed job card
              cannot be changed.
            </Text>
            <Button title="Job card document" onPress={() => void share()} busy={busy} />
          </View>
        ) : bundle.lifecycleState !== 'stopped' ? (
          <Text style={{ color: colors.amber, fontSize: 12, marginTop: 6 }}>
            Stop the job before signing it off. You can fill this in now and sign later.
          </Text>
        ) : null}
      </SectionCard>

      <SectionCard title="Visits">
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 8 }}>
          One row per attendance on site. Travel is entered once per visit and booked to
          OnKey as both vehicle and travel.
        </Text>
        {visits.map((v, i) => (
          <View
            key={i}
            style={{
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: colors.line,
              paddingTop: i === 0 ? 0 : 10,
              marginBottom: 10,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
              <Text style={{ flex: 1, color: colors.ink, fontSize: 13, fontFamily: fonts.bodyMedium }}>
                Visit {i + 1}
                {v.date ? `  ${v.date}` : ''}
              </Text>
              {!signed && visits.length > 1 ? (
                <Text
                  onPress={() => {
                    const next = visits.filter((_, j) => j !== i);
                    setVisits(next);
                    persist({ visits: next });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove visit ${i + 1}`}
                  style={{ color: colors.red, fontSize: 13, paddingHorizontal: 6 }}
                >
                  &#10007;
                </Text>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <VisitField
                label="Travel km"
                value={v.distanceKm}
                editable={!signed}
                onChange={(n) => setVisitField(i, 'distanceKm', n)}
                onBlur={() => persist()}
              />
              <VisitField
                label="Labour hrs"
                value={v.labourHours}
                editable={!signed}
                onChange={(n) => setVisitField(i, 'labourHours', n)}
                onBlur={() => persist()}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <VisitField
                label="1.5 OT hrs"
                value={v.labourOt15Hours}
                editable={!signed}
                onChange={(n) => setVisitField(i, 'labourOt15Hours', n)}
                onBlur={() => persist()}
              />
              <VisitField
                label="2.0 OT hrs"
                value={v.labourOt20Hours}
                editable={!signed}
                onChange={(n) => setVisitField(i, 'labourOt20Hours', n)}
                onBlur={() => persist()}
              />
            </View>
          </View>
        ))}
        {!signed ? (
          <Button
            title="Add a visit"
            kind="secondary"
            onPress={() => {
              const next = [...visits, blankVisit(visits.length + 1)];
              setVisits(next);
              persist({ visits: next });
            }}
          />
        ) : null}
        {visits.length > 1 ? (
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>
            Total {total('distanceKm')} km, {total('labourHours')} hrs
            {total('labourOt15Hours') ? `, ${total('labourOt15Hours')} hrs at 1.5` : ''}
            {total('labourOt20Hours') ? `, ${total('labourOt20Hours')} hrs at 2.0` : ''}.
          </Text>
        ) : null}
      </SectionCard>

      <SectionCard title="Parts used">
        {parts.map((p, i) => (
          <View
            key={`${p.itemCode}-${i}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.ink, fontSize: 13, fontFamily: fonts.mono }}>
                {p.itemCode}
              </Text>
              {p.description && p.description !== p.itemCode ? (
                <Text style={{ color: colors.muted, fontSize: 11 }}>{p.description}</Text>
              ) : null}
            </View>
            {signed ? (
              <Text style={{ color: colors.ink, fontSize: 13 }}>
                {p.quantity} {p.unit}
              </Text>
            ) : (
              <>
                {/* Quantity is editable in place. A technician who fitted
                    two of something should not have to remove the line and
                    find the part again. */}
                <TextInput
                  style={[numField, { width: 64, textAlign: 'right' }]}
                  value={String(p.quantity)}
                  onChangeText={touch((v: string) => setPartQuantity(i, v))}
                  onBlur={() => persist({ parts })}
                  keyboardType="decimal-pad"
                  accessibilityLabel={`Quantity of ${p.itemCode}`}
                />
                <Text style={{ color: colors.muted, fontSize: 11, width: 22 }}>{p.unit}</Text>
                <Text
                  onPress={() => {
                    const next = parts.filter((_, j) => j !== i);
                    setParts(next);
                    persist({ parts: next });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${p.itemCode}`}
                  style={{ color: colors.red, fontSize: 13, paddingHorizontal: 6 }}
                >
                  &#10007;
                </Text>
              </>
            )}
          </View>
        ))}
        {parts.length === 0 ? (
          <Text style={{ color: colors.muted, fontSize: 12 }}>No parts used.</Text>
        ) : null}
        {!signed ? (
          <View style={{ marginTop: 8 }}>
            <TextInput
              style={numField}
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
              placeholder="Search a part by code or name"
              accessibilityLabel="Search parts"
            />
            {searching ? (
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>Searching…</Text>
            ) : (
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
                {search.trim()
                  ? `${hits.length} of ${partCount ?? '?'} parts`
                  : `${partCount ?? hits.length} parts, most carried first`}
              </Text>
            )}
            {/* Capped height so the list scrolls inside the card instead of
                pushing the sign-off block off the screen. */}
            <ScrollView style={{ maxHeight: 260 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {hits.map((h) => (
              <Text
                key={h.itemCode}
                onPress={() => addPart(h)}
                accessibilityRole="button"
                accessibilityLabel={`Add ${h.itemCode} ${h.description ?? ''}`}
                style={{
                  color: colors.ink,
                  fontSize: 13,
                  paddingVertical: 7,
                  borderTopWidth: 1,
                  borderTopColor: colors.line,
                }}
              >
                <Text style={{ fontFamily: fonts.mono }}>{h.itemCode}</Text>
                {'  '}
                {h.description}
                {h.vanCount > 0 ? (
                  <Text style={{ color: colors.muted, fontSize: 11 }}>
                    {'  '}on {h.vanCount} {h.vanCount === 1 ? 'van' : 'vans'}
                  </Text>
                ) : null}
              </Text>
            ))}
            </ScrollView>
            {!searching && hits.length === 0 ? (
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>
                {search.trim()
                  ? `No match in ${partCount ?? 'the'} parts. Parts come from the stock register, so a code that is not listed cannot be booked to the work order.`
                  : 'The parts register is empty on this device. Reconnect once to load it.'}
              </Text>
            ) : null}
          </View>
        ) : null}
      </SectionCard>

      <SectionCard title="Work performed">
        <TextInput
          style={{
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: 10,
            padding: 10,
            minHeight: 110,
            color: colors.ink,
            backgroundColor: '#fff',
            fontSize: 14,
          }}
          multiline
          textAlignVertical="top"
          value={performed}
          onChangeText={touch(setPerformed)}
          onBlur={() => persist()}
          editable={!signed}
          placeholder="What you did on site, in the client's words as much as your own."
          accessibilityLabel="Work performed"
        />
      </SectionCard>

      {!signed ? (
        <SectionCard title="Accepted by client">
          <TextInput
            style={numField}
            value={clientName}
            onChangeText={touch(setClientName)}
            placeholder="Name of the person accepting the work"
            accessibilityLabel="Client name"
          />
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 8 }}>
            {capturedSignature
              ? 'Signature captured. It stays with the job card until you sign off.'
              : 'Hand the phone to the client on the signature pad.'}
          </Text>
          {/* Two buttons, because they are two acts. The client can sign
              while you are still on site; sealing waits for the work to
              stop. */}
          {!capturedSignature ? (
            <Button
              title="Capture client signature"
              onPress={() => void capture()}
              disabled={!canCapture}
            />
          ) : (
            <>
              <Button title="Sign off" onPress={() => void sign()} busy={busy} disabled={!canSign} />
              <Button
                title="Re-capture signature"
                kind="secondary"
                onPress={() => void capture()}
                disabled={!canCapture}
              />
            </>
          )}
          {blockers.length > 0 ? (
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
              Still to do: {blockers.join(', ')}.
            </Text>
          ) : null}
        </SectionCard>
      ) : null}
    </FormScrollView>
  );
}
