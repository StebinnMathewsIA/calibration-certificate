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

  const pair = QuickCrypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  }) as unknown as { publicKey: string; privateKey: string };

  await SecureStore.setItemAsync(PRIVATE_KEY, pair.privateKey);
  await SecureStore.setItemAsync(PUBLIC_KEY, pair.publicKey);
  return { privateKeyPem: pair.privateKey, publicKeyPem: pair.publicKey };
}

/** ECDSA-SHA256 signature over `deviceId.timestamp.pdfSha256`, base64 — the
 * exact message the backend reconstructs (backend/app/devices.py). */
export function signDeviceMessage(privateKeyPem: string, message: string): string {
  const signature = QuickCrypto.createSign('SHA256')
    .update(message)
    .sign({ key: privateKeyPem } as never, 'base64');
  return typeof signature === 'string' ? signature : String(signature);
}
