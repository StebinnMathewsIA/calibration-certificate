#!/usr/bin/env node
/**
 * Upload a build to Appetize.io and print the URL that runs it in a browser.
 *
 *   APPETIZE_API_TOKEN=... node scripts/appetize-upload.mjs --url https://.../app.apk
 *   APPETIZE_API_TOKEN=... node scripts/appetize-upload.mjs --file ./app.apk
 *
 * Options:
 *   --url <link>          Appetize fetches the artifact itself. Preferred:
 *                         nothing large moves through this process.
 *   --file <path>         Upload a local file instead.
 *   --platform <name>     android (default) or ios.
 *   --public-key <key>    Replace an existing Appetize app instead of creating
 *                         another, so its URL stays the same across builds.
 *                         Falls back to APPETIZE_PUBLIC_KEY.
 *   --note <text>         Free text shown in the Appetize dashboard.
 *
 * Env:
 *   APPETIZE_API_TOKEN    Required. appetize.io, Account, API.
 *   APPETIZE_PUBLIC_KEY   Optional, same as --public-key.
 *   APPETIZE_API_BASE     Optional override, default https://api.appetize.io/v1
 *
 * No npm dependencies: Node 18 or newer provides fetch, FormData and Blob.
 * Full context: docs/android-emulator.md
 */
import { readFile, appendFile } from 'node:fs/promises';
import { basename } from 'node:path';

const API_BASE = process.env.APPETIZE_API_BASE ?? 'https://api.appetize.io/v1';

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = 'true';
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

const token = process.env.APPETIZE_API_TOKEN;
if (!token) {
  fail(
    'APPETIZE_API_TOKEN is not set. Create a token at appetize.io (Account, API) ' +
      'and add it as the repository secret APPETIZE_API_TOKEN.',
  );
}

const platform = args.platform ?? 'android';
const publicKey = args['public-key'] ?? process.env.APPETIZE_PUBLIC_KEY ?? '';
const note = args.note ?? '';
const sourceUrl = args.url;
const sourceFile = args.file;

if (!sourceUrl && !sourceFile) fail('pass --url <link to the build> or --file <path to the build>');
if (sourceUrl && sourceFile) fail('pass only one of --url and --file');

// Creating posts to the collection, updating posts to the app itself.
const endpoint = publicKey ? `${API_BASE}/apps/${publicKey}` : `${API_BASE}/apps`;

let response;
if (sourceUrl) {
  response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'X-API-KEY': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: sourceUrl, platform, ...(note ? { note } : {}) }),
  });
} else {
  const bytes = await readFile(sourceFile).catch((error) =>
    fail(`cannot read ${sourceFile}: ${error.message}`),
  );
  const form = new FormData();
  form.set('file', new Blob([bytes]), basename(sourceFile));
  form.set('platform', platform);
  if (note) form.set('note', note);
  response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'X-API-KEY': token },
    body: form,
  });
}

const raw = await response.text();
let body = null;
try {
  body = JSON.parse(raw);
} catch {
  // Appetize returns HTML for some error classes. Keep `raw` for the report.
}

if (!response.ok) {
  console.error(`error: Appetize returned ${response.status} ${response.statusText}`);
  console.error(raw.slice(0, 2000));
  if (response.status === 401 || response.status === 403) {
    console.error('\nThe token was rejected. Check APPETIZE_API_TOKEN is current and not truncated.');
  }
  if (response.status === 404 && publicKey) {
    console.error(
      `\nNo app with public key ${publicKey} on this account. Clear APPETIZE_PUBLIC_KEY to create a new one.`,
    );
  }
  process.exit(1);
}

const key = body?.publicKey ?? publicKey;
const appUrl = body?.appURL ?? (key ? `https://appetize.io/app/${key}` : '');

if (!appUrl) {
  console.error('error: upload succeeded but the response carried no public key. Raw response:');
  console.error(raw.slice(0, 2000));
  process.exit(1);
}

console.log(publicKey ? 'Replaced the existing Appetize app.' : 'Created a new Appetize app.');
console.log(`Public key: ${key}`);
console.log(`Open it:    ${appUrl}`);
if (!publicKey) {
  console.log(
    '\nTo keep this URL stable across builds, save the public key as the\n' +
      'repository variable APPETIZE_PUBLIC_KEY (Settings, Secrets and variables,\n' +
      'Actions, Variables). Later runs will replace this app instead of adding another.',
  );
}

if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `public_key=${key}\napp_url=${appUrl}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    '## Running on Appetize',
    '',
    `**[Open the app in your browser](${appUrl})**`,
    '',
    `Platform: \`${platform}\`  Public key: \`${key}\``,
    '',
    'Biometrics, the camera and the signature pad are not real on a cloud',
    'device. Use a physical tablet for those (docs/TESTING.md).',
  ];
  if (!publicKey) {
    lines.push(
      '',
      `Save \`${key}\` as the repository variable \`APPETIZE_PUBLIC_KEY\` to keep this URL for future builds.`,
    );
  }
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}
