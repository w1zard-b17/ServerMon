# temperature.py - cpu and disk temperature via hw.sensors

from collectors.base import Collector
from connection.ssh_client import run_command
from typing import Dict, Any, List
from config.constants import GET_SENSORS

# device name prefixes used to classify each sensor reading
CPU_PREFIXES = ("cpu",)
DISK_PREFIXES = ("sd", "nvme", "wd")


class TemperatureCheck(Collector):
    name = "temperature.check"

    def run(self, ssh_client) -> Dict[str, Any]:
        output = run_command(ssh_client, GET_SENSORS)
        readings = self._parse_sensors(output)

        return {
            "cpu": [r for r in readings if r["category"] == "cpu"],
            "disk": [r for r in readings if r["category"] == "disk"],
            "other": [r for r in readings if r["category"] == "other"],
        }

    def _parse_sensors(self, output: str) -> List[Dict[str, Any]]:
        '''
        parses lines like:
        hw.sensors.cpu0.temp0=46.00 degC
        hw.sensors.nvme0.temp0=46.00 degC, OK
        only temperature sensors are kept, fans and voltages are ignored
        '''
        readings = []
        for line in output.strip().splitlines():
            if ".temp" not in line or "=" not in line:
                continue

            key, _, rest = line.partition("=")
            device = key.split(".")[2] if len(key.split(".")) > 2 else "unknown"

            # drop trailing status text such as ', OK'
            value_str = rest.strip().split(",")[0].strip()
            parts = value_str.split()
            if not parts:
                continue

            try:
                value = float(parts[0])
            except ValueError:
                continue

            unit = parts[1] if len(parts) > 1 else ""

            category = "other"
            if device.startswith(CPU_PREFIXES):
                category = "cpu"
            elif device.startswith(DISK_PREFIXES):
                category = "disk"

            readings.append({
                "device": device,
                "value": value,
                "unit": unit,
                "category": category,
            })

        return readings