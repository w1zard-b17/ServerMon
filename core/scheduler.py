# scheduler.py - runs each tier on its own interval

import schedule
from typing import Dict, Any

from core import engine
from config.constants import TIMING_BY_TIERS


def _run_tier(tier: str) -> None:
    report = engine.run_cycle(tier)
    _log_report(report)


def _log_report(report: Dict[str, Any]) -> None:
    print(
        f"[{report['tier']}] hosts={report['hosts_checked']} "
        f"alerts={report['alerts_fired']} errors={len(report['errors'])}"
    )


def build_schedule() -> None:
    for tier, seconds in TIMING_BY_TIERS.items():
        schedule.every(seconds).seconds.do(_run_tier, tier=tier)


def run(stop_event) -> None:
    build_schedule()
    while not stop_event.is_set():
        schedule.run_pending()
        stop_event.wait(1)
