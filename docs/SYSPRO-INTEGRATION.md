# Syspro integration: van stock

Prepared 2026-08-03. Prowalco confirmed that **Syspro is the system of
record for van stock**, not OnKey. This document is the design and the
open questions; nothing here is built yet.

## Why this exists

FIELDOPS - INV gave us 77 technician vans and 5305 warehouse-item rows
from OnKey, complete with item codes, descriptions, units, bins, average
cost and minimum quantities. It also gave quantities, and those
quantities are not maintained: whole vans show every item at zero.

So the spares picker reads from two systems:

| From OnKey | From Syspro |
|---|---|
| which items belong to which van | how many are actually there |
| item code, description, unit, bin | |
| average cost, minimum quantity | |
| the WarehouseItemId the write path needs | |

**OnKey's QuantityOnHand must never be displayed.** A wrong stock number
is worse than none: a technician who believes it drives to a forecourt
without the part. Where Syspro data is missing or stale, the picker
shows the item list with no quantity rather than a number we do not
trust.

## Connection design

The source table is Syspro's `InvWarehouse` (stock on hand per item per
warehouse), on a SQL Server inside Prowalco's private network.

Prowalco's IT offered to open a firewall port to that SQL Server,
protected by an IP allowlist. That is the least safe option available
and it was proposed on the assumption that a person would be connecting
from a laptop. What actually connects is a scheduled backend service, so
the allowlist would need OUR egress address, not the owner's.

Preference order:

1. **Outbound push from inside their network.** A scheduled job on a
   Prowalco machine that already reaches Syspro reads `InvWarehouse` and
   posts to us over HTTPS. No inbound rule, no allowlist to maintain, no
   VPN, and they keep the credentials and can stop it at will.
2. **A tunnel** (Tailscale, Cloudflare Tunnel) on a machine inside their
   network, if they would rather we pull than they push. Connection is
   established outward; nothing is exposed.
3. **The exposed port**, only if 1 and 2 are refused. Then: read-only
   SQL login scoped to `InvWarehouse` or a view over it, encryption
   enforced, non-default port, credentials not sent by email or chat.

The FortiClient VPN they already run cannot serve this at all. It is a
desktop client that puts one machine on the network while a person is
using it; it does nothing for a service that must sync on a schedule.
It is still useful for one-off schema exploration.

If option 3 is chosen, the connector must live somewhere with a stable
egress IP. Render publishes fixed outbound addresses for paid services;
Supabase Edge Functions do not, which is a concrete reason for Render to
stay in the architecture rather than everything moving to Supabase.

### Measured egress address (2026-08-03)

`74.220.48.29/32`, the address prowalco-calibration-api connects out
from. Measured by the service reporting its own outbound address
(`GET /v1/onkey/egress-ip`, workflow `egress-ip.yml`), not read off a
dashboard: what a dashboard claims and what a packet arrives as are two
different things, and an allowlist built on the wrong one fails
silently. Ten samples, each cross-checked against two independent echo
services, all agreed.

**This proves consistency, not permanence.** The service is on Render's
FREE plan, which does not guarantee a stable outbound address across
restarts and redeploys. An allowlist pinned to it is a sync that works
for weeks and then stops quietly, looking like a Syspro fault rather
than a networking one. Before this goes live, either:
- move the service to a paid Render plan, and re-run `egress-ip.yml`
  after the move because the address may change, or
- use a tunnel and stop pinning addresses altogether.

Re-run `egress-ip.yml` after any plan, region or service change, and
send Prowalco's IT the new address BEFORE the change, not after.

## Open questions, in priority order

1. **Does booking a spare in OnKey already decrement Syspro?** If an
   OnKey-to-Syspro integration exists, we write the spare to OnKey only
   (`ImportWorkTaskSpare`) and their existing sync moves the stock. If it
   does not, a booked spare needs writing to both, and the two can
   diverge. This decides whether the write path has one target or two,
   so it is the first thing to ask.
2. **What is the join key?** Do OnKey warehouse codes (EB, EN, AA, and
   the other 74) and stock item codes match Syspro's warehouse and stock
   codes directly? If not, OnKey's ExternalReference fields are the
   designed place for another system's key and should be probed.
3. **Refresh cadence.** Van stock changes as parts are issued. Hourly is
   probably enough; the picker should show when the figure was last
   refreshed so a technician can judge it.
4. **Write-back scope.** Sashern's note said to say what is needed if we
   write back to Syspro. Answering question 1 answers this too.
