import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import type { Verification } from '@prowalco/schema';
import { sha256HexOfBase64 } from '../lib/bytes';
import { certificateHtml } from './certificateHtml';

export interface RenderedPdf {
  uri: string;
  base64: string;
  sha256: string;
}

// A4 landscape in PDF points (1 pt = 1/72 in). The iOS print renderer ignores
// the CSS @page size and falls back to 612x792 (US Letter portrait) unless the
// page size is passed here explicitly — keep in sync with @page in
// certificateHtml.ts.
const A4_LANDSCAPE = { width: 842, height: 595 };

/** Renders the certificate PDF on-device and computes its binary SHA-256
 * (queue integrity + upload verification). The client and VO signatures are
 * drawn images embedded before the technician cryptographically signs, so
 * they are sealed inside the PAdES signature. */
export async function renderCertificatePdf(
  verification: Verification,
  signatures: { customerSignatureSvg?: string; voSignatureSvg?: string } = {},
): Promise<RenderedPdf> {
  const { uri } = await Print.printToFileAsync({
    html: certificateHtml(verification, signatures),
    ...A4_LANDSCAPE,
  });
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return { uri, base64, sha256: sha256HexOfBase64(base64) };
}

export async function persistSignedPdf(
  certificateNumber: string,
  signedPdfBase64: string,
): Promise<string> {
  const dir = `${FileSystem.documentDirectory}certificates/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const uri = `${dir}${certificateNumber}.pdf`;
  await FileSystem.writeAsStringAsync(uri, signedPdfBase64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return uri;
}
