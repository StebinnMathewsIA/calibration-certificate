/**
 * Device-binding keypair (#52): an EC P-256 keypair generated on first use
 * and kept in expo-secure-store (Android Keystore / iOS Keychain encrypted,
 * app-sandboxed). The private key never leaves the device; the public key is
 * enrolled with the backend, which then verifies every certificate upload was
 * signed by this physical device.
 *
 * v1 honesty note: the key is generated in software and protected at rest by
 * the secure store — strong, but not a non-exportable hardware keystore key.
 * Attested hardware keys are the upgrade path.
 */
import { Buffer } from '@craftzdog/react-native-buffer';
import * as SecureStore from 'expo-secure-store';
import QuickCrypto from 'react-native-quick-crypto';

const PRIVATE_KEY = 'prowalco.device.privkey';
const PUBLIC_KEY = 'prowalco.device.pubkey';

export interface DeviceKeyPair {
  publicKeyPem: string;
  privateKeyPem: string;
}

export async function getOrCreateDeviceKey(): Promise<DeviceKeyPair> {
  const [privateKeyPem, publicKeyPem] = await Promise.all([
    SecureStore.getItemAsync(PRIVATE_KEY),
    SecureStore.getItemAsync(PUBLIC_KEY),
  ]);
  if (privateKeyPem && publicKeyPem) return { privateKeyPem, publicKeyPem };

  let pair: { publicKey: string; privateKey: string };
  try {
    pair = QuickCrypto.generateKeyPairSync('ec', {
      namedCurve: 'P-256',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    }) as unknown as { publicKey: string; privateKey: string };
  } catch (err) {
    // Stage tag (#188): the queue card shows this message verbatim, so
    // a failure here reads differently from a failure while signing.
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`key generation failed: ${msg}`);
  }

  await SecureStore.setItemAsync(PRIVATE_KEY, pair.privateKey);
  await SecureStore.setItemAsync(PUBLIC_KEY, pair.publicKey);
  return { privateKeyPem: pair.privateKey, publicKeyPem: pair.publicKey };
}

/** ECDSA-SHA256 signature over `deviceId.timestamp.pdfSha256`, base64, the
 * exact message the backend reconstructs (backend/app/devices.py).
 *
 * quick-crypto is handed explicit bytes (#188): its update() treats a
 * bare string as buffer-encoded and throws "Cannot create a buffer from
 * a string with a buffer encoding" instead of assuming UTF-8 like Node,
 * which is what kept PWC-JHB-000023-00 in the headerless 403 loop. The
 * base64 of the signature is ours too, so sign() never converts. */
export function signDeviceMessage(privateKeyPem: string, message: string): string {
  const signature = QuickCrypto.createSign('SHA256')
    .update(Buffer.from(message, 'utf8') as unknown as Uint8Array)
    .sign({ key: privateKeyPem } as never);
  return Buffer.from(signature as unknown as Uint8Array).toString('base64');
}
