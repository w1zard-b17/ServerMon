#!/bin/sh
# provision.sh - prepares OpenBSD boxes for ServerMon. plain POSIX sh, every command is safe to re-run.
#
# keys <hostname> [--admin]
#   on the monitoring host, as the user that runs ServerMon (not root).
#   creates ~/.ssh/servermon/<hostname>.key and, with --admin, <hostname>.admin.key,
#   then prints the public keys.
#
# host <hostname> --monitor-key <file> [--admin-key <file>]
#   as root on the host to monitor (the monitoring host included).
#   creates the read-only "monitor" account with its six doas rules and, with --admin-key,
#   the "svmctl" control account allowed to run rcctl and shutdown.
#
# dashboard --project-dir <dir> --user <name>
#   as root on the monitoring host, after copying the project there with dashboard/dist built.
#   installs packages, creates the virtualenv, installs the rc.d services and starts them.

set -eu

err() { echo "provision.sh: $*" >&2; exit 1; }
info() { echo "[provision] $*"; }

require_root() {
    [ "$(id -u)" -eq 0 ] || err "must be run as root"
}

# OpenBSD has no getent(1)
user_home() {
    awk -F: -v u="$1" '$1 == u { print $6 }' /etc/passwd
}

ensure_user() {
    u="$1"
    if id "$u" >/dev/null 2>&1; then
        info "user '$u' already exists"
        return 0
    fi
    home="/home/$u"
    # useradd -m fails when the home directory already exists
    if [ -d "$home" ]; then
        useradd -d "$home" -s /bin/ksh -c "ServerMon $u" "$u"
    else
        useradd -m -s /bin/ksh -c "ServerMon $u" "$u"
    fi
    info "created user '$u'"
}

# key-only login
lock_password() {
    usermod -p '*' "$1"
}

install_key() {
    u="$1"; keyfile="$2"
    [ -f "$keyfile" ] || err "no such key file: $keyfile"
    home=$(user_home "$u")
    [ -n "$home" ] || err "could not find the home directory of '$u'"

    mkdir -p "$home/.ssh"
    touch "$home/.ssh/authorized_keys"
    pub=$(cat "$keyfile")

    if grep -qF "$pub" "$home/.ssh/authorized_keys"; then
        info "'$u' already has this key"
    else
        echo "$pub" >> "$home/.ssh/authorized_keys"
        info "installed key for '$u'"
    fi

    # owner only: new users do not always get a group of the same name
    chown -R "$u" "$home/.ssh"
    chmod 700 "$home/.ssh"
    chmod 600 "$home/.ssh/authorized_keys"
}

add_doas_rule() {
    line="$1"
    touch /etc/doas.conf
    if grep -qxF "$line" /etc/doas.conf; then
        info "doas.conf already has: $line"
    else
        echo "$line" >> /etc/doas.conf
        info "doas.conf: added: $line"
    fi
}

cmd_keys() {
    [ "$(id -u)" -ne 0 ] || err "run this as the user that runs ServerMon, not root"
    [ $# -ge 1 ] || err "usage: provision.sh keys <hostname> [--admin]"
    host="$1"; shift
    admin=0
    for a in "$@"; do
        [ "$a" = "--admin" ] && admin=1
    done

    dir="$HOME/.ssh/servermon"
    mkdir -p "$dir"
    chmod 700 "$dir"

    key="$dir/$host.key"
    if [ -f "$key" ]; then
        info "$key already exists"
    else
        ssh-keygen -t ed25519 -f "$key" -N "" -C "monitor@$host"
    fi
    echo "monitor public key for $host:"
    cat "$key.pub"

    if [ "$admin" -eq 1 ]; then
        akey="$dir/$host.admin.key"
        if [ -f "$akey" ]; then
            info "$akey already exists"
        else
            ssh-keygen -t ed25519 -f "$akey" -N "" -C "svmctl@$host"
        fi
        echo "admin public key for $host:"
        cat "$akey.pub"
    fi
}

cmd_host() {
    require_root
    [ $# -ge 1 ] || err "usage: provision.sh host <hostname> --monitor-key <file> [--admin-key <file>]"
    host="$1"; shift

    monitor_key=""
    admin_key=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --monitor-key) monitor_key="$2"; shift 2 ;;
            --admin-key) admin_key="$2"; shift 2 ;;
            *) err "unknown option: $1" ;;
        esac
    done
    [ -n "$monitor_key" ] || err "need --monitor-key <file>"

    ensure_user monitor
    lock_password monitor
    install_key monitor "$monitor_key"

    # one rule per privileged collector command, nothing broader
    add_doas_rule "permit nopass monitor cmd rcctl args ls failed"
    add_doas_rule "permit nopass monitor cmd rcctl args ls on"
    add_doas_rule "permit nopass monitor cmd pfctl args -s info"
    add_doas_rule "permit nopass monitor cmd pfctl args -s rules"
    add_doas_rule "permit nopass monitor cmd syspatch args -c"
    add_doas_rule "permit nopass monitor cmd pkg_add args -u -n"

    if [ -n "$admin_key" ]; then
        ensure_user svmctl
        lock_password svmctl
        install_key svmctl "$admin_key"

        # broader on purpose, the dashboard asks for a second code before using it
        add_doas_rule "permit nopass svmctl cmd rcctl"
        add_doas_rule "permit nopass svmctl cmd shutdown"
    fi

    doas -C /etc/doas.conf
    info "doas.conf is valid"
    info "done for '$host'"
    if [ -n "$admin_key" ]; then
        info "add 'admin_user: svmctl' to $host in config/hosts.yaml on the monitoring host"
    fi
}

cmd_dashboard() {
    require_root
    project=""
    run_user=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --project-dir) project="$2"; shift 2 ;;
            --user) run_user="$2"; shift 2 ;;
            *) err "unknown option: $1" ;;
        esac
    done
    [ -n "$project" ] && [ -n "$run_user" ] || err "usage: provision.sh dashboard --project-dir <dir> --user <name>"
    [ -d "$project" ] || err "no such directory: $project"
    [ -f "$project/dashboard/dist/index.html" ] || err "dashboard/dist is missing, build it first (npm run build)"
    [ -f "$project/config/hosts.yaml" ] || err "config/hosts.yaml is missing, copy it from hosts.example.yaml"
    id "$run_user" >/dev/null 2>&1 || err "user '$run_user' does not exist"

    info "installing packages..."
    pkg_add py3-cryptography py3-bcrypt py3-paramiko py3-yaml

    info "preparing the virtualenv..."
    if [ ! -x "$project/v/bin/python" ]; then
        su -l "$run_user" -c "python3 -m venv --system-site-packages '$project/v'"
    else
        info "virtualenv already exists at $project/v"
    fi
    su -l "$run_user" -c "'$project/v/bin/pip' install -r '$project/requirements.txt'"

    info "installing wrapper scripts..."
    mkdir -p "$project/bin" "$project/logs"
    sed "s|__PROJECT__|$project|g" "$project/ops/bin/run-engine.sh" > "$project/bin/run-engine.sh"
    sed "s|__PROJECT__|$project|g" "$project/ops/bin/run-dashboard.sh" > "$project/bin/run-dashboard.sh"
    chmod +x "$project/bin/run-engine.sh" "$project/bin/run-dashboard.sh"
    chown "$run_user" "$project/bin" "$project/bin/run-engine.sh" "$project/bin/run-dashboard.sh" "$project/logs"

    info "installing rc.d services..."
    sed "s|__PROJECT__|$project|g; s|__USER__|$run_user|g" "$project/ops/rc.d/servermon" > /etc/rc.d/servermon
    sed "s|__PROJECT__|$project|g; s|__USER__|$run_user|g" "$project/ops/rc.d/servermon_api" > /etc/rc.d/servermon_api
    chown root:bin /etc/rc.d/servermon /etc/rc.d/servermon_api
    chmod 555 /etc/rc.d/servermon /etc/rc.d/servermon_api

    # a stale runfile from an earlier install makes rcctl report the service as failed
    rcctl stop servermon servermon_api 2>/dev/null || true
    rm -f /var/run/rc.d/servermon /var/run/rc.d/servermon_api

    rcctl enable servermon servermon_api
    rcctl start servermon servermon_api
    rcctl check servermon servermon_api

    info "done. on first start the enrolment token is written to the log:"
    info "  grep -A2 'one-time token' $project/logs/servermon-api.log"
}

usage() {
    cat >&2 <<'EOF'
usage:
  provision.sh keys <hostname> [--admin]
  provision.sh host <hostname> --monitor-key <file> [--admin-key <file>]
  provision.sh dashboard --project-dir <dir> --user <name>
EOF
    exit 1
}

[ $# -ge 1 ] || usage
cmd="$1"; shift
case "$cmd" in
    keys) cmd_keys "$@" ;;
    host) cmd_host "$@" ;;
    dashboard) cmd_dashboard "$@" ;;
    *) usage ;;
esac
