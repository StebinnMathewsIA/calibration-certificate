/**
 * NRCS Verification Certificate for Liquid Fuel Dispensers (LM01HV), rendered
 * to PDF by expo-print to match Prowalco's real document:
 *   Page 1 — the Verification Certificate (the LM01HV grid: traceability box,
 *            per-hose Meter / PC Board / Pulsar / Solenoid grid, sign-off).
 *   Page 2 — the Metrologist Note (per-hose pass/fail checklist + EFD
 *            deliveries) — the reporting-of-results working record.
 *
 * The visible PAdES signature widget is applied by the backend at the
 * bottom-left of the FIRST page (box 42,40 → 300,90), landing in the VO
 * signature area of the certificate.
 *
 * NUMBER FORMATTING CONTRACT: VFD/VREF are rendered as whole millilitres and
 * EFD to 2 dp. The backend cross-checks the certificate number, VO name,
 * customer, dispenser serial and the VFD/VREF strings against the verification
 * JSON before signing (backend/app/signing/crosscheck.py) — change together.
 */
import type { Component, HoseResult, ReferenceMeasure, Verification } from '@prowalco/schema';
import { CHECKLIST_ITEMS, DELIVERY_POINT_LABELS } from '@prowalco/schema';
import { PROWALCO_LOGO_BASE64 } from '../../assets/logo-base64';

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A grid cell that shows a non-breaking space when empty (like the blank form). */
const cell = (v: unknown) => {
  const s = esc(v);
  return s.trim() === '' ? '&nbsp;' : s;
};

export interface RenderOptions {
  /** Accreditation mark slot — feature-flagged OFF until Prowalco holds
   * accreditation (CLAUDE.md "Branding"). */
  showAccreditationMark?: boolean;
  /** Drawn client signature as a standalone SVG string (embedded before the
   * technician's cryptographic signature so it is sealed inside it). */
  customerSignatureSvg?: string;
}

const num = (v: number | undefined, dp = 0) => (v == null ? '' : v.toFixed(dp));

function measureCells(measures: ReferenceMeasure[], size: ReferenceMeasure['size']) {
  return measures.find((m) => m.size === size);
}

// ---------------------------------------------------------------------------
// Page 1 — the certificate grid (Meter / PC Board / Pulsar / Solenoid)
// ---------------------------------------------------------------------------

const COMPONENT_ROWS: {
  group: string;
  key: keyof HoseResult['components'];
}[] = [
  { group: 'Meter', key: 'meter' },
  { group: 'PC Board', key: 'pcBoard' },
  { group: 'Pulsar', key: 'pulsar' },
  { group: 'Solenoid Valve', key: 'solenoid' },
];

const COMPONENT_FIELDS: { label: string; field: keyof Component }[] = [
  { label: 'Make', field: 'make' },
  { label: 'Model', field: 'model' },
  { label: 'Serial No.', field: 'serial' },
  { label: 'SA Approval no.', field: 'saApproval' },
];

function certificateGrid(hoses: HoseResult[]): string {
  const hoseCols = (render: (h: HoseResult) => string) =>
    hoses.map((h) => `<td class="v">${render(h)}</td>`).join('');

  const componentGroup = (group: string, key: keyof HoseResult['components']) => {
    const rows = COMPONENT_FIELDS.map((f, idx) => {
      const rot =
        idx === 0
          ? `<td class="rot" rowspan="4"><span>${esc(group)}</span></td>`
          : '';
      return `<tr>${rot}<td class="lbl">${esc(f.label)}</td>${hoseCols(
        (h) => cell(h.components[key][f.field]),
      )}</tr>`;
    });
    return rows.join('');
  };

  return `
  <table class="grid">
    <tr>
      <td class="lbl" colspan="2">Hose/ Pump No.</td>
      ${hoseCols((h) => cell(h.hoseNumber))}
    </tr>
    <tr>
      <td class="lbl" colspan="2">Product:</td>
      ${hoseCols((h) => cell(h.product))}
    </tr>
    ${COMPONENT_ROWS.map((c) => componentGroup(c.group, c.key)).join('')}
  </table>`;
}

// ---------------------------------------------------------------------------
// Page 2 — Metrologist Note (checklist + EFD deliveries), per hose
// ---------------------------------------------------------------------------

function checklistTable(hose: HoseResult): string {
  const rows = CHECKLIST_ITEMS.map((item) => {
    const v = hose.checklist[item.key];
    const cls = v === 'fail' ? 'fail' : v === 'pass' ? 'pass' : 'na';
    return `<tr><td>${esc(item.label)}</td><td class="${cls}">${String(v ?? '').toUpperCase()}</td></tr>`;
  }).join('');
  return `<table class="mtable"><tbody>${rows}</tbody></table>`;
}

function deliveriesTable(hose: HoseResult): string {
  const body = hose.deliveries
    .map(
      (d) => `
      <tr>
        <td class="dl">${esc(DELIVERY_POINT_LABELS[d.point])}</td>
        <td>${num(d.flowRateLpm, 1)}</td>
        <td>${num(d.vfdMl)}</td>
        <td>${num(d.vrefMl)}</td>
        <td class="${d.pass ? '' : 'oot'}">${num(d.efdPercent, 2)}</td>
        <td class="${d.pass ? 'pass' : 'fail'}">${d.pass ? 'PASS' : 'FAIL'}</td>
      </tr>`,
    )
    .join('');
  return `
    <table class="mtable results">
      <thead><tr>
        <th>Delivery</th><th>Flow<br/>(L/min)</th><th>VFD<br/>(mL)</th>
        <th>VREF<br/>(mL)</th><th>EFD<br/>(%)</th><th>Result</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

function metrologistHose(hose: HoseResult): string {
  const tot = [
    hose.totalizerBefore != null ? `Before: ${esc(hose.totalizerBefore)}` : '',
    hose.totalizerAfter != null ? `After: ${esc(hose.totalizerAfter)}` : '',
  ]
    .filter(Boolean)
    .join(' &nbsp; ');
  return `
  <div class="mhose">
    <div class="mhose-h">Hose/Pump ${esc(hose.hoseNumber)} — ${esc(hose.product)}
      &nbsp;·&nbsp; ${esc(hose.status)} &nbsp;·&nbsp; ${esc(hose.testCondition)}</div>
    <div class="mmeta">${tot || '&nbsp;'} &nbsp; Quantity delivered: ${esc(hose.quantityDelivered ?? '')}
      &nbsp; Qmin/Qmax: ${esc(hose.qMinLpm ?? '')} / ${esc(hose.qMaxLpm ?? '')} L/min</div>
    <div class="two-col">
      <div>${checklistTable(hose)}</div>
      <div>
        ${deliveriesTable(hose)}
        <p class="outcome ${hose.outcome === 'certified' ? 'pass' : 'fail'}">
          Instrument ${hose.outcome === 'certified' ? 'CERTIFIED (C)' : 'REJECTED (R)'}</p>
        ${hose.comments ? `<p class="cmt">${esc(hose.comments)}</p>` : ''}
      </div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------

export function certificateHtml(v: Verification, opts: RenderOptions = {}): string {
  const { site, dispenser, referenceMeasures, hoses, signOff } = v;
  const m200 = measureCells(referenceMeasures, '200L');
  const m20 = measureCells(referenceMeasures, '20L');
  const m5 = measureCells(referenceMeasures, '5L');
  const traceRow = (m?: ReferenceMeasure) =>
    `${cell(m?.serialNumber)}`;
  const traceCert = (m?: ReferenceMeasure) =>
    `${cell(m?.certificateNumber)}`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4; margin: 9mm 8mm; }
  body { font-family: Helvetica, Arial, sans-serif; font-size: 8pt; color: #000; }
  .page-break { page-break-before: always; }

  header { display: flex; justify-content: space-between; align-items: flex-start; }
  header img.logo { height: 44px; }
  header .reg { font-size: 6.5pt; color: #333; margin-top: 2px; }
  header .mid { text-align: center; flex: 1; padding: 0 6px; }
  header .mid h1 { font-size: 15pt; font-weight: bold; letter-spacing: 1px; margin: 0; }
  header .mid .sub { font-size: 8.5pt; font-weight: bold; }
  header .nrcs { text-align: right; font-size: 6.5pt; color: #333; min-width: 150px; }
  header .nrcs .n { font-size: 12pt; font-weight: bold; color: #e35205; letter-spacing: 1px; }
  header .nrcs .lm { color: #e35205; font-weight: bold; }
  .addr { text-align: center; font-size: 7pt; margin: 2px 0 6px; }

  .userline { display: flex; gap: 10px; margin: 6px 0; font-size: 8.5pt; }
  .userline .f { flex: 1; border-bottom: 1px solid #000; padding-bottom: 1px; }
  .userline .k { color: #333; }

  .trace { background: #e9e9e9; border: 1px solid #bbb; padding: 5px 6px; margin-top: 4px; }
  .trace .t { text-align: center; text-decoration: underline; font-weight: bold; font-size: 7.5pt; margin-bottom: 4px; }
  table.tr3 { width: 100%; border-collapse: collapse; font-size: 7.5pt; }
  table.tr3 td { padding: 1px 4px; vertical-align: bottom; }
  table.tr3 .lab { width: 32%; }
  table.tr3 .u { border-bottom: 1px solid #000; }

  .method { font-size: 7.5pt; font-weight: bold; margin: 6px 0 2px; }

  table.grid, table.idgrid { width: 100%; border-collapse: collapse; }
  table.grid td, table.idgrid td { border: 1px solid #000; padding: 2px 4px; font-size: 7.5pt; }
  table.idgrid td.lbl, table.grid td.lbl { font-weight: bold; white-space: nowrap; background: #f4f4f4; }
  table.grid td.v { text-align: left; }
  td.rot { width: 16px; text-align: center; background: #f4f4f4; }
  td.rot span { writing-mode: vertical-rl; transform: rotate(180deg); font-weight: bold; font-size: 7.5pt; }

  .comply { font-size: 7pt; margin-top: 8px; }

  table.sign { width: 100%; border-collapse: collapse; margin-top: 14px; }
  table.sign td { text-align: center; font-size: 8pt; padding: 0 4px; }
  table.sign td.val { border-bottom: 1px solid #000; height: 34px; vertical-align: bottom; padding-bottom: 2px; }
  table.sign td.lab { font-size: 6.8pt; color: #333; padding-top: 2px; }
  .sig-img { height: 30px; }
  .digital-note { font-size: 6.8pt; color: #666; }
  .end { text-align: center; font-weight: bold; letter-spacing: 2px; margin: 10px 0; font-size: 8pt; }

  footer { text-align: center; font-size: 6.8pt; color: #444; border-top: 1px solid #ccc;
           padding-top: 3px; margin-top: 8px; }
  .rev { position: fixed; right: 2mm; bottom: 40mm; writing-mode: vertical-rl; font-size: 6pt; color: #777; }

  /* Page 2 — Metrologist Note */
  .mtitle { text-align: center; font-weight: bold; font-size: 11pt; margin-bottom: 2px; }
  .msub { text-align: center; font-size: 8pt; margin-bottom: 6px; }
  .mhose { border: 1px solid #999; border-radius: 3px; padding: 5px 7px; margin-top: 8px; }
  .mhose-h { font-weight: bold; font-size: 8.5pt; }
  .mmeta { font-size: 7pt; color: #333; margin: 2px 0 4px; }
  .two-col { display: flex; gap: 10px; }
  .two-col > div { flex: 1; }
  table.mtable { width: 100%; border-collapse: collapse; }
  table.mtable td, table.mtable th { border: 1px solid #999; padding: 2px 4px; font-size: 7pt; }
  table.mtable td:first-child { text-align: left; }
  table.mtable td { text-align: right; }
  table.results th { background: #eef4ee; text-align: center; }
  table.mtable td.dl { text-align: left; }
  td.pass { color: #1a7a3a; font-weight: bold; text-align: center; }
  td.fail, td.oot { color: #b00020; font-weight: bold; text-align: center; }
  td.na { color: #777; text-align: center; }
  .outcome { font-weight: bold; margin: 5px 0 0; }
  .cmt { font-size: 7pt; color: #444; }
</style>
</head>
<body>

<!-- ================= PAGE 1 — VERIFICATION CERTIFICATE ================= -->
<header>
  <div>
    <img class="logo" src="data:image/png;base64,${PROWALCO_LOGO_BASE64}" alt="Prowalco TATSUNO" />
    <div class="reg">Reg. No. 2001/000701/07</div>
  </div>
  <div class="mid">
    <h1>VERIFICATION CERTIFICATE</h1>
    <div class="sub">LIQUID FUEL DISPENSERS</div>
    <div class="addr">2 Cedar Street, Lords View Industrial Park, Midrand 1619 SOUTH AFRICA ·
      Tel: (011) 617 6000 · Fax: (011) 617 6099</div>
  </div>
  <div class="nrcs">
    ${opts.showAccreditationMark ? '<em>[Accreditation mark]</em><br/>' : ''}
    <span class="n">NRCS</span><br/>national regulator for<br/>compulsory specifications<br/>
    <span class="lm">DESIGNATED VERIFICATION | LM01HV</span><br/>
    Cert No.: ${esc(v.certificateNumber)}${v.nrcsBookNumber ? ` · ${esc(v.nrcsBookNumber)}` : ''}
  </div>
</header>

<div class="userline">
  <div class="f"><span class="k">Name (User):</span> ${cell(site.siteName)}</div>
  <div class="f"><span class="k">Oil Company:</span> ${cell(site.customerName)}</div>
  <div class="f"><span class="k">Address:</span> ${cell(site.address)}${site.telephone ? ` · Tel: ${esc(site.telephone)}` : ''}</div>
</div>

<div class="trace">
  <div class="t">The measures used for this verification are traceable to the national Standard
    through the following Calibration Certificates:</div>
  <table class="tr3">
    <tr>
      <td class="lab">S/N's of standard measures used (only own equipment is used):</td>
      <td class="u">200L ${traceRow(m200)}</td>
      <td class="u">20L ${traceRow(m20)}</td>
      <td class="u">5L ${traceRow(m5)}</td>
    </tr>
    <tr>
      <td class="lab">Certificate No. of measures used (Only own equipment is used):</td>
      <td class="u">200L ${traceCert(m200)} &nbsp; Cal. date ${cell(m200?.calibrationDate)}</td>
      <td class="u">20L ${traceCert(m20)} &nbsp; Cal. date ${cell(m20?.calibrationDate)}</td>
      <td class="u">5L ${traceCert(m5)} &nbsp; Cal. date ${cell(m5?.calibrationDate)}</td>
    </tr>
    <tr>
      <td class="lab">&nbsp;</td>
      <td class="u">Exp. date ${cell(m200?.expiryDate)}</td>
      <td class="u">Exp. date ${cell(m20?.expiryDate)}</td>
      <td class="u">Exp. date ${cell(m5?.expiryDate)}</td>
    </tr>
  </table>
</div>

<div class="method">Method for Liquid Fuel Dispensers: Test Procedures SANS Test Proc 01 &amp;
  SANS Test Proc 02 based on LM-IR 117-2: 2023</div>

<table class="idgrid">
  <tr>
    <td class="rot" rowspan="2"><span>LFD Description</span></td>
    <td class="lbl">Make &amp; Model</td><td>${cell(dispenser.makeModel)}</td>
    <td class="lbl">Serial No.:</td><td>${cell(dispenser.serialNumber)}</td>
  </tr>
  <tr>
    <td class="lbl">SA Approval No.</td><td>${cell(dispenser.saApprovalNumber)}</td>
    <td class="lbl">Security Seal No.:</td><td>${cell(dispenser.securitySealNumber)}</td>
  </tr>
</table>

${certificateGrid(hoses)}

<div class="comply">The measuring instrument(s) was/were tested and found to comply in all respects
  with the requirements of the Legal Metrology Act, 2014 (Act No. 9 of 2014) and may be used for a
  prescribed purpose as intended by the Act.</div>

<table class="sign">
  <tr>
    <td class="val">
      <div class="digital-note">${esc(signOff.vo.identity.name)}</div>
    </td>
    <td class="val"><div class="digital-note">Digitally signed (see panel)</div></td>
    <td class="val">${cell(signOff.vo.pliersNumber)}</td>
    <td class="val">${cell(v.verificationDate)}</td>
    <td class="val">${cell(signOff.expiryDate)}</td>
  </tr>
  <tr>
    <td class="lab">VO (Initial &amp; Surname)</td>
    <td class="lab">Signature</td>
    <td class="lab">VO Pliers No.</td>
    <td class="lab">Date</td>
    <td class="lab">Expiry Date of Certificate</td>
  </tr>
  <tr>
    <td class="val">${cell(signOff.client.name)}</td>
    <td class="val">${opts.customerSignatureSvg ? `<div class="sig-img">${opts.customerSignatureSvg}</div>` : '&nbsp;'}</td>
    <td class="val">End of Verification Certificate</td>
    <td class="val">${cell(v.verificationDate)}</td>
    <td class="val">${cell(signOff.rejectionCertNumber)}</td>
  </tr>
  <tr>
    <td class="lab">Client (Initial &amp; Surname)</td>
    <td class="lab">Signature</td>
    <td class="lab">&nbsp;</td>
    <td class="lab">Date</td>
    <td class="lab">Rejection Cert. No. (if applicable)</td>
  </tr>
</table>

<div class="rev">Revision 13</div>

<!-- ================= PAGE 2 — METROLOGIST NOTE ================= -->
<div class="page-break"></div>
<div class="mtitle">REPORTING OF VERIFICATION / REPAIR RESULTS — STANDARD</div>
<div class="msub">Liquid Fuel Dispensers &nbsp;·&nbsp; ${esc(site.customerName)} — ${esc(site.siteName)}
  &nbsp;·&nbsp; Cert No.: ${esc(v.certificateNumber)}</div>
${hoses.map(metrologistHose).join('')}

<footer>Prowalco (Pty) Ltd · 2 Cedar Street, Lords View Industrial Park, Midrand 1619 ·
  Tel: (011) 617 6000 &nbsp;—&nbsp; END OF CERTIFICATE</footer>
</body>
</html>`;
}
