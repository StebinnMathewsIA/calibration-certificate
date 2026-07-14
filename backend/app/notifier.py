"""Manager notification on marginal / fail / data_anomaly verdicts.

PoC implementation logs and records an audit event; production plugs a real
channel (push via the mobile push service, or email) behind the same
interface without touching the analysis router.
"""
import logging
from typing import Protocol

logger = logging.getLogger("prowalco.notifier")

MANAGER_NOTIFY_VERDICTS = {"marginal", "fail", "data_anomaly"}


class ManagerNotifier(Protocol):
    def notify(self, certificate_number: str, verdict: str, summary: str) -> None: ...


class LoggingNotifier:
    def notify(self, certificate_number: str, verdict: str, summary: str) -> None:
        logger.warning(
            "MANAGER NOTIFICATION — certificate %s verdict=%s: %s",
            certificate_number,
            verdict,
            summary,
        )


default_notifier: ManagerNotifier = LoggingNotifier()
