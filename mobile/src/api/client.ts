import type { AnalysisResponse, CalibrationForm, SignResponse, SignSubmission } from '@prowalco/schema';
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

export async function analyzeCalibration(
  token: string | null,
  form: CalibrationForm,
): Promise<AnalysisResponse> {
  const body = await request('/v1/analysis', token, {
    method: 'POST',
    body: JSON.stringify({ form }),
  });
  return analysisResponseSchema.parse(body);
}
