/**
 * Rejection certificate document (#92) — the first document type beyond the
 * verification certificate (paper: SANS FM19). Rendered on-device, sealed by
 * the backend through the same PAdES pipeline. A4 portrait.
 */
import type { RejectionCertificate } from '@prowalco/schema';
import { PROWALCO_LOGO_BASE64 } from '../../assets/logo-base64';

const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

export function rejectionHtml(r: RejectionCertificate): string {
  const hoses = r.rejectedHoses
    .map(
      (h) => `
    <div class="hose">
      <div class="hosehead">Hose / Pump ${esc(h.hoseNumber)} · ${esc(h.product)}</div>
      <ul>${h.reasons.map((reason) => `<li>${esc(reason)}</li>`).join('')}</ul>
    </div>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>
  @page { size: A4 portrait; margin: 14mm; }
  body { font-family: Helvetica, Arial, sans-serif; color: #111; font-size: 11pt; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; }
  .logo { height: 42px; }
  h1 { font-size: 17pt; letter-spacing: 1px; margin: 14px 0 2px; color: #8a1010; }
  .nums { font-family: 'Courier New', monospace; font-size: 11pt; margin-bottom: 10px; }
  table.kv { border-collapse: collapse; width: 100%; margin: 6px 0 10px; }
  table.kv td { border: 1px solid #444; padding: 4px 6px; font-size: 10pt; }
  td.k { width: 32%; background: #f2f2f2; font-weight: bold; }
  .decl { border: 1.5px solid #8a1010; padding: 8px 10px; font-size: 10pt; margin: 10px 0; }
  .hose { border: 1px solid #444; padding: 6px 8px; margin-bottom: 6px; }
  .hosehead { font-weight: bold; margin-bottom: 3px; }
  ul { margin: 2px 0 2px 18px; padding: 0; }
  li { font-size: 10pt; margin: 1px 0; }
  .confirm { font-size: 10pt; margin: 2px 0; }
  .sig { margin-top: 18px; display: flex; justify-content: space-between; font-size: 10pt; }
  .sigline { border-top: 1px solid #111; padding-top: 3px; width: 46%; }
  .foot { margin-top: 16px; font-size: 8.5pt; color: #444; }
</style></head><body>
  <div class="head">
    <img class="logo" src="data:image/png;base64,${PROWALCO_LOGO_BASE64}" />
    <div style="text-align:right; font-size: 9pt;">Prowalco Tatsuno<br/>Legal Metrology</div>
  </div>
  <h1>REJECTION CERTIFICATE</h1>
  <div class="nums">Rejection Cert. No.: <b>${esc(r.rejectionNumber)}</b><br/>
  Arising from Verification Certificate: ${esc(r.parentCertificateNumber)}<br/>
  Date: ${esc(r.rejectionDate)}</div>

  <table class="kv">
    <tr><td class="k">Name (User)</td><td>${esc(r.site.siteName)}</td></tr>
    <tr><td class="k">Oil Company</td><td>${esc(r.site.customerName)}</td></tr>
    <tr><td class="k">Address</td><td>${esc(r.site.address)}</td></tr>
    <tr><td class="k">LFD Make &amp; Model</td><td>${esc(r.dispenser.makeModel)}</td></tr>
    <tr><td class="k">LFD Serial No.</td><td>${esc(r.dispenser.serialNumber)}</td></tr>
    <tr><td class="k">SA Approval No.</td><td>${esc(r.dispenser.saApprovalNumber)}</td></tr>
  </table>

  <div class="decl">The measuring instrument identified above was found to be false, defective,
  inaccurate or otherwise non-compliant with the Legal Metrology Act, 2014 (Act No. 9 of 2014)
  and the applicable technical regulations, and is hereby <b>REJECTED</b>. It may not be used
  for a prescribed purpose until repaired and verified.</div>

  <div style="font-weight:bold; margin-bottom:4px;">Rejected hoses and reasons</div>
  ${hoses}

  <div style="font-weight:bold; margin-top:10px;">Verification Officer confirmations</div>
  <div class="confirm">[X] Existing verification / repair marks permanently obliterated</div>
  <div class="confirm">[X] Rejection mark applied to the measuring instrument</div>
  <div class="confirm">[X] Instrument rendered unusable (nozzle switch removed)</div>

  <div class="sig">
    <div class="sigline">Verification Officer: ${esc(r.vo.identity.name)}<br/>
    VO Pliers No.: ${esc(r.vo.pliersNumber)}</div>
    <div class="sigline">Digitally signed and timestamped.<br/>
    Valid only as the sealed PDF.</div>
  </div>

  <div class="foot">A copy of this rejection certificate is retained by Prowalco and forwarded to
  the NRCS. Reproduction permitted in full only. END OF CERTIFICATE</div>
</body></html>`;
}
