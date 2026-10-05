# tasks.py - tier to collector mapping (kept out of constants.py to avoid circular imports)

from collectors.system_metrics import SystemMetrics
from collectors.services import ServiceCheck
from collectors.packages import PackageCheck
from collectors.firewall import FirewallCheck
from collectors.temperature import TemperatureCheck

TASKS_BY_TIER = {
    "fast": [ServiceCheck(), FirewallCheck()],
    "medium": [SystemMetrics(), TemperatureCheck()],
    "slow": [PackageCheck()],
}
