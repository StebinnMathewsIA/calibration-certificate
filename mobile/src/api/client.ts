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

export async function submitForSigning(
  token: string | null,
  submission: SignSubmission,
): Promise<SignResponse> {
  const body = await request('/v1/certificates/sign', token, {
    method: 'POST',
    body: JSON.stringify(submission),
  });
  return signResponseSchema.parse(body);
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
  const body = (await request('/v1/workorders', token)) as { workOrders: WorkOrderSummary[] };
  return body.workOrders;
}

export async function getWorkOrder(token: string | null, id: string): Promise<WorkOrderBundle> {
  return (await request(`/v1/workorders/${encodeURIComponent(id)}`, token)) as WorkOrderBundle;
}

export async function getSite(token: string | null, id: string): Promise<SiteResolved> {
  return (await request(`/v1/sites/${encodeURIComponent(id)}`, token)) as SiteResolved;
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
  return (await request(`/v1/dispensers/${encodeURIComponent(id)}`, token)) as DispenserResolved;
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
  return (await request(
    `/v1/dispensers/${encodeURIComponent(id)}/detail`,
    token,
  )) as DispenserDetail;
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
