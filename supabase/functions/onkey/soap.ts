/**
 * OnKey SOAP over plain HTTP (#105). Hand-built envelopes from the
 * introspected WSDLs (docs/ONKEY-WEBSERVICES.md section 6b) — no SOAP
 * library in Deno is worth the dependency for four operations.
 *
 * Session rules (API guide section 3): Logon returns a SessionId that
 * rides as a SOAP HEADER on every later call; LogOff always; a
 * SessionExpired fault means re-Logon and retry once.
 *
 * CI pins these builders to golden transcripts captured from the
 * working Python client, so the port cannot drift silently.
 */

/**
 * WCF publishes data contracts and service contracts under DIFFERENT
 * namespaces, and OnKey uses both:
 *
 *   schemas.pragmaproducts.com    the xs:schema targetNamespace, so it
 *                                 qualifies request and response BODIES
 *   contracts.pragmaproducts.com  the wsdl targetNamespace, so it
 *                                 qualifies SOAP ACTIONS
 *
 * Getting the action wrong does not produce a fault. Under SOAP 1.2 the
 * action rides inside the Content-Type, so WCF answers a bare HTTP 415
 * with an empty body, which reads like a media-type problem and is not
 * one. Both namespaces are taken from the published WSDL; the action
 * service names carry NO "I" prefix (AuthenticationService, not
 * IAuthenticationService), whatever the .NET interface is called.
 */
const NS_SYS = 'http://schemas.pragmaproducts.com/onkey/System/v1';
const NS_MM = 'http://schemas.pragmaproducts.com/onkey/MaintenanceManager/v1';
const NS_COMMON = 'http://schemas.pragmaproducts.com/onkey/v1';

const ACTION_SYS = 'http://contracts.pragmaproducts.com/onkey/System/v1';
const ACTION_MM = 'http://contracts.pragmaproducts.com/onkey/MaintenanceManager/v1';

export interface OnKeyCreds {
  baseUrl: string;
  username: string;
  password: string;
  connection: string;
}

export class OnKeyFault extends Error {
  constructor(readonly code: string, message: string, readonly detail?: string) {
    super(message);
  }
}

export const xmlEscape = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Minimal tag reader: OnKey responses are flat enough that a parser
 * dependency buys nothing. Returns the FIRST match's inner text. */
export function tagText(xml: string, localName: string): string | null {
  const m = xml.match(new RegExp(`<(?:[A-Za-z0-9]+:)?${localName}[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9]+:)?${localName}>`));
  return m ? m[1] : null;
}

export function tagTextAll(xml: string, localName: string): string[] {
  const re = new RegExp(`<(?:[A-Za-z0-9]+:)?${localName}[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9]+:)?${localName}>`, 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

/**
 * SOAP 1.1, posted to the "/basic" endpoint.
 *
 * Each service publishes TWO ports (read from the WSDL service block):
 *
 *   Authentication.svc        HttpsSoap12CustomBinding, and it carries a
 *                             wsa10:EndpointReference, so it requires
 *                             WS-Addressing headers
 *   Authentication.svc/basic  HttpsSoap11BasicBinding, plain SOAP 1.1
 *                             with no addressing at all
 *
 * We were posting to the first one. A WS-Addressing binding rejects a
 * message whose action arrives in the Content-Type instead of a
 * wsa:Action header, and reports it as HTTP 415 with an empty body,
 * which looks like a media-type fault and is not one. Rather than
 * implement WS-Addressing for four operations, use the /basic port,
 * which is exactly what this hand-built client was written for.
 *
 * Both bindings declare the same soapAction values.
 */
const SOAP11_NS = 'http://schemas.xmlsoap.org/soap/envelope/';

function envelope(header: string, body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="${SOAP11_NS}">
  <s:Header>${header}</s:Header>
  <s:Body>${body}</s:Body>
</s:Envelope>`;
}

function sessionHeader(sessionId: string): string {
  return `<SessionId xmlns="${NS_COMMON}">${xmlEscape(sessionId)}</SessionId>`;
}

async function post(url: string, action: string, xml: string): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: `"${action}"`,
    },
    body: xml,
  });
  const text = await res.text();
  if (!res.ok || text.includes('<s:Fault') || text.includes('<Fault')) {
    const code = tagText(text, 'ErrorCode') ?? '';
    // SOAP 1.2 renames faultstring to Reason/Text. Keep the 1.1 name as a
    // fallback so a mixed response still yields something readable, and
    // include a body excerpt when the server explains itself in prose
    // rather than a fault (a 415 has no fault element at all).
    const message =
      tagText(text, 'ErrorMessage') ??
      tagText(text, 'Text') ??
      tagText(text, 'faultstring') ??
      `HTTP ${res.status}${text.trim() ? `: ${text.trim().slice(0, 300)}` : ''}`;
    throw new OnKeyFault(code, message, tagText(text, 'ErrorDetail') ?? undefined);
  }
  return text;
}

/** Business errors ride INSIDE a successful response (guide section 4):
 * a 200 is not success until this is empty. */
export function responseErrors(xml: string): string[] {
  const block = xml.match(/<(?:[A-Za-z0-9]+:)?Errors[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9]+:)?Errors>/);
  if (!block) return [];
  return tagTextAll(block[1], 'string');
}

export class OnKeyClient {
  private sessionId: string | null = null;
  /** Set by the caller to capture transcripts for golden fixtures. */
  transcripts: { operation: string; request: string; response: string }[] = [];

  constructor(private readonly creds: OnKeyCreds, private readonly capture = false) {}

  /** The SOAP 1.1 basicHttpBinding port. See the envelope note above:
   * the bare .svc address is the WS-Addressing one and rejects us. */
  private svc(name: string): string {
    return `${this.creds.baseUrl.replace(/\/$/, '')}/${name}.svc/basic`;
  }

  private async call(service: string, action: string, xml: string, operation: string): Promise<string> {
    const url = this.svc(service);
    let response: string;
    try {
      response = await post(url, action, xml);
    } catch (err) {
      // SessionExpired: one re-logon and retry (guide section 4.1).
      if (err instanceof OnKeyFault && err.code === 'SessionExpired' && this.sessionId) {
        this.sessionId = null;
        await this.logon();
        response = await post(url, action, xml.replace(/<SessionId[^>]*>[\s\S]*?<\/SessionId>/, sessionHeader(this.sessionId!)));
      } else {
        throw err;
      }
    }
    if (this.capture) this.transcripts.push({ operation, request: xml, response });
    return response;
  }

  async logon(): Promise<string> {
    if (this.sessionId) return this.sessionId;
    const body = `<LogonRequest xmlns="${NS_SYS}">
      <Credentials><ConnectionName>${xmlEscape(this.creds.connection)}</ConnectionName>
      <Password>${xmlEscape(this.creds.password)}</Password>
      <UserName>${xmlEscape(this.creds.username)}</UserName></Credentials>
    </LogonRequest>`;
    const xml = envelope('', body);
    const res = await post(this.svc('Authentication'), `${ACTION_SYS}/AuthenticationService/Logon`, xml);
    const errs = responseErrors(res);
    if (errs.length) throw new OnKeyFault('LogonFailed', errs.join('; '));
    const id = tagText(res, 'SessionId');
    if (!id) throw new OnKeyFault('LogonFailed', 'No SessionId in Logon response');
    this.sessionId = id;
    return id;
  }

  async logOff(): Promise<void> {
    if (!this.sessionId) return;
    try {
      const body = `<LogOffRequest xmlns="${NS_SYS}"><SessionId>${xmlEscape(this.sessionId)}</SessionId></LogOffRequest>`;
      await post(this.svc('Authentication'), `${ACTION_SYS}/AuthenticationService/LogOff`, envelope('', body));
    } catch {
      // A failed logoff must never fail the run; the session expires anyway.
    } finally {
      this.sessionId = null;
    }
  }

  /** Analyser Report export (the ONLY read mechanism OnKey offers). */
  async exportData(
    reportCode: string,
    dataSetName: string,
    maxRecords: number,
    parameters: Record<string, string> = {},
  ): Promise<{ rows: Record<string, string>[]; raw: string }> {
    await this.logon();
    const params = Object.entries(parameters)
      .map(
        ([name, value]) =>
          `<ExportQueryParameter><Name>${xmlEscape(name)}</Name><Value>${xmlEscape(value)}</Value></ExportQueryParameter>`,
      )
      .join('');
    const body = `<ExportDataRequest xmlns="${NS_SYS}">
      <DataSetName>${xmlEscape(dataSetName)}</DataSetName>
      <MaxRecordCount>${maxRecords}</MaxRecordCount>
      <Parameters>${params}</Parameters>
      <ReportCode>${xmlEscape(reportCode)}</ReportCode>
    </ExportDataRequest>`;
    const xml = envelope(sessionHeader(this.sessionId!), body);
    const res = await this.call('Export', `${ACTION_SYS}/ExportService/ExportData`, xml, 'ExportData');
    const errs = responseErrors(res);
    if (errs.length) throw new OnKeyFault('ExportFailed', errs.join('; '));
    return { rows: parseDataSet(res), raw: res };
  }

  /** Status/queue change: the lifecycle write-back (#96). */
  async changeStatusAndQueue(
    records: {
      workOrderCode: string;
      userDefinedStateCode?: string;
      queueUser?: string;
      priority?: string;
      remark?: string;
      referenceId: number;
    }[],
    includeSuccesses = true,
  ): Promise<ImportResult> {
    await this.logon();
    const items = records
      .map(
        (r) => `<ImportWorkOrderChangeStatusAndQueue>
        <ReferenceId>${r.referenceId}</ReferenceId>
        <WorkOrderCode>${xmlEscape(r.workOrderCode)}</WorkOrderCode>
        ${r.userDefinedStateCode ? `<UserDefinedStateCode>${xmlEscape(r.userDefinedStateCode)}</UserDefinedStateCode>` : ''}
        ${r.queueUser ? `<QueueUser>${xmlEscape(r.queueUser)}</QueueUser>` : ''}
        ${r.priority ? `<Priority>${xmlEscape(r.priority)}</Priority>` : ''}
        ${r.remark ? `<Remark>${xmlEscape(r.remark)}</Remark>` : ''}
      </ImportWorkOrderChangeStatusAndQueue>`,
      )
      .join('');
    const body = `<ImportWorkOrderChangeStatusAndQueuesRequest xmlns="${NS_MM}">
      <IncludeRecordSuccesses>${includeSuccesses}</IncludeRecordSuccesses>
      <Records>${items}</Records>
    </ImportWorkOrderChangeStatusAndQueuesRequest>`;
    const xml = envelope(sessionHeader(this.sessionId!), body);
    const res = await this.call(
      'WorkOrderImport',
      `${ACTION_MM}/WorkOrderImportService/ImportWorkOrderChangeStatusAndQueues`,
      xml,
      'ImportWorkOrderChangeStatusAndQueues',
    );
    return parseImportResult(res);
  }

  /** Work order create/merge: feedback, creation, ExternalReference. */
  async importWorkOrders(
    records: (Record<string, string | number | boolean | undefined> & {
      referenceId: number;
      action: 'Insert' | 'Update' | 'Merge' | 'Delete';
      code?: string;
    })[],
    includeSuccesses = true,
  ): Promise<ImportResult> {
    await this.logon();
    const items = records
      .map((r) => {
        const { referenceId, action, ...fields } = r;
        const inner = Object.entries(fields)
          .filter(([, v]) => v !== undefined && v !== null && v !== '')
          .map(([k, v]) => `<${cap(k)}>${xmlEscape(v)}</${cap(k)}>`)
          .join('');
        return `<ImportWorkOrder><ReferenceId>${referenceId}</ReferenceId><Action>${action}</Action>${inner}</ImportWorkOrder>`;
      })
      .join('');
    const body = `<ImportWorkOrdersRequest xmlns="${NS_MM}">
      <IncludeRecordSuccesses>${includeSuccesses}</IncludeRecordSuccesses>
      <Records>${items}</Records>
    </ImportWorkOrdersRequest>`;
    const xml = envelope(sessionHeader(this.sessionId!), body);
    const res = await this.call(
      'WorkOrderImport',
      `${ACTION_MM}/WorkOrderImportService/ImportWorkOrders`,
      xml,
      'ImportWorkOrders',
    );
    return parseImportResult(res);
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface ImportResult {
  failures: { referenceId: number | null; message: string }[];
  successes: { referenceId: number | null; recordId: string | null }[];
  raw: string;
}

export function parseImportResult(xml: string): ImportResult {
  const failures: ImportResult['failures'] = [];
  const successes: ImportResult['successes'] = [];
  for (const block of tagTextAll(xml, 'ImportRecordFailure')) {
    failures.push({
      referenceId: numOrNull(tagText(block, 'ReferenceId')),
      message: tagText(block, 'Message') ?? '',
    });
  }
  for (const block of tagTextAll(xml, 'ImportRecordSuccess')) {
    successes.push({
      referenceId: numOrNull(tagText(block, 'ReferenceId')),
      recordId: tagText(block, 'RecordId'),
    });
  }
  for (const e of responseErrors(xml)) failures.push({ referenceId: null, message: e });
  return { failures, successes, raw: xml };
}

const numOrNull = (v: string | null) => (v == null || v === '' ? null : Number(v));

/** ExportDataResponse -> row dicts. The rows arrive as CDATA XML inside
 * <Data>, one element per record (guide section 5.2.2). */
export function parseDataSet(xml: string): Record<string, string>[] {
  const data = tagText(xml, 'Data');
  if (!data) return [];
  const inner = data.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
  const rows: Record<string, string>[] = [];
  // Records are the second-level elements of the dataset root.
  const rootMatch = inner.match(/<([A-Za-z0-9_]+)>([\s\S]*)<\/\1>/);
  if (!rootMatch) return rows;
  const recordRe = /<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = recordRe.exec(rootMatch[2])) !== null) {
    const row: Record<string, string> = {};
    const fieldRe = /<([A-Za-z0-9_]+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g;
    let f: RegExpExecArray | null;
    while ((f = fieldRe.exec(m[2])) !== null) row[f[1]] = decodeEntities(f[2]);
    if (Object.keys(row).length) rows.push(row);
  }
  return rows;
}

const decodeEntities = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
