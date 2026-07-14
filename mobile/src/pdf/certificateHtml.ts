/**
 * SANAS-style certificate HTML template rendered to PDF by expo-print.
 *
 * Layout order follows CLAUDE.md "Certificate PDF content": header/logo,
 * title + number, details, standards table, procedure/traceability/
 * uncertainty, results tables, clauses, footer with page numbers and
 * "END OF CERTIFICATE". The signature block bottom-left of the last page is
 * intentionally left clear — the backend places the visible PAdES signature
 * widget there (box 42,40 → 300,90).
 *
 * NUMBER FORMATTING CONTRACT: volumes 3 dp, error mL 1 dp, error % 3 dp.
 * The backend cross-checks these strings against the form JSON before
 * signing (backend/app/signing/crosscheck.py) — change both together.
 */
import type { CalibrationForm, ResultRow } from '@prowalco/schema';
import { TOLERANCE_CLASSES } from '@prowalco/schema';
import { PROWALCO_LOGO_BASE64 } from '../../assets/logo-base64';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const PRODUCT_LABELS: Record<string, string> = {
  ulp_93: 'ULP 93',
  ulp_95: 'ULP 95',
  diesel_50ppm: 'Diesel 50ppm',
  diesel_500ppm: 'Diesel 500ppm',
  paraffin: 'Paraffin',
  other: 'Other',
};

const EQUIPMENT_LABELS: Record<string, string> = {
  fuel_dispenser: 'Fuel dispenser',
  pump: 'Pump',
  flow_meter: 'Flow meter',
  pressure_transmitter: 'Pressure transmitter',
  other: 'Other',
};

function resultsTable(rows: ResultRow[], title: string): string {
  const body = rows
    .map(
      (r) => `
      <tr>
        <td>${r.nominalDeliveryL.toFixed(2)}</td>
        <td>${r.flowRateLpm.toFixed(1)}</td>
        <td>${r.indicatedVolumeL.toFixed(3)}</td>
        <td>${r.measuredVolumeL.toFixed(3)}</td>
        <td>${r.errorMl.toFixed(1)}</td>
        <td class="${r.pass ? '' : 'oot'}">${r.errorPercent.toFixed(3)}</td>
        <td>±${(TOLERANCE_CLASSES[r.toleranceClassId]?.mpePercent ?? 0).toFixed(2)} %</td>
        <td class="${r.pass ? 'pass' : 'fail'}">${r.pass ? 'PASS' : 'FAIL'}</td>
      </tr>`,
    )
    .join('');
  return `
    <h3>${esc(title)}</h3>
    <table class="results">
      <thead>
        <tr>
          <th>Nominal (L)</th><th>Flow (L/min)</th><th>Indicated (L)</th>
          <th>Measured (L)</th><th>Error (mL)</th><th>Error (%)</th>
          <th>MPE</th><th>Result</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;
}

export interface RenderOptions {
  /** Accreditation mark slot — feature-flagged OFF until Prowalco holds
   * accreditation (CLAUDE.md "Branding"). */
  showAccreditationMark?: boolean;
}

export function certificateHtml(form: CalibrationForm, opts: RenderOptions = {}): string {
  const { job, uut, referenceStandards, environment, results, signOff } = form;

  const standardsRows = referenceStandards
    .map(
      (s) => `
      <tr>
        <td>${esc(s.description)}</td>
        <td>${esc(s.serialNumber)}</td>
        <td>${esc(s.certificateNumber)}</td>
        <td>${esc(s.calibrationDueDate)}</td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4; margin: 18mm 15mm 22mm 15mm; }
  body { font-family: Helvetica, Arial, sans-serif; font-size: 9.5pt; color: #111; }
  header { display: flex; justify-content: space-between; align-items: flex-start;
           border-bottom: 2px solid #1a7a3a; padding-bottom: 6px; }
  header img.logo { height: 44px; }
  .reg { font-size: 7.5pt; color: #555; text-align: right; }
  h1 { text-align: center; font-size: 15pt; letter-spacing: 2px; margin: 14px 0 2px; }
  .certno { text-align: center; font-size: 11pt; font-weight: bold; margin-bottom: 12px; }
  h3 { font-size: 10pt; border-bottom: 1px solid #999; margin: 14px 0 4px; }
  table { width: 100%; border-collapse: collapse; }
  table.detail td { padding: 2px 4px; vertical-align: top; }
  table.detail td.k { width: 32%; color: #444; }
  table.results th, table.results td, table.standards th, table.standards td {
    border: 1px solid #999; padding: 3px 5px; text-align: right; }
  table.results th, table.standards th { background: #eef4ee; text-align: center; }
  table.standards td { text-align: left; }
  td.pass { color: #1a7a3a; font-weight: bold; text-align: center; }
  td.fail, td.oot { color: #b00020; font-weight: bold; text-align: center; }
  .clauses { font-size: 8pt; color: #444; margin-top: 12px; }
  .sigblock { margin-top: 28px; display: flex; justify-content: space-between; }
  .sigslot { width: 46%; }
  .sigslot .line { border-top: 1px solid #333; margin-top: 56px; padding-top: 3px; font-size: 8.5pt; }
  .digital-note { font-size: 7.5pt; color: #666; }
  .end { text-align: center; font-weight: bold; letter-spacing: 2px; margin-top: 18px; }
  footer { position: fixed; bottom: -14mm; left: 0; right: 0; font-size: 7.5pt;
           color: #555; text-align: center; border-top: 1px solid #ccc; padding-top: 3px; }
</style>
</head>
<body>
<header>
  <img class="logo" src="data:image/png;base64,${PROWALCO_LOGO_BASE64}" alt="Prowalco TATSUNO" />
  <div class="reg">
    Prowalco (Pty) Ltd — Reg. 20XX/XXXXXX/07<br/>
    ${opts.showAccreditationMark ? '<em>[Accreditation mark]</em>' : ''}
  </div>
</header>

<h1>CERTIFICATE OF CALIBRATION</h1>
<div class="certno">Certificate number: ${esc(job.certificateNumber)}</div>

<h3>Customer &amp; job details</h3>
<table class="detail">
  <tr><td class="k">Customer</td><td>${esc(job.customerName)}</td></tr>
  <tr><td class="k">Site address</td><td>${esc(job.siteAddress)}</td></tr>
  ${job.siteAssetNumber ? `<tr><td class="k">Site / asset number</td><td>${esc(job.siteAssetNumber)}</td></tr>` : ''}
  ${job.workOrderNumber ? `<tr><td class="k">Work order</td><td>${esc(job.workOrderNumber)}</td></tr>` : ''}
  <tr><td class="k">Date of calibration</td><td>${esc(job.calibrationDate)}</td></tr>
  <tr><td class="k">Date of issue</td><td>Date of digital signature (see signature panel)</td></tr>
</table>

<h3>Unit under test</h3>
<table class="detail">
  <tr><td class="k">Equipment type</td><td>${esc(EQUIPMENT_LABELS[uut.equipmentType] ?? uut.equipmentType)}</td></tr>
  <tr><td class="k">Manufacturer / model</td><td>${esc(uut.manufacturer)} ${esc(uut.modelNumber)}</td></tr>
  <tr><td class="k">Serial number</td><td>${esc(uut.serialNumber)}</td></tr>
  ${uut.nozzleId ? `<tr><td class="k">Pump / hose / nozzle</td><td>${esc(uut.nozzleId)}</td></tr>` : ''}
  <tr><td class="k">Product / grade</td><td>${esc(PRODUCT_LABELS[uut.productGrade] ?? uut.productGrade)}</td></tr>
  ${uut.meterKFactorBefore != null ? `<tr><td class="k">Meter K-factor (before)</td><td>${uut.meterKFactorBefore}</td></tr>` : ''}
  ${results.meterKFactorAfter != null ? `<tr><td class="k">Meter K-factor (after)</td><td>${results.meterKFactorAfter}</td></tr>` : ''}
</table>

<h3>Reference standards used</h3>
<table class="standards">
  <thead><tr><th>Description</th><th>Serial no.</th><th>Certificate no.</th><th>Cal. due</th></tr></thead>
  <tbody>${standardsRows}</tbody>
</table>
<p class="clauses">All reference standards are traceable to national measurement standards
through an unbroken chain of calibrations.</p>

<h3>Method &amp; conditions</h3>
<table class="detail">
  <tr><td class="k">Procedure</td><td>${esc(environment.procedureRef)}</td></tr>
  <tr><td class="k">Ambient temperature</td><td>${environment.ambientTempC.toFixed(1)} °C</td></tr>
  <tr><td class="k">Product temperature</td><td>${environment.productTempC.toFixed(1)} °C</td></tr>
  <tr><td class="k">Condition of UUT</td><td>${esc(environment.uutCondition)}${environment.conditionNotes ? ` — ${esc(environment.conditionNotes)}` : ''}</td></tr>
  <tr><td class="k">Uncertainty</td><td>${esc(results.uncertaintyStatement)}</td></tr>
</table>

${resultsTable(results.asFound, 'Results — as found')}
${results.asLeft && results.asLeft.length ? resultsTable(results.asLeft, 'Results — as left (after adjustment)') : ''}

${results.remarks ? `<h3>Remarks</h3><p>${esc(results.remarks)}</p>` : ''}
${
  results.verificationSealNumbers.length
    ? `<p><strong>Verification seal(s):</strong> ${results.verificationSealNumbers.map(esc).join(', ')}</p>`
    : ''
}

<div class="clauses">
  <p>This certificate may only be reproduced in full. Results relate only to the
  item calibrated and are valid at the time of calibration.</p>
  <p>This certificate is digitally signed. The embedded digital signature and
  trusted timestamp are the authoritative record of issue; an unsigned copy of
  this document is not a certificate.</p>
</div>

<div class="sigblock">
  <div class="sigslot">
    <!-- Visible PAdES signature widget is applied here by the signing service -->
    <div class="digital-note">Digital signature panel — applied at issue</div>
    <div class="line">Calibrated by: ${esc(signOff.calibratedBy.name)}</div>
  </div>
  <div class="sigslot">
    <div class="line">Technical signatory: ${esc(signOff.technicalSignatory.name)}</div>
  </div>
</div>

<div class="end">— END OF CERTIFICATE —</div>

<footer>
  Prowalco (Pty) Ltd · Tatsuno distributor — Southern Africa · info@prowalco.co.za · +27 (0)11 000 0000
</footer>
</body>
</html>`;
}
