/**
 * Prowalco Job Card, rendered by expo-print, modelled on OnKey's "Work
 * completion sign off" document (S00034483_..._20260711101621.pdf).
 *
 * WHAT CHANGED FROM THE ONKEY ORIGINAL, and why. Every item below is a
 * defect or a waste observed in the real 2026-07-11 document, not a
 * preference:
 *
 *  1. The Oil Company line ran off the edge of its box. The original read
 *     "[PRW] PROWALCO PDM \ [ENG] ENGEN \ [ENG_RET] RET" and stopped
 *     mid-word. Here it wraps, and the bracketed system codes are dropped
 *     from the display: nobody signing a job card needs [ENG_RET].
 *  2. Importance printed "UNKNOWN" twice, once for the code and once for
 *     the description. We hold the real SLA class in onkey_importances, so
 *     it prints properly, and when it genuinely is unknown it says so once.
 *  3. Location Address was blank. We hold addresses from astLocations.
 *  4. Three telephone boxes were printed and all three were empty. Phone
 *     rows now render only when there is a number.
 *  5. Pages 2 and 3 were an inspection grid with about 31 EMPTY rows for
 *     two real tasks, one of which was the meaningless "Default Task"
 *     passthrough. Tasks now print only if there are real ones, and the
 *     grid is exactly as long as the task list.
 *  6. THE BIG ONE: the original showed no costing at all. The technician
 *     books travel kilometres, vehicle kilometres and labour hours against
 *     the job, and none of it appeared on the document the client signs.
 *     They were signing for work without seeing what was being charged for
 *     it. The costing block is now on the page, above the signatures.
 *  7. One start/end pair was printed for a job that took three visits, so
 *     the document said 06:56 to 10:15 for work spread over months. Visits
 *     are listed individually and the totals are summed. Their labour and
 *     travel are entered per visit by the technician (#121): an earlier
 *     version printed the app's own timer here, which put one minute of
 *     measured time four lines above four point two hours of charged
 *     labour on a document the client signs.
 *  8. No page numbering. Added, because a signed multi-page document
 *     without it cannot be shown to be complete.
 *
 * The client signature is drawn on the device and embedded here BEFORE the
 * technician's cryptographic signature is applied, so it is sealed inside
 * it, exactly as the verification certificate does it (CLAUDE.md).
 */
import { PROWALCO_LOGO_BASE64 } from '../../assets/logo-base64';

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** OnKey stores the oil company as "[PRW] PROWALCO PDM \ [ENG] ENGEN \ ...".
 * The bracketed codes are system plumbing; the client reads the names. */
export const cleanOilCompany = (raw: string | null | undefined): string =>
  String(raw ?? '')
    .split('\\')
    .map((part) => part.replace(/\[[^\]]*\]/g, '').trim())
    .filter(Boolean)
    .join(' / ');

/** A quantity as somebody would write it: 4.2, not 4.20, and 50 not 50.0. */
const qty = (n: number | null | undefined): string => {
  const v = Number(n) || 0;
  return v % 1 ? v.toFixed(1) : String(v);
};

const dayOnly = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
};

const hhmm = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${day} ${time}`;
};

/** One attendance on site, with the labour and travel the TECHNICIAN
 * recorded for it (#121).
 *
 * It used to carry the lifecycle timer's start, end and duration. That
 * printed one minute of measured time four lines above four point two
 * hours of charged labour, on the page the client signs, because the timer
 * measures how long the app sat in a state and not how long anyone worked.
 * Every number here is now entered by the person who did the work. */
export interface JobCardVisit {
  /** ISO date of the attendance. */
  date?: string | null;
  distanceKm?: number | null;
  labourHours?: number | null;
  labourOt15Hours?: number | null;
  labourOt20Hours?: number | null;
}

/** A costing line as OnKey holds it: work task spares, whatever it is for.
 * Travel, vehicle and labour all arrive through the same table. */
export interface JobCardLine {
  itemCode: string;
  description: string;
  quantity: number;
  unit: string;
}

export interface JobCardTask {
  description: string;
  done: boolean;
  passed: boolean | null;
  completedOn?: string | null;
  notes?: string | null;
}

export interface JobCard {
  workOrderCode: string;
  siteCode: string;
  siteName: string;
  siteAddress?: string | null;
  sitePhone?: string | null;
  oilCompany?: string | null;
  assetCode?: string | null;
  assetDescription?: string | null;
  importance?: string | null;
  requester?: string | null;
  requesterPhone?: string | null;
  workRequired?: string | null;
  workPerformed?: string | null;
  visits: JobCardVisit[];
  lines: JobCardLine[];
  tasks: JobCardTask[];
  technicianName: string;
  clientName?: string | null;
  clientContact?: string | null;
  signedAt?: string | null;
}

export interface JobCardOptions {
  /** Drawn on the touchscreen by the person accepting the work. */
  customerSignatureSvg?: string;
  /** The technician's saved handwritten signature. */
  technicianSignatureSvg?: string;
  /** Full-page diagonal stamp on every page, e.g. INCOMPLETE for a job
   * card printed while the work order is paused (#166). A half-done card
   * must not look like a finished one. */
  watermark?: string;
}

/** The site rules printed on the original in 5pt: Prowalco's HSE
 * undertaking, so the wording is theirs and not ours to edit at will.
 *
 * DO NOT "restore" the original text here. Three defects in it were
 * corrected on the owner's instruction (#108), having first been kept
 * verbatim on the owner's earlier instruction. A reader who diffs this
 * against the OnKey document will find:
 *
 *  - Rule 4: the original reads "Owner/mamager". Corrected.
 *  - Rule 6: the original reads "HES rules". Corrected to HSE.
 *  - The original's rule 5 pointed at "important notes about prompt
 *    feedback at the bottom of the page". No such notes exist anywhere on
 *    the original or on ours, and a rule whose entire content is a
 *    reference to missing content says nothing, so it is removed. Seven
 *    rules became six.
 *
 * Rules 1, 2, 3 and 7 are untouched. */
const SITE_RULES = [
  'Permit issuer to remain on site for the full duration of the job, no work to proceed unless issuer is on site.',
  'Introduce yourself to the owner/manager.',
  'Owner/manager to sign jobcard confirming arrival time.',
  'Owner/manager to sign off successful completed maintenance, stipulating the time of completion.',
  "Ensure that all work is done in accordance with Prowalco's HSE rules.",
  'All rubble/dirt caused by your work to be removed and surrounding area to be left in its original state.',
];

/** Travel and vehicle are both kilometres and are almost always the same
 * number, so they are summarised as one distance with the detail beneath.
 * Labour is hours. Everything else is a part. */
const TIME_CODES = new Set(['TRA_TECH', 'VEH_TECH']);
const LABOUR_PREFIX = 'LAB';

function summarise(lines: JobCardLine[]) {
  let distanceKm = 0;
  let labourHours = 0;
  const parts: JobCardLine[] = [];
  for (const l of lines) {
    if (l.itemCode === 'VEH_TECH') distanceKm += l.quantity;
    else if (TIME_CODES.has(l.itemCode)) {
      /* TRA_TECH mirrors VEH_TECH; counting both would double the distance. */
    } else if (l.itemCode.startsWith(LABOUR_PREFIX)) labourHours += l.quantity;
    else parts.push(l);
  }
  return { distanceKm, labourHours, parts };
}

export function jobCardHtml(job: JobCard, opts: JobCardOptions = {}): string {
  const { distanceKm, labourHours, parts } = summarise(job.lines);
  const oil = cleanOilCompany(job.oilCompany);
  // "Default Task" is OnKey's passthrough: every work order gets one and it
  // says nothing. Printing it wastes a row and teaches the reader to skim.
  const realTasks = job.tasks.filter(
    (t) => t.description.trim().toLowerCase() !== 'default task',
  );
  const visitTotal = (k: keyof JobCardVisit): number =>
    job.visits.reduce((n, v) => n + (Number(v[k]) || 0), 0);
  const pages = realTasks.length > 0 ? 2 : 1;

  const contactRows = [
    job.sitePhone ? ['Site telephone', job.sitePhone] : null,
    job.requester ? ['Requested by', job.requester] : null,
    job.requesterPhone ? ['Requester telephone', job.requesterPhone] : null,
  ].filter(Boolean) as string[][];

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4 portrait; margin: 10mm 10mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Helvetica, Arial, sans-serif; font-size: 9pt; color: #111; margin: 0; }
  .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .head h1 { font-size: 17pt; margin: 0; letter-spacing: -0.2px; }
  .head img { height: 42px; }
  .wo { text-align: right; font-size: 8pt; color: #444; }
  .wo b { display: block; font-size: 13pt; color: #111; font-family: "Courier New", monospace; }
  table { width: 100%; border-collapse: collapse; }
  .box { border: 1px solid #999; margin-bottom: 8px; }
  .box th { background: #f0f0f0; text-align: left; font-size: 7.5pt; text-transform: uppercase;
            letter-spacing: 0.4px; padding: 3px 6px; border-bottom: 1px solid #999; color: #333; }
  .box td { padding: 4px 6px; vertical-align: top; border-top: 1px solid #ddd; }
  .lbl { color: #555; font-size: 7.5pt; width: 30%; }
  .val { font-size: 9.5pt; }
  .two { display: flex; gap: 8px; }
  .two > * { flex: 1; min-width: 0; }
  .free { min-height: 68px; white-space: pre-wrap; font-size: 9pt; line-height: 1.35; }
  .rules { font-size: 5.6pt; color: #555; line-height: 1.45; border: 1px solid #ccc;
           padding: 4px 6px; margin-bottom: 8px; }
  .rules span { margin-right: 10px; }
  .grid th, .grid td { border: 1px solid #999; padding: 3px 5px; font-size: 8pt; }
  .grid th { background: #1e3a5f; color: #fff; font-size: 7pt; text-transform: uppercase; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .totals td { font-weight: bold; background: #f6f6f6; }
  .sig { border: 1px solid #999; }
  .sig th { background: #f0f0f0; }
  .sig .pad { height: 74px; text-align: center; padding: 2px; }
  .sig .pad svg, .sig .pad img { max-height: 70px; max-width: 90%; }
  .muted { color: #777; }
  footer { position: fixed; bottom: 4mm; left: 0; right: 0; text-align: center;
           font-size: 6.5pt; color: #555; }
  .page-break { page-break-before: always; }
  /* position:fixed repeats on every printed page, so one element stamps
     the whole document (#166). Light enough to read through, loud enough
     that nobody mistakes a half-done card for a finished one. */
  .wm { position: fixed; top: 42%; left: -10%; right: -10%; text-align: center;
        transform: rotate(-30deg); font-size: 84pt; font-weight: 800;
        letter-spacing: 14px; text-transform: uppercase;
        color: rgba(155, 38, 38, 0.13); z-index: 999; pointer-events: none; }
</style></head><body>
${opts.watermark ? `<div class="wm">${esc(opts.watermark)}</div>` : ''}

<div class="head">
  <h1>Job Card</h1>
  <img src="data:image/png;base64,${PROWALCO_LOGO_BASE64}" alt="Prowalco">
  <div class="wo">Work Order Code<b>${esc(job.workOrderCode)}</b></div>
</div>

<div class="two">
  <table class="box"><tr><th colspan="2">Location</th></tr>
    <tr><td class="lbl">Site</td><td class="val">${esc(job.siteCode)} &nbsp; ${esc(job.siteName)}</td></tr>
    ${job.siteAddress ? `<tr><td class="lbl">Address</td><td class="val">${esc(job.siteAddress)}</td></tr>` : ''}
    ${oil ? `<tr><td class="lbl">Oil company</td><td class="val">${esc(oil)}</td></tr>` : ''}
    ${contactRows.map((r) => `<tr><td class="lbl">${esc(r[0])}</td><td class="val">${esc(r[1])}</td></tr>`).join('')}
  </table>
  <table class="box"><tr><th colspan="2">Asset</th></tr>
    <tr><td class="lbl">Asset</td><td class="val">${esc(job.assetCode ?? '')}</td></tr>
    ${job.assetDescription ? `<tr><td class="lbl">Description</td><td class="val">${esc(job.assetDescription)}</td></tr>` : ''}
    <tr><td class="lbl">Priority</td><td class="val">${job.importance ? esc(job.importance) : '<span class="muted">Not classified</span>'}</td></tr>
  </table>
</div>

<div class="rules">${SITE_RULES.map((r, i) => `<span>${i + 1}. ${esc(r)}</span>`).join('')}</div>

<table class="box"><tr><th>Work required</th></tr>
  <tr><td class="free">${esc(job.workRequired ?? '')}</td></tr></table>

<table class="grid" style="margin-bottom:8px">
  <tr><th>Visit</th><th>Date</th><th class="num">Travel</th><th class="num">Labour</th>
      <th class="num">1.5 OT</th><th class="num">2.0 OT</th></tr>
  ${job.visits
    .map(
      (v, i) => `<tr><td>${i + 1}</td><td>${esc(dayOnly(v.date))}</td>
      <td class="num">${qty(v.distanceKm)} km</td>
      <td class="num">${qty(v.labourHours)} hrs</td>
      <td class="num">${qty(v.labourOt15Hours)}</td>
      <td class="num">${qty(v.labourOt20Hours)}</td></tr>`,
    )
    .join('')}
  ${
    job.visits.length > 1
      ? `<tr class="totals"><td colspan="2">Total over ${job.visits.length} visits</td>
         <td class="num">${qty(visitTotal('distanceKm'))} km</td>
         <td class="num">${qty(visitTotal('labourHours'))} hrs</td>
         <td class="num">${qty(visitTotal('labourOt15Hours'))}</td>
         <td class="num">${qty(visitTotal('labourOt20Hours'))}</td></tr>`
      : ''
  }
</table>

<table class="box"><tr><th>Work performed</th></tr>
  <tr><td class="free">${esc(job.workPerformed ?? '')}</td></tr></table>

<table class="grid" style="margin-bottom:8px">
  <tr><th colspan="3">Charged to this work order</th></tr>
  <tr><td>Travel and vehicle</td><td class="num">${distanceKm.toFixed(distanceKm % 1 ? 1 : 0)}</td><td>km</td></tr>
  <tr><td>Labour on site</td><td class="num">${labourHours.toFixed(labourHours % 1 ? 1 : 0)}</td><td>hrs</td></tr>
  ${parts
    .map(
      (p) => `<tr><td>${esc(p.description)} <span class="muted">${esc(p.itemCode)}</span></td>
      <td class="num">${p.quantity}</td><td>${esc(p.unit)}</td></tr>`,
    )
    .join('')}
  ${parts.length === 0 ? '<tr><td colspan="3" class="muted">No parts used.</td></tr>' : ''}
</table>

<table class="sig">
  <tr><th style="width:50%">Technician</th><th>Accepted by client</th></tr>
  <tr>
    <td class="pad">${opts.technicianSignatureSvg ?? ''}</td>
    <td class="pad">${opts.customerSignatureSvg ?? ''}</td>
  </tr>
  <tr>
    <td><span class="lbl">Name</span><br>${esc(job.technicianName)}</td>
    <td><span class="lbl">Name</span><br>${esc(job.clientName ?? '')}</td>
  </tr>
  <tr>
    <td><span class="lbl">Work order</span><br>${esc(job.workOrderCode)}</td>
    <td><span class="lbl">Contact</span><br>${esc(job.clientContact ?? '')}</td>
  </tr>
  <tr>
    <td></td>
    <td><span class="lbl">Date</span><br>${esc(hhmm(job.signedAt))}</td>
  </tr>
</table>

${
  realTasks.length > 0
    ? `<div class="page-break"></div>
<div class="head"><h1>Inspection report</h1>
  <img src="data:image/png;base64,${PROWALCO_LOGO_BASE64}" alt="Prowalco">
  <div class="wo">Work Order Code<b>${esc(job.workOrderCode)}</b></div></div>
<table class="grid">
  <tr><th>Work task</th><th>Done</th><th>Passed</th><th>Completed on</th><th>Notes</th></tr>
  ${realTasks
    .map(
      (t) => `<tr><td>${esc(t.description)}</td>
      <td style="text-align:center">${t.done ? '&#10003;' : ''}</td>
      <td style="text-align:center">${t.passed == null ? '' : t.passed ? '&#10003;' : '&#10007;'}</td>
      <td>${esc(hhmm(t.completedOn))}</td><td>${esc(t.notes ?? '')}</td></tr>`,
    )
    .join('')}
</table>`
    : ''
}

<footer>Prowalco (Pty) Ltd &nbsp;·&nbsp; Job card ${esc(job.workOrderCode)} &nbsp;·&nbsp; Page 1 of ${pages}</footer>
</body></html>`;
}
