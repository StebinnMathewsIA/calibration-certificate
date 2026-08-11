"""Read-only access to Prowalco's Syspro SQL Server (#135).

Backend to backend only. The mobile app never talks to Syspro and holds no
Syspro credential; it reads the catalogue we land in `stock_items`.

Read the security position in docs/SYSPRO-INTEGRATION.md and #133 before
extending this. The login we were given has no password, and the only
thing standing in front of the server is a source IP allowlist on a
Render egress address that Render shares with other customers. The owner
has accepted that for now so the catalogue can be built; it is not a
settled state, and nothing here should grow to depend on it.
"""

from .client import SysproClient, SysproError, probe

__all__ = ["SysproClient", "SysproError", "probe"]
