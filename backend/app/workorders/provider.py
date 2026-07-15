"""The WorkOrderProvider seam (CLAUDE.md, "Future state: On Key integration").

The app never talks to OnKey directly. This backend-side interface is the only
thing that knows where work orders come from. The PoC ships a
`SimulatedOnKeyProvider` backed by static fixtures; a real `OnKeyProvider`
implementing the same interface slots in later by changing one line of config —
no schema or router change.

All returns are read-only SEED data in the camelCase shapes of
shared/schema/src/onkey.ts. Any field may be missing; the technician completes
it on-device and we persist the result in our canonical store (never written
back to OnKey).
"""
from abc import ABC, abstractmethod


class WorkOrderProvider(ABC):
    @abstractmethod
    def list_work_orders(self, technician_email: str) -> list[dict]:
        """Work order summaries assigned to the technician (by sign-in email)."""

    @abstractmethod
    def get_work_order(self, work_order_id: str) -> dict | None:
        """A single work order seed, or None if unknown."""

    @abstractmethod
    def get_site(self, site_id: str) -> dict | None:
        """A site/customer seed, or None if unknown."""

    @abstractmethod
    def get_dispenser(self, dispenser_id: str) -> dict | None:
        """A dispenser (asset) seed, or None if unknown."""
