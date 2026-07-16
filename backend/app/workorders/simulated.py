"""Simulated OnKey provider — serves the static fixtures as read-only seed.

Swappable for a real `OnKeyProvider` (same WorkOrderProvider interface) by
changing WORKORDER_PROVIDER config; nothing else changes.
"""
from . import fixtures
from .provider import WorkOrderProvider


class SimulatedOnKeyProvider(WorkOrderProvider):
    def list_work_orders(self, technician_email: str) -> list[dict]:
        email = technician_email.strip().lower()
        return [
            wo
            for wo in fixtures.WORK_ORDERS.values()
            if wo["assignedTechnicianEmail"].lower() == email
        ]

    def get_work_order(self, work_order_id: str) -> dict | None:
        return fixtures.WORK_ORDERS.get(work_order_id)

    def get_site(self, site_id: str) -> dict | None:
        return fixtures.SITES.get(site_id)

    def get_dispenser(self, dispenser_id: str) -> dict | None:
        return fixtures.DISPENSERS.get(dispenser_id)

    def list_dispensers(self, site_id: str) -> list[dict]:
        return [d for d in fixtures.DISPENSERS.values() if d.get("siteId") == site_id]

    def list_sites_for_technician(self, technician_email: str) -> list[dict]:
        email = technician_email.strip().lower()
        site_ids = {
            wo["siteId"]
            for wo in fixtures.WORK_ORDERS.values()
            if wo["assignedTechnicianEmail"].lower() == email
        }
        return [fixtures.SITES[s] for s in site_ids if s in fixtures.SITES]


def get_provider() -> WorkOrderProvider:
    """Selected by config later; only the simulated provider exists in the PoC."""
    return SimulatedOnKeyProvider()
