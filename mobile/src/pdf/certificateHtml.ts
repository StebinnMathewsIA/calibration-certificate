/**
 * NRCS Verification Certificate (Liquid Fuel Dispensers, LM01HV) rendered to
 * PDF by expo-print. Models both faces of Prowalco's real document: the
 * Verification Certificate (identity + components + sign-off) and the
 * Metrologist Note (per-hose checklist + EFD deliveries).
 *
 * The signature block bottom-left of the last page is intentionally left clear
 * — the backend places the visible PAdES signature widget there
 * (box 42,40 → 300,90).
 *
 * NUMBER FORMATTING CONTRACT: VFD/VREF are rendered as whole millilitres and
 * EFD to 2 dp. The backend cross-checks the VFD/VREF strings against the
 * verification JSON before signing (backend/app/signing/crosscheck.py) —
 * change both together.
 */
import type { Component, HoseResult, Verification } from '@prowalco/schema';
import { CHECKLIST_ITEMS, DELIVERY_POINT_LABELS } from '@prowalco/schema';
import { PROWALCO_LOGO_BASE64 } from '../../assets/logo-base64';

const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface RenderOptions {
  /** Accreditation mark slot — feature-flagged OFF until Prowalco holds
   * accreditation (CLAUDE.md "Branding"). */
  showAccreditationMark?: boolean;
  /** Drawn client signature as a standalone SVG string (embedded before the
   * technician's cryptographic signature so it is sealed inside it). */
  customerSignatureSvg?: string;
}

function componentRows(label: string, c: Component): string {
  return `
    <tr><td class="k">${esc(label)} — make</td><td>${esc(c.make ?? '')}</td>
        <td class="k">model</td><td>${esc(c.model ?? '')}</td></tr>
    <tr><td class="k">serial</td><td>${esc(c.serial ?? '')}</td>
        <td class="k">SA approval</td><td>${esc(c.saApproval ?? '')}</td></tr>`;
}

function checklistTable(hose: HoseResult): string {
  const rows = CHECKLIST_ITEMS.map((item) => {
    const v = hose.checklist[item.key];
    const cls = v === 'fail' ? 'fail' : v === 'pass' ? 'pass' : 'na';
    return `<tr><td>${esc(item.label)}</td><td class="${cls}">${v.toUpperCase()}</td></tr>`;
  }).join('');
  return `<table class="checklist"><tbody>${rows}</tbody></table>`;
}

function deliveriesTable(hose: HoseResult): string {
  const body = hose.deliveries
    .map(
      (d) => `
      <tr>
        <td>${esc(DELIVERY_POINT_LABELS[d.point])}</td>
        <td>${d.flowRateLpm.toFixed(1)}</td>
        <td>${d.vfdMl.toFixed(0)}</td>
        <td>${d.vrefMl.toFixed(0)}</td>
        <td class="${d.pass ? '' : 'oot'}">${d.efdPercent.toFixed(2)}</td>
        <td class="${d.pass ? 'pass' : 'fail'}">${d.pass ? 'PASS' : 'FAIL'}</td>
      </tr>`,
    )
    .join('');
  return `
    <table class="results">
      <thead><tr>
        <th>Delivery</th><th>Flow (L/min)</th><th>VFD (mL)</th>
        <th>VREF (mL)</th><th>EFD (%)</th><th>Result</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

function hoseSection(hose: HoseResult, i: number): string {
  const tot = [
    hose.totalizerBefore != null ? `before ${hose.totalizerBefore}` : '',
    hose.totalizerAfter != null ? `after ${hose.totalizerAfter}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return `
  <div class="hose">
    <h3>Hose / Pump ${esc(hose.hoseNumber)} — ${esc(hose.product)}</h3>
    <table class="detail">
      <tr><td class="k">Status</td><td>${esc(hose.status)}</td>
          <td class="k">Condition</td><td>${esc(hose.testCondition)}</td></tr>
      <tr><td class="k">Totalizer</td><td>${esc(tot || '—')}</td>
          <td class="k">Quantity delivered</td><td>${hose.quantityDelivered ?? '—'}</td></tr>
      <tr><td class="k">Qmin / Qmax (L/min)</td><td>${hose.qMinLpm ?? '—'} / ${hose.qMaxLpm ?? '—'}</td>
          <td class="k">Security seal</td><td>${esc(hose.securitySeal ?? '—')}</td></tr>
      ${componentRows('Meter', hose.components.meter)}
      ${componentRows('PC board', hose.components.pcBoard)}
      ${componentRows('Pulsar', hose.components.pulsar)}
      ${componentRows('Solenoid', hose.components.solenoid)}
    </table>
    <div class="two-col">
      <div>${checklistTable(hose)}</div>
      <div>${deliveriesTable(hose)}
        <p class="outcome ${hose.outcome === 'certified' ? 'pass' : 'fail'}">
          Instrument ${hose.outcome === 'certified' ? 'CERTIFIED (C)' : 'REJECTED (R)'}</p>
        ${hose.comments ? `<p class="cmt">${esc(hose.comments)}</p>` : ''}
      </div>
    </div>
  </div>`;
}

export function certificateHtml(v: Verification, opts: RenderOptions = {}): string {
  const { site, dispenser, referenceMeasures, hoses, signOff } = v;

  const measureRows = referenceMeasures
    .map(
      (m) => `
      <tr>
        <td>${esc(m.size)}</td><td>${esc(m.serialNumber)}</td><td>${esc(m.certificateNumber)}</td>
        <td>${esc(m.calibrationDate)}</td><td>${esc(m.expiryDate)}</td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4; margin: 16mm 12mm 20mm 12mm; }
  body { font-family: Helvetica, Arial, sans-serif; font-size: 9pt; color: #111; }
  header { display: flex; justify-content: space-between; align-items: flex-start;
           border-bottom: 2px solid #1a7a3a; padding-bottom: 6px; }
  header img.logo { height: 42px; }
  .titles { text-align: center; }
  .titles h1 { font-size: 14pt; letter-spacing: 1px; margin: 0; }
  .titles .sub { font-size: 9pt; color: #444; }
  .reg { font-size: 7.5pt; color: #555; text-align: right; }
  .certno { text-align: right; font-size: 11pt; font-weight: bold; color: #b00020; }
  h3 { font-size: 10pt; border-bottom: 1px solid #999; margin: 12px 0 4px; }
  table { width: 100%; border-collapse: collapse; }
  table.detail td { padding: 2px 4px; vertical-align: top; }
  table.detail td.k { width: 16%; color: #444; font-size: 8pt; }
  table.results th, table.results td, table.standards th, table.standards td,
  table.checklist td {
    border: 1px solid #999; padding: 3px 5px; text-align: right; }
  table.results th, table.standards th { background: #eef4ee; text-align: center; }
  table.standards td { text-align: left; }
  table.checklist td { text-align: left; font-size: 8pt; }
  table.checklist td:last-child { text-align: center; width: 42px; font-weight: bold; }
  td.pass { color: #1a7a3a; font-weight: bold; text-align: center; }
  td.fail, td.oot { color: #b00020; font-weight: bold; text-align: center; }
  td.na { color: #777; text-align: center; }
  .two-col { display: flex; gap: 10px; margin-top: 6px; }
  .two-col > div { flex: 1; }
  .hose { border: 1px solid #ccc; border-radius: 4px; padding: 6px 8px; margin-top: 10px; }
  .outcome { font-weight: bold; margin: 6px 0 0; }
  .cmt { font-size: 8pt; color: #444; }
  .clauses { font-size: 8pt; color: #444; margin-top: 12px; }
  .sigblock { margin-top: 22px; display: flex; justify-content: space-between; }
  .sigslot { width: 46%; }
  .sigslot .line { border-top: 1px solid #333; margin-top: 40px; padding-top: 3px; font-size: 8.5pt; }
  .sig-img { height: 70px; }
  .digital-note { font-size: 7.5pt; color: #666; }
  .end { text-align: center; font-weight: bold; letter-spacing: 2px; margin-top: 16px; }
  footer { position: fixed; bottom: -13mm; left: 0; right: 0; font-size: 7.5pt;
           color: #555; text-align: center; border-top: 1px solid #ccc; padding-top: 3px; }
</style>
</head>
<body>
<header>
  <img class="logo" src="data:image/png;base64,${PROWALCO_LOGO_BASE64}" alt="Prowalco TATSUNO" />
  <div class="titles">
    <h1>VERIFICATION CERTIFICATE</h1>
    <div class="sub">LIQUID FUEL DISPENSERS · NRCS Designated Verification LM01HV</div>
  </div>
  <div class="reg">
    ${opts.showAccreditationMark ? '<em>[Accreditation mark]</em><br/>' : ''}
    ${v.nrcsBookNumber ? `<div class="certno">${esc(v.nrcsBookNumber)}</div>` : ''}
    Cert: ${esc(v.certificateNumber)}
  </div>
</header>

<table class="detail">
  <tr><td class="k">Name (User)</td><td>${esc(site.siteName)}</td>
      <td class="k">Oil Company</td><td>${esc(site.customerName)}</td></tr>
  <tr><td class="k">Address</td><td colspan="3">${esc(site.address)}${site.telephone ? ` · Tel: ${esc(site.telephone)}` : ''}</td></tr>
  <tr><td class="k">Job Ref.</td><td>${esc(v.jobReference ?? '')}</td>
      <td class="k">Report type</td><td>${esc(v.reportType)}</td></tr>
</table>

<h3>Reference measures used (traceable to the national standard)</h3>
<table class="standards">
  <thead><tr><th>Measure</th><th>Serial no.</th><th>Certificate no.</th><th>Cal. date</th><th>Exp. date</th></tr></thead>
  <tbody>${measureRows}</tbody>
</table>
<p class="clauses">Method: ${esc(v.methodReference)}</p>

<h3>Dispenser (LFD)</h3>
<table class="detail">
  <tr><td class="k">Make &amp; model</td><td>${esc(dispenser.makeModel)}</td>
      <td class="k">Serial no.</td><td>${esc(dispenser.serialNumber)}</td></tr>
  <tr><td class="k">SA approval no.</td><td>${esc(dispenser.saApprovalNumber)}</td>
      <td class="k">Security seal no.</td><td>${esc(dispenser.securitySealNumber ?? '')}</td></tr>
</table>

${hoses.map(hoseSection).join('')}

<div class="clauses">
  <p>The measuring instrument(s) was/were tested and found to comply in all respects with the
  requirements of the Legal Metrology Act, 2014 (Act No. 9 of 2014) and may be used for a
  prescribed purpose as intended by the Act.</p>
  <p>This certificate may only be reproduced in full and is valid at the time of verification.
  The embedded digital signature and trusted timestamp are the authoritative record of issue —
  an unsigned copy of this document is not a certificate.</p>
</div>

<div class="sigblock">
  <div class="sigslot">
    <!-- Visible PAdES signature widget is applied here by the signing service -->
    <div class="digital-note">Digital signature panel — applied at issue</div>
    <div class="line">VO (Initial &amp; Surname): ${esc(signOff.vo.identity.name)}
      · Pliers No.: ${esc(signOff.vo.pliersNumber)}</div>
    ${signOff.expiryDate ? `<div class="digital-note">Expiry date of certificate: ${esc(signOff.expiryDate)}</div>` : ''}
    ${signOff.rejectionCertNumber ? `<div class="digital-note">Rejection Cert. No.: ${esc(signOff.rejectionCertNumber)}</div>` : ''}
  </div>
  <div class="sigslot">
    ${opts.customerSignatureSvg ? `<div class="sig-img">${opts.customerSignatureSvg}</div>` : ''}
    <div class="line">Client (Initial &amp; Surname): ${esc(signOff.client.name)}</div>
  </div>
</div>

<div class="end">— END OF VERIFICATION CERTIFICATE —</div>

<footer>
  Prowalco (Pty) Ltd · 2 Cedar Street, Lords View Industrial Park, Midrand 1619 · Tel: (011) 617 6000
</footer>
</body>
</html>`;
}
