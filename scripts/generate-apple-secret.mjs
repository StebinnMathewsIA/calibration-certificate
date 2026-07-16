/**
 * Generate the "Sign in with Apple" client secret (an ES256-signed JWT) that
 * Supabase's Apple provider uses for the web / Android OAuth flow.
 *
 * The secret is valid for up to 6 months; regenerate and re-paste it into
 * Supabase (Authentication -> Providers -> Apple -> Secret Key) when it expires.
 *
 * Usage (from the repo root, Node 18+ — no npm install needed):
 *   node scripts/generate-apple-secret.mjs "C:\\path\\to\\AuthKey_GA4RN2TM9H.p8"
 *
 * The .p8 stays on your machine — nothing is uploaded. Do NOT commit the .p8
 * (it is gitignored) or the printed secret.
 */
import { readFileSync } from 'node:fs';
import { createPrivateKey, sign as ecdsaSign } from 'node:crypto';

// Prowalco "Sign in with Apple" configuration.
const TEAM_ID = '7N4395QGZ8'; // Apple Developer Team ID (iss)
const KEY_ID = 'GA4RN2TM9H'; // the Sign in with Apple key's Key ID (header.kid)
const SERVICES_ID = 'za.co.prowalco.calibration.signin'; // Services ID (sub)
const AUDIENCE = 'https://appleid.apple.com';
const VALID_SECONDS = 60 * 60 * 24 * 180; // ~6 months (Apple's maximum)

const p8Path = process.argv[2];
if (!p8Path) {
  console.error('Usage: node scripts/generate-apple-secret.mjs <path-to-AuthKey.p8>');
  process.exit(1);
}

const b64url = (input) => Buffer.from(input).toString('base64url');

let key;
try {
  key = createPrivateKey(readFileSync(p8Path));
} catch (err) {
  console.error(`Could not read the .p8 key at "${p8Path}": ${err.message}`);
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const header = { alg: 'ES256', kid: KEY_ID };
const payload = {
  iss: TEAM_ID,
  iat: now,
  exp: now + VALID_SECONDS,
  aud: AUDIENCE,
  sub: SERVICES_ID,
};

const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
// JOSE wants the raw R||S signature (ieee-p1363), not DER.
const signature = ecdsaSign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' });
const jwt = `${signingInput}.${b64url(signature)}`;

// The secret goes to stdout so you can pipe/copy it; the note goes to stderr.
process.stdout.write(jwt + '\n');
const expDate = new Date((now + VALID_SECONDS) * 1000).toISOString().slice(0, 10);
console.error(`\nApple client secret generated. Expires ${expDate}. Paste it into` +
  `\nSupabase -> Authentication -> Providers -> Apple -> Secret Key (for OAuth).`);
