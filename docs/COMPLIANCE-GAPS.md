# Compliance gap analysis: app vs Prowalco Legal Metrology procedures

Analysed 2026-07-26 against the four controlled procedures supplied by the
owner (issue #88):

| Document | Rev | Subject |
|---|---|---|
| SANS TEST PROC01 | 10 (2025-04-24) | Preliminary examination of LFDs |
| SANS TEST PROC02 | 14/15 (2026-04-01) | Verification of LFDs |
| SANS TEST PROC03 | 11 (2025-08-30) | Use of standard test measures |
| SANS TEST PROC 05 | 6 (2025-08-05) | Repair of LFDs |

The app implements the Metrologist Note (SANS FM21) plus the sealed
verification certificate. This document records what the procedures require
beyond what the app captures today.

## 1. Covered correctly

- EFD formula matches PROC02 exactly: EFD = (VFD - VREF)/VREF x 100, VREF
  recorded in millilitres as prescribed (note under 4.3.1.2).
- Delivery plan for standard LFDs: three deliveries at maximum achievable
  flow (20 L), one at minimum flow (5 L), preset concurrent with the slow
  5 L test at 5 L (PROC02 4.3.1 and 4.3.3, corrected in #87). VFD fixed.
- The 11-item checklist maps to the procedure's pass/fail determinations:
  7-segment display and computation (4.1.1.2), interlock (4.1.1.3), advance
  of indication / zero setting (4.1.1.4), nozzle time-out 120 s, nozzle
  auto-stop (4.2.1.6), common line / solenoid valve (4.2.1.7), leaks /
  hydraulics (4.2.1.8), preset test, nozzle burst, construction and marking,
  measures conformity.
- The four legally relevant components (meter, processor board, pulsar,
  solenoid valve, per PROC05 4.1.5) are exactly the per-hose component
  register.
- Verification status New / Repaired / ATU / Rejected matches the note
  requirements (PROC02 5.3.1 notes 1 and 2); outcome prints as C or R.
- Non-resettable totaliser readings before/after per hose (4.1.1.1).
- Proving measures: per-technician certified register for 200/20/5 L with
  expiry blocking verification start (PROC03 4.1.10); pliers number
  recorded (PROC01 4.2.9); hot/cold test condition.

## 2. Test-data gaps (affect what the certificate can evidence)

1. **Slow 20 L Qmin delivery missing.** PROC02 rev 15 (2026-03-01) added
   the slow 20 L test (4.3.2): an accuracy delivery at minimum flow into
   the 20 L measure, including the after-delivery time-out check and the
   nozzle burst immediately after. The app's five delivery points do not
   include it; VOs currently handwrite it in Comments on the paper note.
   Needs a sixth delivery point (20 L nominal at Qmin).
2. **MPE table unconfirmed.** The app applies a flat +/-0.5 % (declared
   provisional). PROC02/PROC05 Table 1 (LM-IR 117-1 MPE) is an image the
   text extraction cannot read; the real table may differ per test point.
   Owner/QM to supply the values. The nozzle burst MPE is absolute:
   50 ml (4.3.2.5), not a percentage.
3. **Nozzle burst and advance-of-indication record verdicts, not values.**
   The paper note records the measured dilation (e.g. +10 ml, limit 50 ml)
   and the zero-setting reading. App captures Pass/Fail/NA only.
4. **Flow-rate windows not checked.** Achieved Qmax flow must be 50 to
   100 % of the TAC maximum; Qmin flow 100 to 120 % of the TAC minimum
   (4.3.1.4, 4.3.2.2). The app records flow but validates nothing. With
   Qmin/Qmax now on the dispenser identity (#85) this is computable.
5. **Unit price and price computation not captured.** PROC01 4.1.1 requires
   the unit price per nozzle; PROC02 4.2.1.2/4.5.2 require the price
   computation check (litres x unit price vs display). Only a generic
   computation checklist verdict exists.
6. **TAC number not captured.** Required data (PROC01 4.1.1) and the basis
   of several checks (flow windows, approved products, marking). Also the
   SABS 1650 vs LM R117 approval basis must be indicated on the note
   (PROC01 4.2, marking clause).
7. **MMQ / minimum delivery** from the data plate is not captured.
8. **Contact person on premises** is not captured (site has name, address,
   telephone only).
9. **Comments cannot be entered.** The certificate prints a Comments row
   and the schema supports per-hose comments, but the results screen has
   no input.

## 3. Structural gaps (whole flows the app does not model)

10. **High flow rate (HV) dispensers.** PROC02 4.4 to 4.6: 200 L measure,
    200 L nominal deliveries, preset 200 L, 1-minute zero check, flow rate
    computed from a 5-second timed delivery x 12. The app hardcodes the
    standard 20/5 L plan, so an HV dispenser cannot be verified truthfully.
11. **ICON dispensers.** PROC02 5.1: conversion factor calibration mode,
    and the requirement that BOTH the mechanical lead seal and the
    electronic calibration seal numbers are recorded on the verification
    certificate. The app records one security seal per hose; protective
    marks on pulsar/solenoid are not separately recorded.
12. **Initial verification of new LFDs.** PROC02 5.3: flow rate capability
    test recorded on SANS FM42 plus a declaration of conformity attached to
    the certificate. Status "New" exists; neither artefact is modelled.
13. **Rejection flow.** PROC02 5.5: rejection certificate (SANS FM19),
    rejection sticker, mark obliteration, copy forwarded to NRCS. The app
    records outcome R on the verification certificate only.
14. **Repair activities (PROC05).** Repair certificates (SANS FM48, valid
    30 days), repair marks, repair status wording, and the separation rule:
    the person who repaired an instrument may NOT verify it. Out of the
    owner's declared scope (verification certificates only) but the
    separation rule becomes enforceable from certificate history if repair
    support is ever added. `reportType 'repair'` already exists in the
    schema, unused.
15. **Measure inspection records.** PROC03 4.1 prescribes a pre-use
    inspection (sight glass, graduations, seals, dents, level standing) and
    PROC04/FM50 intermediate checks. The app gates only on certificate
    expiry; no inspection record exists.

## 4. Suggested order of attack

Quick, certificate-visible (schema + UI, no new infrastructure): items 1,
3, 5, 6, 7, 8, 9 and the flow-window validation (4). Blocked on owner/QM
input: item 2 (the MPE table values). Larger, decide timing: HV support
(10), ICON seals (11), initial-verification artefacts (12), rejection
certificate (13), measure inspections (15). Repair (14) stays out of scope
until the owner says otherwise.
