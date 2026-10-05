# retention.py - deletes metrics and events older than the retention policy
# meant to run from cron:  python -m storage.retention

from storage.repository import purge_old_metrics, purge_old_events
from storage.db import get_connection


def run_retention(vacuum: bool = False) -> None:
    metrics_deleted = purge_old_metrics()
    events_deleted = purge_old_events()
    total = sum(metrics_deleted.values()) + events_deleted

    print(f"[retention] metrics deleted: {metrics_deleted}")
    print(f"[retention] events deleted: {events_deleted}")
    print(f"[retention] total rows removed: {total}")

    if vacuum and total > 0:
        conn = get_connection()
        try:
            conn.execute("VACUUM")   # SQLite does not give space back after DELETE on its own
        finally:
            conn.close()
        print("[retention] VACUUM completed")


if __name__ == "__main__":
    run_retention(vacuum=True)