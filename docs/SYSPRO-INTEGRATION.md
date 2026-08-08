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

### Measured egress address

**`74.220.48.56/32`** (2026-08-05, Render Starter plan). This is the
address to allowlist on the Syspro firewall.

Measured by the service reporting its own outbound address
(`GET /v1/onkey/egress-ip`, workflow `egress-ip.yml`), not read off a
dashboard: what a dashboard claims and what a packet arrives as are two
different things, and an allowlist built on the wrong one fails
silently. Twelve samples, each cross-checked against two independent
echo services, all agreed.

**It already changed once.** On the free plan it measured
`74.220.48.29`; the move to Starter changed it to `74.220.48.56`. That
is precisely why the free-plan address was never sent to Prowalco: a
firewall rule pinned to it would have been built against an address that
no longer existed, and the resulting failure would have looked like a
Syspro fault rather than a networking one.

Re-run `egress-ip.yml` after ANY plan, region or service change, and
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


## InvWarehouse: the real structure (owner sample, 2026-08-08)

Prowalco supplied a 20-row `InvWarehouse` export. This is the table the
reports spec asked for, and it settles two things and opens one.

**Shape.** 122 columns, one row per stock code per warehouse, the same
grain as OnKey's `FIELDOPS - INV`. Six columns matter:

| Column | Use |
|---|---|
| `StockCode` | the item |
| `Warehouse` | the van or store |
| `QtyOnHand` | what is actually there |
| `UnitCost` | costing, if a line is ever priced |
| `DefaultBin` | where it sits on the van |
| `TimeStamp` | change detection for incremental pulls |

The rest is sales history, aged balances and twelve months of opening
balances per warehouse. None of it belongs in a parts picker.

**The file carries a UTF-8 BOM**, so the first header reads as
`\ufeffStockCode`. A naive `DictReader` fails on the one column that
matters, silently, with a KeyError only if you happen to name it.

### The OnKey join does not work on this data

The spec has carried an unverified assumption that the two systems could be
joined on warehouse code plus stock code. Tested against the sample and our
stored OnKey inventory:

| Check | Result |
|---|---|
| Syspro warehouse codes present in OnKey | 1 of 11 (`BU`) |
| Syspro stock codes present in OnKey | 0 of 6 |

The formats differ visibly. OnKey has 85 two-letter warehouse codes out of
87; Syspro's sample includes `0C`, `2`, `5J`, `U1`. Stock codes look like
different schemes:

```
Syspro   000-075-008-SC-E   0000846RC   1745003
OnKey    100-058            900743-001  906894
```

`BU` matching is more likely coincidence than correspondence.

**Settle this before building the loader.** A picker that mixes two code
schemes produces costing lines OnKey rejects, or accepts against the wrong
item, which is worse.

`UserField1/2/3` are free slots on this table. If Prowalco populates one
with the OnKey code, the join becomes exact and stays exact.

### Missing from this table

No description. A picker fed from `InvWarehouse` alone shows a technician
`0000846RC` and nothing else. Descriptions live in `InvMaster`, which is
needed as well.

No technician. The van-to-technician mapping that the costing write needs
(#129) is not here.
