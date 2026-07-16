/**
 * NRCS Verification Certificate for Liquid Fuel Dispensers (LM01HV), rendered
 * to PDF by expo-print to match Prowalco's real document (both A4 LANDSCAPE):
 *   Page 1 — the Verification Certificate: traceability box, the LM01HV grid
 *            (rotated Meter / PC Board / Pulsar / Solenoid group labels, a
 *            column per hose), and the two-row VO / Client sign-off.
 *   Page 2 — the Metrologist Note ("Reporting of Verification/Repair Results —
 *            Standard"): a grid of test items as rows and hoses as columns,
 *            including the pass/fail checklist and the EFD deliveries
 *            (Flow/Rate, VFD, VREF, EFD per hose).
 *
 * The visible PAdES signature widget is applied by the backend at the
 * bottom-left of the FIRST page (box 42,40 → 300,90), in the VO signature area.
 *
 * NUMBER FORMATTING CONTRACT: VFD/VREF are whole millilitres, EFD 2 dp. The
 * backend cross-checks the certificate number, VO name, customer, dispenser
 * serial and the VFD/VREF strings against the verification JSON before signing
 * (backend/app/signing/crosscheck.py) — change together.
 */
import type { Component, Delivery, HoseResult, ReferenceMeasure, Verification } from '@prowalco/schema';
import { CHECKLIST_ITEMS } from '@prowalco/schema';
import { PROWALCO_LOGO_BASE64 } from '../../assets/logo-base64';

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A grid cell that shows a non-breaking space when empty (like the blank form). */
const cell = (v: unknown) => {
  const s = esc(v);
  return s.trim() === '' ? '&nbsp;' : s;
};

const num = (v: number | undefined, dp = 0) => (v == null ? '' : v.toFixed(dp));

export interface RenderOptions {
  /** Accreditation mark slot — feature-flagged OFF until Prowalco holds
   * accreditation (CLAUDE.md "Branding"). */
  showAccreditationMark?: boolean;
  /** Drawn client signature as a standalone SVG string (embedded before the
   * technician's cryptographic signature so it is sealed inside it). */
  customerSignatureSvg?: string;
}

const measure = (ms: ReferenceMeasure[], size: ReferenceMeasure['size']) =>
  ms.find((m) => m.size === size);

// ---------------------------------------------------------------------------
// Page 1 — certificate grid (component fields as rows, hoses as columns)
// ---------------------------------------------------------------------------

const COMPONENT_GROUPS: { group: string; key: keyof HoseResult['components'] }[] = [
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
  const cols = (render: (h: HoseResult) => string) =>
    hoses.map((h) => `<td class="v">${render(h)}</td>`).join('');

  const group = (g: string, key: keyof HoseResult['components']) =>
    COMPONENT_FIELDS.map((f, i) => {
      const rot = i === 0 ? `<td class="rot" rowspan="4"><span>${esc(g)}</span></td>` : '';
      return `<tr>${rot}<td class="lbl">${esc(f.label)}</td>${cols((h) =>
        cell(h.components[key][f.field]),
      )}</tr>`;
    }).join('');

  return `
  <table class="grid">
    <tr><td class="lbl" colspan="2">Hose/ Pump No.</td>${cols((h) => cell(h.hoseNumber))}</tr>
    <tr><td class="lbl" colspan="2">Product:</td>${cols((h) => cell(h.product))}</tr>
    ${COMPONENT_GROUPS.map((c) => group(c.group, c.key)).join('')}
  </table>`;
}

// ---------------------------------------------------------------------------
// Page 2 — Metrologist Note grid (test items as rows, hoses as columns)
// ---------------------------------------------------------------------------

const DELIVERY_ROWS: { point: Delivery['point']; label: string }[] = [
  { point: 'del1_max', label: 'Del 1 at max. achievable flow rate' },
  { point: 'del2_max', label: 'Del 2 at max. achievable flow rate' },
  { point: 'del3_max', label: 'Del 3 at max. achievable flow rate' },
  { point: 'min_flow', label: 'Delivery at minimum flow rate' },
  { point: 'preset', label: 'Preset delivery' },
];

function metrologistGrid(v: Verification): string {
  const hoses = v.hoses;
  const d = v.dispenser;

  // Each hose occupies 4 sub-columns (Flow/Rate · VFD · VREF · EFD); single-value
  // rows span all 4.
  const span = (render: (h: HoseResult) => string, cls = '') =>
    hoses.map((h) => `<td colspan="4" class="c ${cls}">${render(h)}</td>`).join('');

  const checkClass = (val: string | undefined) =>
    val === 'fail' ? 'fail' : val === 'pass' ? 'pass' : 'na';

  const identityRow = (label: string, render: (h: HoseResult) => string, cls = '') =>
    `<tr><td class="rl">${esc(label)}</td>${span(render, cls)}</tr>`;

  const checklistRows = CHECKLIST_ITEMS.map((item) =>
    `<tr><td class="rl">${esc(item.label)}</td>${hoses
      .map((h) => {
        const val = h.checklist[item.key];
        return `<td colspan="4" class="c ${checkClass(val)}">${String(val ?? '').toUpperCase()}</td>`;
      })
      .join('')}</tr>`,
  ).join('');

  const deliveryRows = DELIVERY_ROWS.map((row) =>
    `<tr><td class="rl">${esc(row.label)}</td>${hoses
      .map((h) => {
        const dv = h.deliveries.find((x) => x.point === row.point);
        const efdCls = dv ? (dv.pass ? '' : 'oot') : '';
        return (
          `<td class="c">${num(dv?.flowRateLpm, 1)}</td>` +
          `<td class="c">${num(dv?.vfdMl)}</td>` +
          `<td class="c">${num(dv?.vrefMl)}</td>` +
          `<td class="c ${efdCls}">${num(dv?.efdPercent, 2)}</td>`
        );
      })
      .join('')}</tr>`,
  ).join('');

  const hoseHeader = hoses
    .map((h) => `<td colspan="4" class="hh">Hose ${esc(h.hoseNumber)}</td>`)
    .join('');
  const accuracyHeader = hoses
    .map(() => `<td class="sub">Flow/Rate</td><td class="sub">VFD</td><td class="sub">VREF</td><td class="sub">EFD</td>`)
    .join('');

  return `
  <table class="mgrid">
    <tr><td class="rl hh">&nbsp;</td>${hoseHeader}</tr>
    ${identityRow('LFD Make & Model', () => cell(d.makeModel))}
    ${identityRow('LFD Serial number', () => cell(d.serialNumber))}
    ${identityRow('LFD Hose number', (h) => cell(h.hoseNumber))}
    ${identityRow('Verification Status (New / Repaired / ATU / Rej)', (h) => cell(h.status))}
    ${identityRow('Product', (h) => cell(h.product))}
    ${identityRow('Totalizer reading before', (h) => cell(h.totalizerBefore))}
    ${identityRow('Totalizer reading after', (h) => cell(h.totalizerAfter))}
    ${identityRow('Quantity delivered', (h) => cell(h.quantityDelivered))}
    ${identityRow('Environmental or test condition', (h) => esc(String(h.testCondition ?? '').toUpperCase()))}
    ${checklistRows}
    ${identityRow('Instrument certified ( C ) or rejected ( R )', (h) => (h.outcome === 'certified' ? 'C' : 'R'), 'bold')}
    ${identityRow('Qmin / Qmax range on data plate', (h) => `${cell(h.qMinLpm)} / ${cell(h.qMaxLpm)} L/min`)}
    <tr><td class="rl acc">Accuracy: EFD = (VFD − VREF) / VREF × 100</td>${accuracyHeader}</tr>
    ${deliveryRows}
  </table>`;
}

// ---------------------------------------------------------------------------

export function certificateHtml(v: Verification, opts: RenderOptions = {}): string {
  const { site, dispenser, referenceMeasures, hoses, signOff } = v;
  const m200 = measure(referenceMeasures, '200L');
  const m20 = measure(referenceMeasures, '20L');
  const m5 = measure(referenceMeasures, '5L');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4 landscape; margin: 6mm 7mm; }
  body { font-family: Helvetica, Arial, sans-serif; font-size: 7pt; color: #000; }
  .page-break { page-break-before: always; }

  header { display: flex; justify-content: space-between; align-items: flex-start; }
  header img.logo { height: 40px; }
  header .reg { font-size: 6pt; color: #333; margin-top: 1px; }
  header .mid { text-align: center; flex: 1; padding: 0 8px; }
  header .mid h1 { font-size: 15pt; font-weight: bold; letter-spacing: 1px; margin: 0; }
  header .mid .sub { font-size: 8.5pt; font-weight: bold; }
  header .mid .addr { font-size: 6.5pt; margin-top: 1px; }
  header .rt { text-align: right; font-size: 6.5pt; color: #333; min-width: 190px; }
  header .rt .n { font-size: 12pt; font-weight: bold; color: #e35205; letter-spacing: 1px; }
  header .rt .lm { color: #e35205; font-weight: bold; }
  header .rt .no { color: #cc0000; font-size: 13pt; font-weight: bold; }

  .userline { display: flex; gap: 10px; margin: 5px 0; font-size: 8pt; }
  .userline .f { flex: 1; border-bottom: 1px solid #000; padding-bottom: 1px; }
  .userline .k { color: #333; }

  .trace { background: #e9e9e9; border: 1px solid #bbb; padding: 4px 6px; margin-top: 3px; }
  .trace .t { text-align: center; text-decoration: underline; font-weight: bold; font-size: 7pt; margin-bottom: 3px; }
  table.tr3 { width: 100%; border-collapse: collapse; font-size: 7pt; }
  table.tr3 td { padding: 1px 4px; vertical-align: bottom; }
  table.tr3 .lab { width: 30%; }
  table.tr3 .u { border-bottom: 1px solid #000; }

  .method { font-size: 7pt; font-weight: bold; margin: 5px 0 2px; }

  table.grid, table.idgrid { width: 100%; border-collapse: collapse; }
  table.grid td, table.idgrid td { border: 1px solid #000; padding: 1px 4px; font-size: 7pt; }
  table.idgrid td.lbl, table.grid td.lbl { font-weight: bold; white-space: nowrap; background: #f4f4f4; }
  td.rot { width: 14px; text-align: center; background: #f4f4f4; }
  td.rot span { writing-mode: vertical-rl; transform: rotate(180deg); font-weight: bold; font-size: 7pt; }

  .comply { font-size: 6.8pt; margin-top: 6px; }

  table.sign { width: 100%; border-collapse: collapse; margin-top: 10px; }
  table.sign td { text-align: center; font-size: 8pt; padding: 0 4px; }
  table.sign td.val { border-bottom: 1px solid #000; height: 30px; vertical-align: bottom; padding-bottom: 2px; }
  table.sign td.lab { font-size: 6.5pt; color: #333; padding-top: 2px; }
  .sig-img { height: 28px; }
  .digital-note { font-size: 6.5pt; color: #666; }
  .foot { text-align: center; font-size: 6.3pt; color: #666; margin-top: 6px; }

  /* Page 2 — Metrologist Note */
  .mtitle { text-align: center; font-weight: bold; font-size: 11pt; }
  .msub2 { text-align: center; font-size: 7.5pt; margin-bottom: 4px; }
  table.mgrid { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.mgrid td { border: 1px solid #000; padding: 1px 3px; font-size: 6.8pt; text-align: center; }
  table.mgrid td.rl { text-align: left; font-weight: 600; width: 190px; background: #f6f6f6; white-space: nowrap; }
  table.mgrid td.rl.acc { font-weight: bold; }
  table.mgrid td.hh { background: #eef4ee; font-weight: bold; }
  table.mgrid td.sub { font-size: 6pt; background: #f4f4f4; }
  table.mgrid td.bold { font-weight: bold; }
  td.pass { color: #1a7a3a; font-weight: bold; }
  td.fail, td.oot { color: #b00020; font-weight: bold; }
  td.na { color: #777; }
  .mcomments { border: 1px solid #000; border-top: none; padding: 3px 4px; font-size: 7pt; }
  .msign { display: flex; gap: 24px; margin-top: 8px; font-size: 7.5pt; }
  .msign .s { flex: 1; border-top: 1px solid #000; padding-top: 2px; text-align: center; }
  footer { text-align: center; font-size: 6.5pt; color: #444; margin-top: 6px; }
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
  <div class="rt">
    ${opts.showAccreditationMark ? '<em>[Accreditation mark]</em><br/>' : ''}
    <span class="n">NRCS</span> national regulator for compulsory specifications<br/>
    <span class="lm">DESIGNATED VERIFICATION | LM01HV</span><br/>
    ${v.nrcsBookNumber ? `<span class="no">${esc(v.nrcsBookNumber)}</span><br/>` : ''}
    Cert No.: ${esc(v.certificateNumber)}
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
      <td class="u">200L ${cell(m200?.serialNumber)}</td>
      <td class="u">20L ${cell(m20?.serialNumber)}</td>
      <td class="u">5L ${cell(m5?.serialNumber)}</td>
    </tr>
    <tr>
      <td class="lab">Certificate No. of measures used (Only own equipment is used):</td>
      <td class="u">200L ${cell(m200?.certificateNumber)} &nbsp; Cal. date ${cell(m200?.calibrationDate)}</td>
      <td class="u">20L ${cell(m20?.certificateNumber)} &nbsp; Cal. date ${cell(m20?.calibrationDate)}</td>
      <td class="u">5L ${cell(m5?.certificateNumber)} &nbsp; Cal. date ${cell(m5?.calibrationDate)}</td>
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
    <td class="val"><div class="digital-note">${esc(signOff.vo.identity.name)}</div></td>
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

<div class="foot">Prowalco (Pty) Ltd · 2 Cedar Street, Lords View Industrial Park, Midrand 1619 ·
  Tel: (011) 617 6000 &nbsp;·&nbsp; Revision 13 · Hi-Tech Printers 011 493 4338</div>

<!-- ================= PAGE 2 — METROLOGIST NOTE ================= -->
<div class="page-break"></div>
<header>
  <div>
    <img class="logo" src="data:image/png;base64,${PROWALCO_LOGO_BASE64}" alt="Prowalco TATSUNO" />
    <div class="reg">Reg. No. 2001/000701/07</div>
  </div>
  <div class="mid">
    <div class="mtitle">REPORTING OF VERIFICATION / REPAIR RESULTS</div>
    <div class="sub">(METROLOGIST NOTE) · LIQUID FUEL DISPENSERS — STANDARD</div>
    <div class="addr">2 Cedar Street, Lords View Industrial Park, Midrand 1619 SOUTH AFRICA ·
      Tel: (011) 617 6000 · Fax: (011) 617 6099</div>
  </div>
  <div class="rt">
    <b>SANAS</b> Verification laboratory<br/>
    Verification Cert. No.: ${esc(v.certificateNumber)}
  </div>
</header>

<div class="userline">
  <div class="f"><span class="k">Name (User):</span> ${cell(site.siteName)}</div>
  <div class="f"><span class="k">Oil Company:</span> ${cell(site.customerName)}</div>
  <div class="f"><span class="k">Address:</span> ${cell(site.address)}</div>
  <div class="f"><span class="k">Job Ref. No.:</span> ${cell(v.jobReference)}</div>
</div>

${metrologistGrid(v)}

<div class="mcomments"><b>Comments:</b> ${cell(hoses.map((h) => h.comments).filter(Boolean).join(' · '))}</div>

<div class="msign">
  <div class="s">${esc(signOff.vo.identity.name)}<br/>Initial &amp; Surname</div>
  <div class="s">Digitally signed<br/>Signature</div>
  <div class="s">${cell(signOff.vo.pliersNumber)}<br/>Pliers No.</div>
  <div class="s">${cell(v.verificationDate)}<br/>Date</div>
</div>

<footer>Prowalco (Pty) Ltd · Revision 14 &nbsp;—&nbsp; END OF VERIFICATION CERTIFICATE</footer>
</body>
</html>`;
}
