/**
 * Exports the shared zod schemas as JSON Schema so the Python backend can
 * re-validate submissions against the exact same contract as the mobile app
 * ("validation parity", see CLAUDE.md).
 *
 * Run: npm run schema:export   (from the repo root)
 * Output is committed to shared/schema/json/ so the backend and its tests
 * never need a Node toolchain.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { calibrationFormSchema } from '../src/calibration';
import { signSubmissionSchema } from '../src/envelope';
import { analysisResultSchema } from '../src/analysis';

const outDir = join(__dirname, '..', 'json');
mkdirSync(outDir, { recursive: true });

const targets = {
  'calibration-form.schema.json': zodToJsonSchema(calibrationFormSchema, 'CalibrationForm'),
  'sign-submission.schema.json': zodToJsonSchema(signSubmissionSchema, 'SignSubmission'),
  'analysis-result.schema.json': zodToJsonSchema(analysisResultSchema, 'AnalysisResult'),
};

for (const [name, schema] of Object.entries(targets)) {
  const path = join(outDir, name);
  writeFileSync(path, JSON.stringify(schema, null, 2) + '\n');
  console.log(`wrote ${path}`);
}
