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

/** Renders the certificate PDF on-device and computes its binary SHA-256
 * (queue integrity + upload verification). `customerSignatureSvg` is the
 * drawn client signature, embedded before the technician signs so it is
 * sealed inside the cryptographic signature. */
export async function renderCertificatePdf(
  verification: Verification,
  customerSignatureSvg?: string,
): Promise<RenderedPdf> {
  const { uri } = await Print.printToFileAsync({
    html: certificateHtml(verification, { customerSignatureSvg }),
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
