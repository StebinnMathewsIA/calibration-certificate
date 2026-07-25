import type {
  AnalysisResponse,
  DispenserDetail,
  SignResponse,
  SignSubmission,
  Verification,
  WorkOrderSeed,
} from '@prowalco/schema';
import { analysisResponseSchema, signResponseSchema } from '@prowalco/schema';
import { config } from '../config';
import { rpc } from './supabaseRpc';

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: unknown,
  ) {
    super(`API error ${status}`);
  }
}

async function request(path: string, token: string | null, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${config.apiUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body?.detail ?? body);
  return body;
}

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

/** The signed-in technician's record from the mined register (#62). */
export interface MyTechnician {
  staffCode: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  manager: string | null;
  pliersNumber: string | null;
  measures: {
    size: string;
    serialNumber: string;
    certificateNumber: string;
    calibrationDate: string;
    expiryDate: string;
  }[];
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
  body: { pliersNumber?: string; measures?: MyTechnician['measures'] },
): Promise<void> {
  await request('/v1/technicians/me', token, { method: 'PATCH', body: JSON.stringify(body) });
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
  return (await request(`/v1/sites/${encodeURIComponent(id)}`, token, {
    method: 'POST',
    body: JSON.stringify(body),
  })) as SiteResolved;
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
  return (await request('/v1/dispensers', token, {
    method: 'POST',
    body: JSON.stringify(body),
  })) as DispenserResolved;
}

export async function editDispenser(
  token: string | null,
  id: string,
  body: { make: string; model: string; serialNumber: string; saApprovalNumber: string; siteId?: string },
): Promise<DispenserResolved> {
  return (await request(`/v1/dispensers/${encodeURIComponent(id)}`, token, {
    method: 'POST',
    body: JSON.stringify(body),
  })) as DispenserResolved;
}

export async function retireDispenser(token: string | null, id: string): Promise<DispenserResolved> {
  return (await request(`/v1/dispensers/${encodeURIComponent(id)}/retire`, token, {
    method: 'POST',
    body: JSON.stringify({}),
  })) as DispenserResolved;
}

export async function getDispenserDetail(token: string | null, id: string): Promise<DispenserDetail> {
  return await rpc<DispenserDetail>('app_dispenser_detail', token, { p_dispenser_id: id });
}

export async function saveDispenserDetail(
  token: string | null,
  id: string,
  detail: Omit<DispenserDetail, 'dispenserId' | 'updatedAt'>,
): Promise<DispenserDetail> {
  return (await request(`/v1/dispensers/${encodeURIComponent(id)}/detail`, token, {
    method: 'POST',
    body: JSON.stringify(detail),
  })) as DispenserDetail;
}
