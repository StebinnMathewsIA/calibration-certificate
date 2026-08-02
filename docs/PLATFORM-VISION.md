# Platform vision: field manager, assets, scheduling, compliance

Agreed with the owner 2026-08-02. The product is no longer "a
calibration certificate app": it is a **field service platform** whose
first tenant is Prowalco. Four capabilities on one spine:

1. **Field manager** (the technician's day: work list, navigation,
   lifecycle, feedback, job cards)
2. **Asset management** (the register we already own, extended)
3. **Work scheduling** (advisory: what to do next)
4. **Compliance** (verification certificates, rejections, and whatever a
   future tenant's regulator demands)

## Decisions locked

| Decision | Choice | Consequence |
|---|---|---|
| Tenancy | **Separate Supabase project per company** | Strongest isolation; onboarding = provision + tenant profile + same migrations; no cross-tenant queries by construction |
| Scheduler authority | **Advisory next-job recommendation** | Ranks the technician's OWN list; the technician always chooses; no planner process change needed |
| Per-company configurability | **All four: compliance types, asset types, job card/workflow, branding and numbering** | Delivered as a **tenant profile in code**, not a runtime admin console (see below) |
| Commercial model | **Prowalco internal first, product later** | No self-serve onboarding, billing or tenant admin UI in this phase |
| OnKey | **Full two-way integration, migrate later** | The work-order phase proceeds exactly as planned; replacing OnKey is a separate future project |
| Duration estimates | **OnKey EstimatedDurationInMinutes** | Available immediately (already a column on the FIELDOPS report); no historical-actuals model needed for v1 |

### Tenant profile as code (how "configurable" is delivered)
One module per tenant declares: asset types and their identity fields;
test plans and tolerances; document types with templates and numbering;
workflow steps and job-card layout; branding. It is versioned code,
reviewed like a migration, deployed with the app. Prowalco's profile is
assembled from what exists today (the test-plan and document-type
registries are already exactly this, one tenant deep). A second company
is a new profile, not a new app. The admin console that lets a customer
EDIT their own profile is deferred until a customer needs it.

## The technician's day (the loop the platform must serve)

Open app -> see my open work orders -> the app **recommends what to
start next** (proximity, urgency, estimated duration) -> select a job ->
**navigate** -> **start** (SLA begins) -> work the process from the
procedure -> **end the job however it concludes**: complete, incomplete,
referred -> a **job card is produced either way** (an incomplete job
card is a first-class document, not a missing one) -> if the job is a
verification, a button inside it launches the **calibration flow**
(standard or high flow, ending in a certificate or a rejection
certificate) -> everything produced is **filed and findable** by site,
asset, technician and date.

## Architecture: one spine, four modules

**Spine (tenant-agnostic):** identity and roles; our canonical work
order, asset and site entities; the offline mirror and outbox; the
domain-event bus with pluggable backend adapters (OnKey today, native
later, another company's ERP tomorrow); the document registry and
storage rules; the audit log; sealing and signing.

**Modules (tenant-configured):**
- *Compliance*: test plans, document types, tolerance rules, regulator
  wording. Prowalco: NRCS LFD verification, standard and high flow,
  rejection certificates.
- *Assets*: asset types with their identity fields and component
  registers. Prowalco: liquid fuel dispensers with hoses and the four
  sealed components.
- *Scheduling*: the ranking function and its inputs.
- *Workflow*: the lifecycle states and job-card layout.

Nothing above contradicts what is already built; the existing
registries ARE the module mechanism, and the canonical-store and
adapter rules from WORKORDER-PHASE.md are what make the backend
swappable.

## What changes in the current plan

Nothing structural. Additions, in order:
1. The scheduling module (ranking on proximity + urgency + estimated
   duration) sits on top of the work list once #95's lifecycle and the
   FIELDOPS report's fields land.
2. Job cards gain an **incomplete** variant (a document type, with the
   reason and follow-up captured).
3. The verification launcher becomes a button INSIDE a work order,
   rather than the current dispenser-first entry point.
4. Tenant profiles are extracted from Prowalco-specific constants as we
   touch them, not in a big-bang refactor.

## Scheduling rules (owner, 2026-08-02)

- **Urgency = complete-by date + SLA/importance class.**
- **Overdue always wins**: any job past its complete-by outranks every
  job that is not, regardless of distance. Within the overdue tier,
  most overdue first, then nearest.
- **Proximity is measured from the technician's live location**, not
  their home base, so the ranking re-orders as they move.
- v1 uses straight-line (haversine) distance: no external API, works
  offline, adequate for ranking. Real travel time is an upgrade behind
  the same interface if the owner later wants it.
- Estimated duration (OnKey's EstimatedDurationInMinutes) is a
  tiebreaker and is shown to the technician, not a hard constraint.
- The ranking must be **explainable on screen** ("overdue by 2 days",
  "12 km away, about 45 min") because technicians will not trust a
  black box, and they always retain the choice.

## Write scope (owner, 2026-08-02): CHANGE ONLY, NO CREATION

We may only modify work orders that already exist and are open. We do
NOT create work orders or work requests. Consequences:

- The test-WO factory (#104) is **parked**, and with it the
  rejection-driven repair work order. A rejection produces its
  certificate; raising the repair job stays a human action in OnKey.
- Testing therefore needs open test work orders. Owner decision
  (2026-08-02): **Prowalco will create test work orders manually in
  OnKey, for testing purposes only, later in the phase.** We never
  create them through the API. Until they exist, write-path work is
  proven in dry-run (the drain logs the exact envelope it would send)
  and by read-only probes.
- Everything else in the write path is unaffected: status and queue
  transitions, feedback, labour and spares all act on existing work
  orders.

## Deferred by the owner

- **Asset management beyond today's register** is parked. Future
  intent: write detailed asset information back to OnKey. Verification
  due dates driving automatic work creation is therefore also parked
  (it would require creation).
- Company two's profile: unknown for now, so tenant seams are cut only
  where Prowalco's own variation already proves them real (compliance
  types, asset types, workflow and job card, branding and numbering).
