# main.py - entry point of the collection engine

import threading
import signal

from core import scheduler
from storage.db import init_db


def main():
    init_db()
    stop_event = threading.Event()

    def _handle_signal(signum, frame):
        print(f"\n[main] received signal {signum}, shutting down...")
        stop_event.set()

    signal.signal(signal.SIGINT, _handle_signal)   # Ctrl+C
    signal.signal(signal.SIGTERM, _handle_signal)  # kill, rcctl stop

    print("[main] servermon engine starting")
    scheduler.run(stop_event)
    print("[main] engine stopped")


if __name__ == "__main__":
    main()