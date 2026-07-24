"""OnKey provider scaffold (#47) — real work-order source, backend-to-backend.

The HTTP plumbing (base URL + basic-auth session, timeouts) is ready; every
endpoint method raises until the OnKey API documentation arrives and the
field mapping into the WorkOrderProvider shapes can be written. Selecting
WORKORDER_PROVIDER=onkey before then fails fast at startup with a clear
message rather than serving a half-working provider.
"""
import httpx

from ..config import Settings
from .provider import WorkOrderProvider

_MAPPING_PENDING = (
    "OnKey field mapping is pending the API documentation (issue #47) — "
    "run with WORKORDER_PROVIDER=simulated until it lands"
)


class OnKeyProvider(WorkOrderProvider):
    def __init__(self, settings: Settings):
        if not settings.onkey_base_url or not settings.onkey_username or not settings.onkey_password:
            raise ValueError(
                "WORKORDER_PROVIDER=onkey requires ONKEY_BASE_URL, ONKEY_USERNAME "
                "and ONKEY_PASSWORD in the environment"
            )
        self._client = httpx.Client(
            base_url=settings.onkey_base_url.rstrip("/"),
            auth=(settings.onkey_username, settings.onkey_password),
            timeout=20.0,
        )

    def _get(self, path: str, **params) -> dict:
        res = self._client.get(path, params=params)
        res.raise_for_status()
        return res.json()

    def list_work_orders(self, technician_email: str) -> list[dict]:
        raise NotImplementedError(_MAPPING_PENDING)

    def get_work_order(self, work_order_id: str) -> dict | None:
        raise NotImplementedError(_MAPPING_PENDING)

    def get_site(self, site_id: str) -> dict | None:
        raise NotImplementedError(_MAPPING_PENDING)

    def get_dispenser(self, dispenser_id: str) -> dict | None:
        raise NotImplementedError(_MAPPING_PENDING)

    def list_dispensers(self, site_id: str) -> list[dict]:
        raise NotImplementedError(_MAPPING_PENDING)

    def list_sites_for_technician(self, technician_email: str) -> list[dict]:
        raise NotImplementedError(_MAPPING_PENDING)
