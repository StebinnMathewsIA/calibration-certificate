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
  const { data } = await db
    .from('onkey_sync_runs')
    .insert({ run_kind: kind, detail })
    .select('id')
    .single();
  return data!.id as string;
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
    const url = `${creds().baseUrl.replace(/\/$/, '')}/${service}.svc?singleWsdl`;
    const res = await fetch(url);
    const wsdl = await res.text();
    const operations = [...new Set([...wsdl.matchAll(/<wsdl:operation name="([^"]+)"/g)].map((m) => m[1]))];
    const types = [...new Set([...wsdl.matchAll(/<xs:complexType name="(Import[^"]+)"/g)].map((m) => m[1]))];
    const fields: Record<string, string[]> = {};
    for (const t of types) {
      const block = wsdl.match(new RegExp(`<xs:complexType name="${t}">([\\s\\S]*?)</xs:complexType>`));
      if (block) {
        fields[t] = [...block[1].matchAll(/<xs:element[^>]*name="([^"]+)"/g)].map((m) => m[1]);
      }
    }
    await finishRun(runId, { state: 'succeeded', detail: { operations, typeCount: types.length } });
    return json({ ok: true, service, operations, fields });
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
    const { rows } = await client.exportData(reportCode, dataSetName, maxRecords, parameters);
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

/** Domain event -> OnKey import. The ADAPTER: replacing OnKey means
 * replacing this function, nothing else. */
async function handleDrain(limit: number): Promise<Response> {
  const dryRun = await config<boolean>('dry_run', true);
  const allowlist = await config<string[]>('write_allowlist', []);
  const runId = await startRun('drain', { dryRun, limit });

  const { data: events } = await db
    .from('onkey_outbox')
    .select('*')
    .eq('state', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit);

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
            state: 'dead_letter',
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
        await db
          .from('onkey_outbox')
          .update({
            state: result.failures.length ? 'failed' : 'sent',
            attempts: (ev.attempts ?? 0) + 1,
            record_failures: result.failures.length ? result.failures : null,
            onkey_record_ids: result.successes,
            last_error: result.failures.map((f) => f.message).join('; ') || null,
            sent_at: result.failures.length ? null : new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', ev.id);
        results.push({ id: ev.id, failures: result.failures, successes: result.successes });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await db
          .from('onkey_outbox')
          .update({
            state: 'failed',
            attempts: (ev.attempts ?? 0) + 1,
            last_error: message,
            updated_at: new Date().toISOString(),
          })
          .eq('id', ev.id);
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
    case 'work_order_merge':
      return {
        operation: 'ImportWorkOrders',
        records: [{ referenceId: 1, action: 'Merge', code: ev.wo_code, externalReference: ev.event_uuid, ...p }],
      };
    case 'work_order_create':
      return {
        operation: 'ImportWorkOrders',
        records: [{ referenceId: 1, action: 'Insert', externalReference: ev.event_uuid, ...p }],
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
