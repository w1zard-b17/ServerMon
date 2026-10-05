# ServerMon

![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white)
![Starlette](https://img.shields.io/badge/Starlette-ASGI-4B8BBE?style=flat-square)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white)
![Three.js](https://img.shields.io/badge/Three.js-000000?style=flat-square&logo=threedotjs&logoColor=white)
![D3](https://img.shields.io/badge/D3-F9A03C?style=flat-square&logo=d3&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?style=flat-square&logo=sqlite&logoColor=white)
![OpenBSD](https://img.shields.io/badge/OpenBSD-F2CA30?style=flat-square&logo=openbsd&logoColor=black)

Self-hosted monitoring and control panel for a small fleet of OpenBSD servers.

An engine connects to every host over SSH on a schedule, collects service, firewall, resource, temperature and patch data, stores it in SQLite and raises alerts when something crosses a threshold. A web dashboard shows the fleet as a 3D server rack, groups and links related alerts, charts history, and lets you restart a service, reboot a host or open a terminal from the browser.

Everything runs on one machine on the LAN, which also monitors itself like any other host.

```
LAN browser ──:8750──▶ monitoring host
                       ├─ main.py       scheduler, collectors, alert rules
                       ├─ api.server    Starlette API, React dashboard, shell websocket
                       └─ SQLite        metrics, events, auth state (WAL, shared by both)
                              │ SSH as monitor (read-only) or svmctl (control)
                              ▼
                       every host in hosts.yaml, the monitoring host included
```

## Features

- Collection in three tiers: services and firewall every 5 minutes, load, memory, disks and temperatures every hour, packages and security patches every 12 hours
- Alerts for failed services, a disabled firewall, full disks, memory pressure, high temperatures, pending patches and unreachable hosts
- 3D overview with one server cabinet per expected host, lit by its state and dark when offline
- Host pages with history charts, alerts, an activity log and actions: scan now, start, stop or restart a service, reboot, shut down
- Alert list with repeated findings grouped, and a graph linking the same problem across hosts or problems that started together
- Terminal to any host in the browser
- Sign-in with an authenticator app, no passwords
- Dark and light themes, usable on a phone

## Design notes

Four decisions shaped the implementation.

**Monitoring cannot change anything.** Collectors log in as `monitor`, an account allowed to run exactly six commands through doas: `rcctl ls failed`, `rcctl ls on`, `pfctl -s info`, `pfctl -s rules`, `syspatch -c` and `pkg_add -u -n`. Control actions and the shell use a second account, `svmctl`, with its own key. A host without that key stays read-only and the dashboard hides its controls.

**No passwords, and a stolen session is not enough.** Login is a TOTP code. The first authenticator can only be enrolled with a one-time token printed in the server log, so enrolling needs access to the machine. Codes are single use and failed attempts lock out per IP and globally. Service control, power actions and the shell ask for a second fresh code that unlocks them for five minutes, and reboot or shutdown also need the host name typed back. The API only answers to LAN addresses, sends a strict CSP and blocks CSRF with SameSite cookies and a custom request header.

**The engine only writes a log.** Each cycle appends metric rows and events to SQLite. Current state is worked out by the API at read time: a host is offline when its last connection failure is newer than its last data, an alert is active when the latest run of the tier that checks it raised it again, and repeats of the same message collapse into one row with a count. The engine and the dashboard are separate processes, so a problem in the web layer never stops monitoring.

**Nothing extra on the servers.** Provisioning is a POSIX shell script, services are standard rc.d scripts, compiled Python packages come from `pkg_add`, and the dashboard is built elsewhere and served as static files, so Node.js never needs to be installed on the server. The TOTP implementation uses only the Python standard library.

## Tech stack

| Layer | Tools |
|---|---|
| Engine | Python 3, paramiko, schedule |
| API | Starlette, uvicorn, WebSockets |
| Frontend | React 19, Vite, React Router |
| Visuals | three.js with react-three-fiber, D3 force layout, xterm.js |
| Database | SQLite in WAL mode |
| Platform | OpenBSD (rc.d, doas, pf) |

## Installation

### 1. Keys

On the monitoring host, as the user that will run ServerMon (not root), once per host to monitor:

```sh
sh ops/provision.sh keys pc4 --admin
```

This creates `~/.ssh/servermon/pc4.key` and `pc4.admin.key` and prints both public keys. Leave out `--admin` to keep a host read-only.

### 2. Monitored hosts

Copy `ops/provision.sh` and the public keys to each host, then as root:

```sh
sh provision.sh host pc4 --monitor-key pc4.key.pub --admin-key pc4.admin.key.pub
```

This creates the `monitor` and `svmctl` accounts with key-only login and adds their doas rules. The monitoring host needs steps 1 and 2 as well, since it monitors itself over SSH.

### 3. Inventory

```sh
cp config/hosts.example.yaml config/hosts.yaml
```

Add one entry per host. `admin_user: svmctl` enables control for that host. Thresholds, intervals, the port and the allowed networks are in `config/constants.py`.

### 4. Dashboard build

On any machine with Node.js 20.19 or newer:

```sh
cd dashboard && npm ci && npm run build
```

Then copy the project, including `dashboard/dist` and without `node_modules`, to the monitoring host.

### 5. Services

As root on the monitoring host:

```sh
sh ops/provision.sh dashboard --project-dir /home/you/servermon --user you
```

This installs the packages, creates the virtualenv, installs the `servermon` (engine) and `servermon_api` (dashboard) rc.d services, enables them at boot and starts them.

### 6. First login

```sh
grep -A2 'one-time token' /home/you/servermon/logs/servermon-api.log
```

Open `http://<monitoring-host>:8750`, paste the token, scan the QR code with an authenticator app and confirm with a code. After that, login only asks for the code. To enrol a new phone, run `v/bin/python -m api.auth reset` from the project directory and restart `servermon_api`.

### Maintenance

Old data is removed by a retention script. Add it to the crontab of the user running ServerMon:

```
0 4 * * * cd /home/you/servermon && v/bin/python -m storage.retention
```

After editing `hosts.yaml`, run `rcctl restart servermon` so the engine picks up the change.

## Development

```sh
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt paramiko pyyaml

# five fake hosts with three days of history
export SERVERMON_DB=demo.db SERVERMON_HOSTS_FILE=config/hosts.demo.yaml
python -m api.dev_seed
python -m api.server          # prints the enrolment token

# frontend with hot reload, proxying /api to port 8750
cd dashboard && npm install && npm run dev
```

The dashboard is then at `http://localhost:5173`. The demo data goes through the real alert rules, so every host state and alert type shows up without any server.

## Layout

```
main.py          engine entry point
core/            scheduler, collection cycle, host inventory
collectors/      one check per file: services, firewall, metrics, temperature, packages
alerting/        threshold rules
storage/         SQLite schema, queries, retention
connection/      SSH client
control/         service, power and shell actions over the admin account
api/             Starlette app, authentication, derived state, routes
config/          constants, inventory, tier mapping
dashboard/       React frontend
ops/             provisioning script, rc.d services, start wrappers
```
