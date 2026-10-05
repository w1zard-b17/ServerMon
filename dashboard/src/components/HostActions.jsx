// action bar for one host. scanning uses the monitor account, every other action needs a fresh code

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Play, Power, RotateCcw, ScanSearch, Square, TerminalSquare, RefreshCcw, Lock } from "lucide-react";
import { ConfirmTyped } from "./Modals";
import { api } from "../lib/api";
import { useFleet, useSession, useToast } from "../lib/context";

export default function HostActions({ host, services = [], failed = [], onDone, compact = false }) {
  const { requireElevation } = useSession();
  const { reload } = useFleet();
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const [scanTier, setScanTier] = useState("fast");
  const [service, setService] = useState(failed[0] || services[0] || "");
  const [confirm, setConfirm] = useState(null); // "reboot" | "shutdown"

  const control = host.control;
  const allServices = [...new Set([...failed, ...services])].sort();
  const serviceKey = allServices.join(",");

  // the service list can arrive after mount, pick a default when it does
  useEffect(() => {
    if (!allServices.includes(service)) setService(failed[0] || allServices[0] || "");
  }, [serviceKey]);

  const run = async (key, fn, success) => {
    setBusy(key);
    try {
      await fn();
      toast(success, "ok");
      reload();
      onDone?.();
    } catch (e) {
      if (e.message !== "cancelled") toast(e.message, "error");
    } finally {
      setBusy(null);
    }
  };

  const scan = () =>
    run("scan", () => api.post(`/api/hosts/${host.name}/scan`, { tier: scanTier }), `Scan of ${host.name} finished`);

  const serviceOp = (op) =>
    run(
      op,
      async () => {
        await requireElevation(`${op} ${service} on ${host.name}`);
        await api.post(`/api/hosts/${host.name}/service`, { service, op });
      },
      `${service}: ${op} sent to ${host.name}`,
    );

  const power = async (op) => {
    await requireElevation(`${op} ${host.name}`);
    await api.post(`/api/hosts/${host.name}/power`, { op, confirm: host.name });
    toast(`${op === "reboot" ? "Reboot" : "Shutdown"} requested for ${host.name}`, "ok");
    reload();
  };

  return (
    <div className="action-bar" onClick={(e) => e.stopPropagation()}>
      <select className="select" value={scanTier} onChange={(e) => setScanTier(e.target.value)} aria-label="Scan depth" style={{ height: 34 }}>
        <option value="fast">Quick scan</option>
        <option value="medium">Metrics scan</option>
        <option value="all">Full scan</option>
      </select>
      <button className="btn btn-primary" onClick={scan} disabled={busy === "scan"}>
        {busy === "scan" ? <RefreshCcw size={15} className="spin" /> : <ScanSearch size={15} />}
        {busy === "scan" ? "Scanning..." : "Scan now"}
      </button>

      <span style={{ width: 1, height: 22, background: "var(--border-strong)", margin: "0 4px" }} />

      {control ? (
        <>
          {allServices.length > 0 && (
            <>
              <select className="select" value={service} onChange={(e) => setService(e.target.value)} aria-label="Service" style={{ height: 34 }}>
                {allServices.map((s) => (
                  <option key={s} value={s}>
                    {s}{failed.includes(s) ? " (failed)" : ""}
                  </option>
                ))}
              </select>
              <button className="btn" onClick={() => serviceOp("start")} disabled={!!busy || !service} title="Start">
                <Play size={14} />{!compact && "Start"}
              </button>
              <button className="btn" onClick={() => serviceOp("restart")} disabled={!!busy || !service} title="Restart">
                <RotateCcw size={14} />{!compact && "Restart"}
              </button>
              <button className="btn" onClick={() => serviceOp("stop")} disabled={!!busy || !service} title="Stop">
                <Square size={13} />{!compact && "Stop"}
              </button>
            </>
          )}
          <Link className="btn" to={`/shell/${host.name}`}>
            <TerminalSquare size={15} /> Terminal
          </Link>
          <span className="spacer" />
          <button className="btn btn-danger" onClick={() => setConfirm("reboot")}>
            <RotateCcw size={14} /> Reboot
          </button>
          <button className="btn btn-danger" onClick={() => setConfirm("shutdown")}>
            <Power size={14} /> Shut down
          </button>
        </>
      ) : (
        <span className="muted row" style={{ fontSize: 12.5, gap: 6 }}>
          <Lock size={13} /> Control disabled. Set <code>admin_user</code> in hosts.yaml and add <code>{host.name}.admin.key</code>
        </span>
      )}

      {confirm && (
        <ConfirmTyped
          title={confirm === "reboot" ? `Reboot ${host.name}?` : `Shut down ${host.name}?`}
          body={
            confirm === "reboot"
              ? "The host will restart immediately. Open sessions are dropped and monitoring shows it offline until it's back."
              : "The host powers off and will not come back on its own. Someone needs physical access to start it again."
          }
          word={host.name}
          actionLabel={confirm === "reboot" ? "Reboot now" : "Shut down"}
          onConfirm={() => power(confirm).catch((e) => e.message !== "cancelled" && toast(e.message, "error"))}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
