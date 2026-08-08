/**
 * OnKey Edge Function (#105): the ONE place OnKey I/O happens once the
 * read pipeline ports. Shared-secret protected (pg_cron and admin tools
 * call it; JWT verification is off for this endpoint, so the secret IS
 * the auth).
 *
 * Actions:
 *   smoke       Logon + LogOff only. The first call ever made.
 *   introspect  Fetch a service WSDL and summarize operations (tests
 *               whether Supabase egress reaches DocumentLinkImport).
 *   export      Run an Analyser Report, persist rows content-hashed.
 *   drain       Translate pending domain events to OnKey imports.
 *               DRY-RUN by default: logs the exact envelope, sends
 *               nothing. Allowlist-enforced in every mode.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { OnKeyClient, OnKeyFault, type OnKeyCreds } from './soap.ts';

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

function creds(): OnKeyCreds {
  const baseUrl = Deno.env.get('ONKEY_BASE_URL') ?? '';
  const username = Deno.env.get('ONKEY_USERNAME') ?? '';
  const password = Deno.env.get('ONKEY_PASSWORD') ?? '';
  // Matches the backend default (config.py onkey_connection). The SOAP
  // Logon puts this in ConnectionName; an empty one is rejected.
  const connection = Deno.env.get('ONKEY_CONNECTION') ?? 'ONKEY';
  if (!baseUrl || !username || !password) {
    throw new Error(
      'OnKey credentials are not configured: set ONKEY_BASE_URL, ONKEY_USERNAME, ONKEY_PASSWORD, ONKEY_CONNECTION as Edge Function secrets',
    );
  }
  return { baseUrl, username, password, connection };
}

async function config<T>(key: string, fallback: T): Promise<T> {
  const { data } = await db.from('onkey_config').select('value').eq('key', key).maybeSingle();
  return (data?.value ?? fallback) as T;
}

async function startRun(kind: string, detail: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await db
    .from('onkey_sync_runs')
    .insert({ run_kind: kind, detail })
    .select('id')
    .single();
  // Do NOT swallow this. A discarded error here surfaces later as
  // "cannot read properties of null", which says nothing about the
  // actual cause (RLS, a missing grant, a wrong key).
  if (error || !data) {
    throw new Error(
      `could not open a sync run: ${error?.message ?? 'no row returned'}` +
        (error?.hint ? ` (hint: ${error.hint})` : '') +
        (error?.code ? ` [${error.code}]` : ''),
    );
  }
  return data.id as string;
}

async function finishRun(id: string, patch: Record<string, unknown>): Promise<void> {
  await db.from('onkey_sync_runs').update({ finished_at: new Date().toISOString(), ...patch }).eq('id', id);
}

async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Deterministic hash over a row: the dedupe key for snapshots. */
async function rowHash(row: Record<string, string>): Promise<string> {
  const ordered = Object.keys(row).sort().map((k) => [k, row[k]]);
  return await sha256Hex(JSON.stringify(ordered));
}

async function handleSmoke(): Promise<Response> {
  const runId = await startRun('smoke');
  const client = new OnKeyClient(creds());
  try {
    const sessionId = await client.logon();
    await client.logOff();
    await finishRun(runId, { state: 'succeeded', detail: { sessionIdLength: sessionId.length } });
    return json({ ok: true, message: 'Logon and LogOff succeeded' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishRun(runId, { state: 'failed', error: message });
    return json({ ok: false, error: message, code: err instanceof OnKeyFault ? err.code : null }, 502);
  } finally {
    await client.logOff();
  }
}

async function handleIntrospect(service: string): Promise<Response> {
  const runId = await startRun('introspect', { service });
  try {
    // ?singleWsdl inlines every imported schema into one document. For
    // the larger services that response is big enough that the server
    // abandons the HTTP/2 stream mid-flight ("stream no longer needed"),
    // which is why DocumentLinkImport has never been introspected from
    // anywhere. ?wsdl returns a much smaller root that still carries the
    // service, ports, bindings and operations, which is what we read.
    const base = `${creds().baseUrl.replace(/\/$/, '')}/${service}.svc`;
    const attempts = [`${base}?singleWsdl`, `${base}?wsdl`];
    let url = '';
    let wsdl = '';
    let res: Response | null = null;
    const failures: string[] = [];
    for (const candidate of attempts) {
      try {
        const r = await fetch(candidate);
        const text = await r.text();
        if (text.length > 0) {
          url = candidate;
          wsdl = text;
          res = r;
          break;
        }
        // 200 with an empty body means the .svc does not exist: WCF
        // answers unknown services that way rather than with a 404.
        failures.push(`${candidate}: HTTP ${r.status}, empty body`);
      } catch (err) {
        failures.push(`${candidate}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (!wsdl) throw new Error(`could not fetch a WSDL. ${failures.join(' | ')}`);
    const operations = [...new Set([...wsdl.matchAll(/<wsdl:operation name="([^"]+)"/g)].map((m) => m[1]))];
    // Which SOAP version the endpoint speaks. A WCF .svc served over
    // wsHttpBinding is SOAP 1.2 (application/soap+xml, action in the
    // content-type); basicHttpBinding is SOAP 1.1 (text/xml plus a
    // SOAPAction header). Sending the wrong one returns a bare HTTP 415
    // with no clue as to why, so read it from the WSDL rather than guess.
    const soapVersions: string[] = [];
    if (wsdl.includes('http://schemas.xmlsoap.org/wsdl/soap12/')) soapVersions.push('1.2');
    if (wsdl.includes('http://schemas.xmlsoap.org/wsdl/soap/')) soapVersions.push('1.1');
    const bindings = [...new Set([...wsdl.matchAll(/<wsdl:binding name="([^"]+)"/g)].map((m) => m[1]))];
    // WCF publishes each binding at its OWN address. Posting a SOAP 1.1
    // envelope to the 1.2 endpoint is exactly the HTTP 415 we hit, so the
    // port-to-address map is the thing that actually tells us where to
    // send. Ports are matched with their following address element.
    const ports = [
      ...wsdl.matchAll(
        /<wsdl:port name="([^"]+)"[^>]*binding="[^"]*"\s*>\s*<(?:soap|soap12)12?:address location="([^"]+)"/g,
      ),
    ].map((m) => ({ port: m[1], address: m[2] }));
    const types = [...new Set([...wsdl.matchAll(/<xs:complexType name="(Import[^"]+)"/g)].map((m) => m[1]))];
    const fields: Record<string, string[]> = {};
    for (const t of types) {
      const block = wsdl.match(new RegExp(`<xs:complexType name="${t}">([\\s\\S]*?)</xs:complexType>`));
      if (block) {
        fields[t] = [...block[1].matchAll(/<xs:element[^>]*name="([^"]+)"/g)].map((m) => m[1]);
      }
    }
    // Park the raw WSDL so it can be read properly instead of guessed at
    // through regexes. A WCF "CustomBinding" can carry a non-XML message
    // encoder, a required policy, or an addressing requirement, none of
    // which a summary shows, and all of which produce a bare 415.
    await db.from('onkey_report_rows').upsert(
      {
        report_code: `WSDL:${service}`,
        row_hash: await sha256Hex(wsdl),
        data: { service, url, bytes: wsdl.length, wsdl },
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'report_code,row_hash' },
    );

    await finishRun(runId, {
      state: 'succeeded',
      detail: { operations, typeCount: types.length, soapVersions, bindings },
    });
    return json({
      ok: true,
      service,
      url,
      httpStatus: res?.status ?? 0,
      wsdlBytes: wsdl.length,
      soapVersions,
      bindings,
      ports,
      operations,
      fields,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishRun(runId, { state: 'failed', error: message });
    return json({ ok: false, error: message }, 502);
  }
}

async function handleExport(body: Record<string, unknown>): Promise<Response> {
  const reportCode = String(body.reportCode ?? '');
  const dataSetName = String(body.dataSetName ?? reportCode);
  const maxRecords = Number(body.maxRecords ?? 5000);
  const parameters = (body.parameters ?? {}) as Record<string, string>;
  if (!reportCode) return json({ ok: false, error: 'reportCode is required' }, 400);

  const runId = await startRun('export', { reportCode, parameters });
  const client = new OnKeyClient(creds());
  try {
    const { rows, raw } = await client.exportData(reportCode, dataSetName, maxRecords, parameters);
    // An empty result is ambiguous: OnKey returning nothing and us failing
    // to parse what it returned look identical from here, and reporting the
    // first as fact when it is the second wastes somebody else's day.
    if (body.debug) {
      return json({
        ok: true,
        reportCode,
        rows: rows.length,
        rawBytes: raw.length,
        rawHead: raw.slice(0, 1200),
        rawTail: raw.slice(-600),
      });
    }
    let inserted = 0;
    // Chunked upsert: one Edge invocation handles one bounded bite.
    for (let i = 0; i < rows.length; i += 500) {
      const slice = rows.slice(i, i + 500);
      const payload = await Promise.all(
        slice.map(async (row) => ({
          report_code: reportCode,
          row_hash: await rowHash(row),
          data: row,
          last_seen_at: new Date().toISOString(),
        })),
      );
      const { error } = await db.from('onkey_report_rows').upsert(payload, {
        onConflict: 'report_code,row_hash',
        ignoreDuplicates: false,
      });
      if (error) throw new Error(error.message);
      inserted += payload.length;
    }
    await finishRun(runId, { state: 'succeeded', rows_fetched: rows.length, rows_inserted: inserted });
    return json({ ok: true, reportCode, rows: rows.length, columns: rows[0] ? Object.keys(rows[0]) : [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishRun(runId, { state: 'failed', error: message });
    return json({ ok: false, error: message, code: err instanceof OnKeyFault ? err.code : null }, 502);
  } finally {
    await client.logOff();
  }
}

/** Give up after this many tries. Without a ceiling a permanently
 * rejected event blocks its work order forever, because the head-of-line
 * rule below never lets the next one past. */
const MAX_ATTEMPTS = 5;

/** Failure disposition. Retries back off 1, 2, 4, 8 minutes and then the
 * row dead-letters, which RELEASES the work order: the queue must not be
 * frozen by something that is never going to succeed. A dead letter is a
 * visible question for a human, not a silent drop. */
function retryOrGiveUp(
  ev: Record<string, any>,
  message: string,
  failures?: unknown[],
): Record<string, unknown> {
  const attempts = (ev.attempts ?? 0) + 1;
  const giveUp = attempts >= MAX_ATTEMPTS;
  return {
    state: giveUp ? 'dead_letter' : 'failed',
    attempts,
    record_failures: failures?.length ? failures : null,
    last_error: giveUp ? `gave up after ${attempts} attempts: ${message}` : message,
    not_before: giveUp
      ? null
      : new Date(Date.now() + 2 ** (attempts - 1) * 60_000).toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/** Domain event -> OnKey import. The ADAPTER: replacing OnKey means
 * replacing this function, nothing else. */
async function handleDrain(limit: number): Promise<Response> {
  const dryRun = await config<boolean>('dry_run', true);
  const allowlist = await config<string[]>('write_allowlist', []);
  const runId = await startRun('drain', { dryRun, limit });

  // Head selection lives in SQL (onkey_outbox_next), not here. Doing it in
  // TypeScript produced two bugs. Filtering to eligible rows FIRST meant a
  // head in retry backoff dropped out of the list and promoted its own
  // successor, so hop 2 could reach OnKey without hop 1: reproduced live
  // with WPA backing off and LSI sailing past it. And applying the limit
  // before the per-work-order reduction let one work order with a long
  // queue fill the page and starve every other. The SQL picks the true
  // head per work order from ALL unfinished rows, backoff included, then
  // applies eligibility and only then the limit.
  const { data: events, error: nextError } = await db.rpc('onkey_outbox_next', {
    p_limit: limit,
  });
  if (nextError) throw new Error(nextError.message);

  if (!events?.length) {
    await finishRun(runId, { state: 'succeeded', detail: { drained: 0, dryRun } });
    return json({ ok: true, drained: 0, dryRun });
  }

  const client = new OnKeyClient(creds(), true);
  const results: unknown[] = [];
  try {
    for (const ev of events) {
      // Allowlist is absolute, in dry-run too: a blocked event never
      // silently disappears, it dead-letters with the reason.
      if (ev.wo_code && !allowlist.includes(ev.wo_code)) {
        await db
          .from('onkey_outbox')
          .update({
            // 'blocked', not 'dead_letter': WE declined to send this. It
            // was never offered to OnKey and never refused by it, and that
            // difference is what someone triaging needs to see.
            state: 'blocked',
            last_error: `work order ${ev.wo_code} is not in the write allowlist`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', ev.id);
        results.push({ id: ev.id, blocked: true });
        continue;
      }

      const planned = planFor(ev);
      if (dryRun) {
        results.push({ id: ev.id, kind: ev.kind, wouldSend: planned });
        continue;
      }

      try {
        const result = await execute(client, ev, planned);
        // Every answer OnKey gives about a status change is register data.
        // A refusal names the COMPLETE valid set for that source status
        // ("restricted to Completed, Work Paused, ..."), which is better
        // evidence than the export our own register was built from, and
        // that register is already known to be missing 10 of 25 observed
        // transitions. Folding it in here means the register improves as
        // the system runs, with no probing campaign and no risk.
        if (ev.kind === 'status_change') {
          const from = ev.payload?.fromStatus ?? null;
          const to = ev.payload?.stateCode ?? null;
          if (from && to) {
            if (result.failures.length) {
              await db.rpc('onkey_learn_from_rejection', {
                p_from: from,
                p_to: to,
                p_message: result.failures.map((f) => f.message).join('; '),
              });
            } else {
              await db.rpc('onkey_learn_from_success', { p_from: from, p_to: to });
            }
          }
        }
        // No read-back here, deliberately. The only status we hold is our
        // own mirror, refreshed by the export every couple of minutes, so
        // checking it right after a write would see the OLD status and
        // conclude the write failed. Divergence is reconciled on the next
        // sync instead, where the data is actually fresh.
        await db
          .from('onkey_outbox')
          .update(
            result.failures.length
              ? retryOrGiveUp(ev, result.failures.map((f) => f.message).join('; '), result.failures)
              : {
                  state: 'sent',
                  attempts: (ev.attempts ?? 0) + 1,
                  record_failures: null,
                  onkey_record_ids: result.successes,
                  last_error: null,
                  not_before: null,
                  sent_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                },
          )
          .eq('id', ev.id);
        results.push({ id: ev.id, failures: result.failures, successes: result.successes });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await db.from('onkey_outbox').update(retryOrGiveUp(ev, message)).eq('id', ev.id);
        results.push({ id: ev.id, error: message });
      }
    }
    await finishRun(runId, {
      state: 'succeeded',
      detail: { drained: events.length, dryRun, transcripts: client.transcripts.length },
    });
    return json({ ok: true, dryRun, drained: events.length, results });
  } finally {
    await client.logOff();
  }
}

/** What an event WOULD send: shown in dry-run, executed otherwise. */
function planFor(ev: Record<string, any>): Record<string, unknown> {
  const p = ev.payload ?? {};
  switch (ev.kind) {
    case 'status_change':
      return {
        operation: 'ImportWorkOrderChangeStatusAndQueues',
        records: [
          {
            workOrderCode: ev.wo_code,
            userDefinedStateCode: p.stateCode,
            queueUser: p.queueUser,
            remark: p.remark ?? `event ${ev.event_uuid}`,
            referenceId: 1,
          },
        ],
      };
    // No ExternalReference stamped in here any more. An import writes
    // every field it is given, and ExternalReference is a real business
    // field on the work order (the slot Prowalco may want the certificate
    // number in), so quietly filling it with our event UUID on every merge
    // was overwriting their data to solve a problem we do not have: the
    // outbox is already idempotent through seq and source_event_id.
    case 'work_order_merge':
      return {
        operation: 'ImportWorkOrders',
        records: [{ referenceId: 1, action: 'Merge', code: ev.wo_code, ...p }],
      };
    case 'work_order_create':
      return {
        operation: 'ImportWorkOrders',
        records: [{ referenceId: 1, action: 'Insert', ...p }],
      };
    case 'work_task_spares':
      // One record per costing line, all against the same work order.
      //
      // NOT SENDABLE YET, and the missing piece is not in this file. Every
      // real spare row in OnKey hangs off a WORK TASK (ParentId), and we
      // have no way to learn which task belongs to a given work order: the
      // FIELDOPS - TASK report has required parameters whose names are not
      // published, and it now returns zero rows for every call we can
      // make. So taskId/taskCode below are read from the payload and the
      // payload cannot yet carry them. Until Prowalco supplies the report
      // parameters (or authors PWR-WT01, already specified in
      // docs/ONKEY-REPORTS-SPEC.md), these stay queued blocked.
      //
      // ItemType is deliberately not set: the live rows carry ItemType 0,
      // "Warehouse Item", and guessing a type is how a costing line lands
      // in the wrong bucket.
      return {
        operation: 'ImportWorkTaskSpares',
        records: (p.lines ?? []).map(
          (l: Record<string, unknown>, i: number) => ({
            referenceId: i + 1,
            action: 'Insert',
            workOrderCode: ev.wo_code,
            taskId: p.taskId,
            taskCode: p.taskCode,
            itemCode: l.itemCode,
            itemDescription: l.description,
            quantityRequired: l.quantity,
            unitCode: l.unit,
            notes: p.workPerformed,
          }),
        ),
      };
    default:
      return { operation: 'UNSUPPORTED', kind: ev.kind };
  }
}

async function execute(client: OnKeyClient, ev: Record<string, any>, planned: Record<string, any>) {
  switch (planned.operation) {
    case 'ImportWorkOrderChangeStatusAndQueues':
      return await client.changeStatusAndQueue(planned.records);
    case 'ImportWorkOrders':
      return await client.importWorkOrders(planned.records);
    case 'ImportWorkTaskSpares':
      if (!planned.records.length) throw new Error('no costing lines to send');
      return await client.importWorkTaskSpares(planned.records);
    default:
      throw new Error(`unsupported event kind ${ev.kind}`);
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  // ONKEY_SYNC_TOKEN is the shared secret for machine callers of our sync
  // surface: the GitHub Actions cron already presents it to the Render
  // endpoints, so reusing it here means ONE secret to rotate rather than
  // two that must be kept in step. ONKEY_FUNCTION_SECRET still wins if
  // someone wants the function on its own credential.
  const secret = Deno.env.get('ONKEY_FUNCTION_SECRET') || Deno.env.get('ONKEY_SYNC_TOKEN') || '';
  const presented = req.headers.get('x-onkey-secret') ?? '';
  if (!secret || presented.length !== secret.length || presented !== secret) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // GET or empty body: default action below.
  }
  const action = String(body.action ?? 'smoke');
  try {
    switch (action) {
      case 'smoke':
        return await handleSmoke();
      case 'introspect':
        return await handleIntrospect(String(body.service ?? 'WorkOrderImport'));
      case 'export':
        return await handleExport(body);
      case 'drain':
        return await handleDrain(Number(body.limit ?? 10));
      default:
        return json({ ok: false, error: `unknown action ${action}` }, 400);
    }
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
