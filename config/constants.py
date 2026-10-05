# constants.py - global settings, commands and thresholds

# --- SCHEDULING (seconds between runs of each tier) ---
TIMING_BY_TIERS = {
    "fast": 300,
    "medium": 3600,
    "slow": 43200,
}

# --- SSH SETTINGS ---
SSH_CONN_TIMEOUT = 10

# --- COMMAND STRINGS ---
# system_metrics
GET_CPU_LOAD = "sysctl vm.loadavg"
GET_MEMORY = "vmstat -s"
GET_SWAP = "swapctl -l"
GET_DISK_USAGE = "df -k"
GET_UPTIME = "sysctl kern.boottime"

# services
GET_FAILED_SERVICES = "doas rcctl ls failed"
GET_ENABLED_SERVICES = "doas rcctl ls on"

# packages
GET_OUTDATED_PACKAGES = "doas pkg_add -u -n"
GET_PENDING_PATCHES = "doas syspatch -c"
GET_INSTALLED_PACKAGES = "pkg_info"
GET_OS_VERSION = "uname -r"

# firewall
GET_PF_INFO = "doas pfctl -s info"
GET_PF_RULES = "doas pfctl -s rules"

# temperature
GET_SENSORS = "sysctl hw.sensors"

# --- ALERT THRESHOLDS ---
DISK_USAGE_WARNING = 80     # percent
DISK_USAGE_CRITICAL = 90    # percent
MEMORY_USAGE_WARNING = 90   # percent
CPU_TEMP_WARNING = 75       # degC
DISK_TEMP_WARNING = 65      # degC

# --- RETENTION (days to keep) ---
RETENTION_DAYS = {
    "fast": 7,
    "medium": 30,
    "slow": 90,
}
EVENTS_RETENTION_DAYS = 180

# --- CONTROL COMMANDS (run as the host's admin_user, never as monitor) ---
CMD_SERVICE = "doas rcctl {op} {service}"
CMD_REBOOT = "doas shutdown -r now"
CMD_SHUTDOWN = "doas shutdown -p now"
SERVICE_OPS = ("start", "stop", "restart")

# --- DASHBOARD ---
DASHBOARD_BIND = "0.0.0.0"
DASHBOARD_PORT = 8750
DASHBOARD_ALLOWED_NETWORKS = ["127.0.0.0/8", "::1/128", "192.168.1.0/24"]
DASHBOARD_SESSION_HOURS = 12
DASHBOARD_ELEVATION_SECONDS = 300   # how long a second code unlocks shell and control actions
DASHBOARD_HTTPS_ONLY = False        # set to True when served behind TLS
SHELL_MAX_SECONDS = 3600

TOTP_ISSUER = "ServerMon"
TOTP_PERIOD = 30
TOTP_DIGITS = 6
TOTP_WINDOW = 1                     # accept codes one step either side (clock drift)

LOGIN_MAX_FAILURES_PER_IP = 5
LOGIN_LOCKOUT_SECONDS = 300
LOGIN_MAX_FAILURES_GLOBAL = 15

# alert category -> tier that produces it, used to tell active alerts from cleared ones
ALERT_CATEGORY_TIER = {
    "connection": "fast",
    "service": "fast",
    "firewall": "fast",
    "memory": "medium",
    "disk": "medium",
    "temperature": "medium",
    "patches": "slow",
}
