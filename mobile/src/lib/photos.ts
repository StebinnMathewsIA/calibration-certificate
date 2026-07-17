import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import type { CalibrationForm } from '@prowalco/schema';
import { sha256HexOfBase64 } from './bytes';

export type PhotoRef = CalibrationForm['results']['photos'][number];

const PHOTOS_DIR = () => `${FileSystem.documentDirectory}photos/`;

/** Local file for a photo ref — the path is derived from the id so the form
 * payload only needs to carry {id, kind, capturedAt, sha256}. */
export const photoUriForId = (id: string) => `${PHOTOS_DIR()}${id}.jpg`;

/** Copy a camera capture into app storage and build its audit-trail ref
 * (content-addressed by SHA-256, like the certificate PDF). */
export async function persistPhoto(tempUri: string, kind: PhotoRef['kind']): Promise<PhotoRef> {
  const id = Crypto.randomUUID();
  await FileSystem.makeDirectoryAsync(PHOTOS_DIR(), { intermediates: true }).catch(() => {});
  const uri = photoUriForId(id);
  await FileSystem.copyAsync({ from: tempUri, to: uri });
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return { id, kind, capturedAt: new Date().toISOString(), sha256: sha256HexOfBase64(base64) };
}

export async function deletePhoto(id: string): Promise<void> {
  await FileSystem.deleteAsync(photoUriForId(id), { idempotent: true }).catch(() => {});
}
