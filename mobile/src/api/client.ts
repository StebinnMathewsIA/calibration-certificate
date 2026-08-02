import type {
  AnalysisResponse,
  DispenserDetail,
  RejectionSubmission,
  SignResponse,
  SignSubmission,
  Verification,
  WorkOrderSeed,
} from '@prowalco/schema';
import { analysisResponseSchema, signResponseSchema } from '@prowalco/schema';
import { readCache, writeCache } from '../db/cache';
import { enqueueWrite } from '../sync/outbox';
import { ApiError, isNetworkError, request } from './http';
import { rpc } from './supabaseRpc';

export { ApiError } from './http';

// ---------------------------------------------------------------------------
// Certificates / signing
// ---------------------------------------------------------------------------

export async function reserveCertificateNumber(token: string | null, branch: string): Promise<string> {
  const body = (await request('/v1/certificates/reserve-number', token, {
    method: 'POST',
    body: JSON.stringify({ branch }),
  })) as { certificateNumber: string };
  return body.certificateNumber;
}

/** Device-binding proof attached to a signing upload (#52). */
export interface DeviceAuth {
  deviceId: string;
  timestamp: string;
  signature: string;
}

export async function submitForSigning(
  token: string | null,
  submission: SignSubmission,
  deviceAuth?: DeviceAuth,
): Promise<SignResponse> {
  const body = await request('/v1/certificates/sign', token, {
    method: 'POST',
    body: JSON.stringify(submission),
    headers: deviceAuth
      ? {
          'X-Device-Id': deviceAuth.deviceId,
          'X-Device-Timestamp': deviceAuth.timestamp,
          'X-Device-Signature': deviceAuth.signature,
        }
      : undefined,
  });
  return signResponseSchema.parse(body);
}

/** Seal a rejection certificate (#92): same endpoint, same guarantees,
 * routed by documentType. Online-only in v1 (rejections are rare). */
export async function submitRejectionForSigning(
  token: string | null,
  submission: RejectionSubmission,
  deviceAuth?: DeviceAuth,
): Promise<SignResponse> {
  const body = await request('/v1/certificates/sign', token, {
    method: 'POST',
    body: JSON.stringify(submission),
    headers: deviceAuth
      ? {
          'X-Device-Id': deviceAuth.deviceId,
          'X-Device-Timestamp': deviceAuth.timestamp,
          'X-Device-Signature': deviceAuth.signature,
        }
      : undefined,
  });
  return signResponseSchema.parse(body);
}

/** Role + view-as state for the signed-in user (#71). */
export interface Whoami {
  role: 'manager' | 'admin' | null;
  viewAsStaffCode: string | null;
  viewAsName: string | null;
}

export async function getWhoami(token: string | null): Promise<Whoami> {
  return await rpc<Whoami>('app_whoami', token);
}

/** Technician picker for role holders; null for everyone else. */
export async function listTechnicians(
  token: string | null,
): Promise<{ staffCode: string; name: string | null }[] | null> {
  return await rpc<{ staffCode: string; name: string | null }[] | null>(
    'app_list_technicians',
    token,
  );
}

/** Select (or clear, with null) the technician whose world the role holder
 * sees. Server-side, so every screen follows. */
export async function setViewAs(token: string | null, staffCode: string | null): Promise<Whoami> {
  return await rpc<Whoami>('app_set_view_as', token, { p_staff_code: staffCode });
}

/** Measures compliance across all technicians (#71); null unless the caller
 * holds a role. */
export interface MeasuresCompliance {
  total: number;
  compliant: number;
  issues: {
    staffCode: string;
    name: string | null;
    missing: string[];
    expired: { size: string; expiryDate: string }[];
    expiring: { size: string; expiryDate: string }[];
  }[];
}

export async function getMeasuresCompliance(
  token: string | null,
): Promise<MeasuresCompliance | null> {
  return await rpc<MeasuresCompliance | null>('app_measures_compliance', token);
}

/** Role administration (#72) — admin only; the SQL guards enforce it. */
export interface RoleEntry {
  email: string;
  role: 'manager' | 'admin';
  createdAt: string;
}

export async function listRoles(token: string | null): Promise<RoleEntry[] | null> {
  return await rpc<RoleEntry[] | null>('app_list_roles', token);
}

export async function setRole(
  token: string | null,
  email: string,
  role: 'manager' | 'admin' | null,
): Promise<RoleEntry[]> {
  return await rpc<RoleEntry[]>('app_set_role', token, { p_email: email, p_role: role });
}

export async function listAllocations(
  token: string | null,
): Promise<Record<string, string[]> | null> {
  return await rpc<Record<string, string[]> | null>('app_list_allocations', token);
}

export async function setAllocation(
  token: string | null,
  managerEmail: string,
  staffCode: string,
  allocated: boolean,
): Promise<Record<string, string[]>> {
  return await rpc<Record<string, string[]>>('app_set_allocation', token, {
    p_manager: managerEmail,
    p_staff_code: staffCode,
    p_allocated: allocated,
  });
}

/** Cross-company certificate search (#72) — role holders only. */
export async function searchCertificates(
  token: string | null,
  query: string,
): Promise<(CertHistoryEntry & { siteName: string; customerName: string })[] | null> {
  return await rpc<(CertHistoryEntry & { siteName: string; customerName: string })[] | null>(
    'app_cert_search',
    token,
    { p_query: query, p_limit: 50 },
  );
}

/** Open work orders grouped per technician (#76) — role holders only. */
export interface TeamGroup {
  staffCode: string;
  name: string | null;
  workOrders: WorkOrderSummary[];
}

export async function getTeamWorkOrders(token: string | null): Promise<TeamGroup[] | null> {
  return await rpc<TeamGroup[] | null>('app_team_work_orders', token);
}

// ---------------------------------------------------------------------------
// Work-order lifecycle (#95): OUR work-order entity, our states. OnKey is a
// seed and a write-back adapter, never the source of truth.
// ---------------------------------------------------------------------------

export type WoState = 'not_started' | 'started' | 'paused' | 'stopped' | 'signed_off';

export interface WoLifecycle {
  state: WoState;
  pauseReason: string | null;
  pauseNote: string | null;
  /** True when the pause reason bars the technician from resuming. */
  blocksResume: boolean;
  startedAt: string | null;
  pausedAt: string | null;
  stoppedAt: string | null;
  pausedSeconds: number;
}

export interface WorkOrderRecord {
  id: string;
  source: string;
  externalRef: string | null;
  staffCode: string | null;
  siteId: string | null;
  siteName: string | null;
  customerName: string | null;
  assetCode: string | null;
  assetDescription: string | null;
  workRequired: string | null;
  statusCode: string | null;
  statusDescription: string | null;
  importanceCode: string | null;
  /** SLA class name from OnKey's importance register, e.g. SLA-Urgent. */
  importanceDescription: string | null;
  /** OnKey's own urgency weight, higher is more urgent (0 to 10). */
  importanceWeight: number | null;
  estimatedDurationMinutes: number | null;
  completeBy: string | null;
  requiredBy: string | null;
  /** WKT "POINT (lon lat)". */
  gpsLocation: string | null;
  isDemo: boolean;
  lifecycle: WoLifecycle | null;
}

export interface PauseReason {
  code: string;
  label: string;
  blocksResume: boolean;
  requiresNote: boolean;
}

export async function listWorkOrderRecords(token: string | null): Promise<WorkOrderRecord[]> {
  return await rpc<WorkOrderRecord[]>('app_wo_list', token);
}

export async function listPauseReasons(token: string | null): Promise<PauseReason[]> {
  return await rpc<PauseReason[]>('app_wo_pause_reasons', token);
}

/** Apply a lifecycle transition. The state machine is enforced server-side,
 * so an invalid transition fails loudly rather than corrupting state. */
export async function transitionWorkOrder(
  token: string | null,
  workOrderId: string,
  event: 'start' | 'pause' | 'stop' | 'sign_off',
  opts: { reason?: string; note?: string; deviceId?: string; gps?: string } = {},
): Promise<WorkOrderRecord> {
  return await rpc<WorkOrderRecord>('app_wo_transition', token, {
    p_work_order_id: workOrderId,
    p_event: event,
    p_reason: opts.reason ?? null,
    p_note: opts.note ?? null,
    p_device_id: opts.deviceId ?? null,
    p_gps: opts.gps ?? null,
  });
}

/** One certified proving measure from the register (#70). */
export interface MeasureRecord {
  id?: number;
  size: string; // '200L' | '20L' | '5L'
  serialNumber: string;
  certificateNumber: string;
  calibrationDate: string | null;
  expiryDate: string;
  status?: string; // 'active' | 'superseded'
  addedAt?: string | null;
  supersededAt?: string | null;
}

/** The signed-in technician's record from the mined register (#62). */
export interface MyTechnician {
  staffCode: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  manager: string | null;
  pliersNumber: string | null;
  /** ACTIVE certified measures from the register (#70) — blank until the
   * technician registers their own. */
  measures: MeasureRecord[];
}

export async function getMyTechnician(
  token: string | null,
): Promise<{ technician: MyTechnician; editable: boolean }> {
  const body = await rpc<{ technician: MyTechnician; editable: boolean } | null>(
    'app_my_technician',
    token,
  );
  if (!body) throw new ApiError(404, 'No technician record for this account');
  return body;
}

export async function patchMyTechnician(
  token: string | null,
  body: { pliersNumber?: string },
): Promise<void> {
  try {
    await request('/v1/technicians/me', token, { method: 'PATCH', body: JSON.stringify(body) });
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    enqueueWrite('patchMyTechnician', { body });
  }
}

/** Register a newly certified proving measure (#70). Supersedes the old
 * measure of that size server-side; queues offline. */
export async function addMeasure(
  token: string | null,
  body: Omit<MeasureRecord, 'id' | 'status' | 'addedAt' | 'supersededAt'>,
): Promise<void> {
  try {
    await request('/v1/technicians/me/measures', token, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    enqueueWrite('addMeasure', { body });
  }
}

/** Active + historic measures for the signed-in technician (#70). */
export async function getMyMeasures(
  token: string | null,
): Promise<{ active: MeasureRecord[]; history: MeasureRecord[] }> {
  return await rpc<{ active: MeasureRecord[]; history: MeasureRecord[] }>(
    'app_my_measures',
    token,
  );
}

export async function enrollDevice(
  token: string | null,
  body: { deviceId: string; publicKeyPem: string; platform?: string; model?: string },
): Promise<{ status: 'active' | 'pending' | 'revoked' }> {
  return (await request('/v1/devices/enroll', token, {
    method: 'POST',
    body: JSON.stringify(body),
  })) as { status: 'active' | 'pending' | 'revoked' };
}

export async function confirmReceipt(token: string | null, certificateNumber: string): Promise<void> {
  await request(`/v1/certificates/${encodeURIComponent(certificateNumber)}/receipt`, token);
}

/** Insights scoped by the caller's JWT (#56): the technician's own numbers
 * plus a PII-free company snapshot. */
export interface Insights {
  me: {
    staffCode: string | null;
    openByStatus: Record<string, number>;
    openTotal: number;
    completedLast30: number;
    monthlyCompleted: { month: string; count: number }[];
    openSites: number;
  };
  certificates: {
    issuedByMe: number;
    last30ByMe: number;
    lastIssuedAt: string | null;
    expiringSoon60: number;
  };
  company: {
    openTotal: number;
    techniciansWithOpen: number;
    sitesWithOpen: number;
    certificatesTotal: number;
    certificatesLast30: number;
  };
  generatedAt: string;
}

export async function getInsights(token: string | null): Promise<Insights> {
  return await rpc<Insights>('app_insights', token);
}

/** One row of the site/dispenser verification history (#68). */
export interface CertHistoryEntry {
  certificateNumber: string;
  /** 'verification' | 'rejection-certificate' (#92); absent on old caches. */
  documentType?: string | null;
  siteId: string | null;
  dispenserId: string | null;
  status: string;
  reportType: string | null;
  voName: string | null;
  verificationDate: string | null;
  expiryDate: string | null;
  signedAt: string;
  supersedes: string | null;
}

export async function getSiteHistory(
  token: string | null,
  siteId: string,
): Promise<CertHistoryEntry[]> {
  return await rpc<CertHistoryEntry[]>('app_site_history', token, { p_site_id: siteId });
}

export async function getDispenserHistory(
  token: string | null,
  dispenserId: string,
): Promise<CertHistoryEntry[]> {
  return await rpc<CertHistoryEntry[]>('app_dispenser_history', token, {
    p_dispenser_id: dispenserId,
  });
}

/** The sealed PDF from the write-once archive (#68). */
export async function fetchCertificatePdf(
  token: string | null,
  certificateNumber: string,
): Promise<{ certificateNumber: string; signedPdfBase64: string; signedPdfSha256: string }> {
  return (await request(
    `/v1/certificates/${encodeURIComponent(certificateNumber)}/pdf`,
    token,
  )) as { certificateNumber: string; signedPdfBase64: string; signedPdfSha256: string };
}

export async function analyzeVerification(
  token: string | null,
  verification: Verification,
): Promise<AnalysisResponse> {
  const body = await request('/v1/analysis', token, {
    method: 'POST',
    body: JSON.stringify({ verification }),
  });
  return analysisResponseSchema.parse(body);
}

// ---------------------------------------------------------------------------
// Work orders / sites / dispensers (simulated OnKey + our canonical store)
// ---------------------------------------------------------------------------

/** A record resolved by the backend (our store wins over the OnKey seed).
 * `inStore` is false when the value is still the raw seed. */
export interface SiteResolved {
  id: string;
  customerName: string;
  siteName: string;
  address: string;
  telephone?: string | null;
  /** Name of contact on premises (#90). */
  contactPerson?: string | null;
  /** WKT "POINT (lon lat)" from the register / manual gap edits (#73). */
  gpsLocation?: string | null;
  source: 'onkey' | 'manual';
  updatedAt?: string | null;
  inStore?: boolean;
}

export interface DispenserResolved {
  id: string;
  siteId: string;
  make: string;
  model: string;
  serialNumber: string;
  saApprovalNumber: string;
  status: 'active' | 'retired';
  source: 'onkey' | 'manual';
  addedBy?: string | null;
  addedAt?: string | null;
  retiredBy?: string | null;
  retiredAt?: string | null;
  updatedAt?: string | null;
  inStore?: boolean;
}

export interface WorkOrderSummary extends WorkOrderSeed {
  site: { id: string; customerName: string; siteName: string };
}

export interface WorkOrderBundle {
  workOrder: WorkOrderSeed;
  site: SiteResolved | null;
  dispensers: DispenserResolved[];
}

export async function listWorkOrders(token: string | null): Promise<WorkOrderSummary[]> {
  return await rpc<WorkOrderSummary[]>('app_my_work_orders', token);
}

export async function getWorkOrder(token: string | null, id: string): Promise<WorkOrderBundle> {
  return await rpc<WorkOrderBundle>('app_work_order_bundle', token, { wo_code: id });
}

export async function listSites(token: string | null): Promise<SiteResolved[]> {
  return await rpc<SiteResolved[]>('app_my_sites', token);
}

export async function getSite(token: string | null, id: string): Promise<SiteResolved> {
  const site = await rpc<SiteResolved | null>('app_site', token, { p_site_id: id });
  if (!site) throw new ApiError(404, 'Unknown site');
  return site;
}

export async function listSiteDispensers(
  token: string | null,
  siteId: string,
): Promise<DispenserResolved[]> {
  return await rpc<DispenserResolved[]>('app_site_dispensers', token, { p_site_id: siteId });
}

export async function upsertSite(
  token: string | null,
  id: string,
  body: Omit<SiteResolved, 'source' | 'updatedAt' | 'inStore'>,
): Promise<SiteResolved> {
  try {
    const saved = (await request(`/v1/sites/${encodeURIComponent(id)}`, token, {
      method: 'POST',
      body: JSON.stringify(body),
    })) as SiteResolved;
    writeCache(`site:${id}`, saved);
    return saved;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    // Offline: queue for replay and continue with the optimistic record.
    enqueueWrite('upsertSite', { id, body });
    const optimistic: SiteResolved = { ...body, id, source: 'manual', inStore: true };
    writeCache(`site:${id}`, optimistic);
    return optimistic;
  }
}

export async function getDispenser(token: string | null, id: string): Promise<DispenserResolved> {
  const disp = await rpc<DispenserResolved | null>('app_dispenser', token, {
    p_dispenser_id: id,
  });
  if (!disp) throw new ApiError(404, 'Unknown dispenser');
  return disp;
}

export async function addDispenser(
  token: string | null,
  body: {
    id?: string;
    siteId: string;
    make: string;
    model: string;
    serialNumber: string;
    saApprovalNumber: string;
  },
): Promise<DispenserResolved> {
  try {
    const saved = (await request('/v1/dispensers', token, {
      method: 'POST',
      body: JSON.stringify(body),
    })) as DispenserResolved;
    writeCache(`dispenser:${saved.id}`, saved);
    return saved;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    // Offline: fix the id client-side so replay is idempotent (server 409 =
    // already applied).
    const id = body.id || `DISP-M-${Date.now()}`;
    enqueueWrite('addDispenser', { body: { ...body, id } });
    const optimistic: DispenserResolved = {
      id,
      siteId: body.siteId,
      make: body.make,
      model: body.model,
      serialNumber: body.serialNumber,
      saApprovalNumber: body.saApprovalNumber,
      status: 'active',
      source: 'manual',
      inStore: true,
    };
    writeCache(`dispenser:${id}`, optimistic);
    const listKey = `site-dispensers:${body.siteId}`;
    writeCache(listKey, [...(readCache<DispenserResolved[]>(listKey) ?? []), optimistic]);
    return optimistic;
  }
}

export async function editDispenser(
  token: string | null,
  id: string,
  body: { make: string; model: string; serialNumber: string; saApprovalNumber: string; siteId?: string },
): Promise<DispenserResolved> {
  try {
    const saved = (await request(`/v1/dispensers/${encodeURIComponent(id)}`, token, {
      method: 'POST',
      body: JSON.stringify(body),
    })) as DispenserResolved;
    writeCache(`dispenser:${id}`, saved);
    return saved;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    enqueueWrite('editDispenser', { id, body });
    const prev = readCache<DispenserResolved>(`dispenser:${id}`);
    const optimistic: DispenserResolved = {
      ...(prev ?? { id, siteId: body.siteId ?? '', status: 'active', source: 'manual' }),
      ...body,
      id,
      inStore: true,
    } as DispenserResolved;
    writeCache(`dispenser:${id}`, optimistic);
    return optimistic;
  }
}

export async function retireDispenser(token: string | null, id: string): Promise<DispenserResolved> {
  try {
    const saved = (await request(`/v1/dispensers/${encodeURIComponent(id)}/retire`, token, {
      method: 'POST',
      body: JSON.stringify({}),
    })) as DispenserResolved;
    writeCache(`dispenser:${id}`, saved);
    return saved;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    enqueueWrite('retireDispenser', { id });
    const prev = readCache<DispenserResolved>(`dispenser:${id}`);
    const optimistic = { ...(prev as DispenserResolved), id, status: 'retired' as const };
    writeCache(`dispenser:${id}`, optimistic);
    return optimistic;
  }
}

export async function getDispenserDetail(token: string | null, id: string): Promise<DispenserDetail> {
  return await rpc<DispenserDetail>('app_dispenser_detail', token, { p_dispenser_id: id });
}

export async function saveDispenserDetail(
  token: string | null,
  id: string,
  detail: Omit<DispenserDetail, 'dispenserId' | 'updatedAt'>,
): Promise<DispenserDetail> {
  try {
    const saved = (await request(`/v1/dispensers/${encodeURIComponent(id)}/detail`, token, {
      method: 'POST',
      body: JSON.stringify(detail),
    })) as DispenserDetail;
    writeCache(`dispenser-detail:${id}`, saved);
    return saved;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    enqueueWrite('saveDispenserDetail', { id, body: detail });
    const optimistic = { ...detail, dispenserId: id } as DispenserDetail;
    writeCache(`dispenser-detail:${id}`, optimistic);
    return optimistic;
  }
}
