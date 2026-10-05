import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import CodeInput from "./CodeInput";
import { api } from "../lib/api";
import { useSession } from "../lib/context";

export function Modal({ children, onClose, label }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal card" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

// rendered once in the layout, opened by requireElevation()
export function ElevateModal() {
  const { elevatePrompt, setElevatePrompt, setSession } = useSession();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!elevatePrompt) return null;

  const close = () => {
    elevatePrompt.reject(new Error("cancelled"));
    setElevatePrompt(null);
    setError(null);
  };

  const submit = async (code) => {
    setBusy(true);
    try {
      const state = await api.post("/api/auth/elevate", { code });
      setSession((s) => ({ ...s, ...state }));
      elevatePrompt.resolve();
      setElevatePrompt(null);
      setError(null);
    } catch (e) {
      setError(e.status === 429 ? `Too many attempts, wait ${e.body.retry_after}s` : "That code didn't work. Wait for the next one.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={close} label="Confirm with authenticator">
      <div className="row" style={{ gap: 12 }}>
        <span className="pill tone-accent" style={{ height: 34, width: 34, justifyContent: "center", borderRadius: 10 }}>
          <ShieldCheck size={18} />
        </span>
        <div>
          <h2>Confirm it's you</h2>
          <div className="muted" style={{ fontSize: 12.5 }}>{elevatePrompt.reason || "Privileged action"}</div>
        </div>
      </div>
      <p>Enter a fresh code from your authenticator. Privileged actions stay unlocked for 5 minutes.</p>
      <CodeInput onComplete={submit} error={error} disabled={busy} />
      <div className="form-error">{error}</div>
      <div className="modal-actions">
        <button className="btn" onClick={close}>Cancel</button>
      </div>
    </Modal>
  );
}

// typed confirmation for reboot and shutdown
export function ConfirmTyped({ title, body, word, actionLabel, onConfirm, onClose, danger = true }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = value.trim() === word;
  return (
    <Modal onClose={onClose} label={title}>
      <h2>{title}</h2>
      <p>{body}</p>
      <label className="muted" style={{ fontSize: 12.5 }}>
        Type <code style={{ color: "var(--text)" }}>{word}</code> to confirm
      </label>
      <input className="input" style={{ width: "100%", marginTop: 6 }} value={value} autoFocus onChange={(e) => setValue(e.target.value)} />
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button
          className={`btn ${danger ? "btn-danger solid" : "btn-primary"}`}
          disabled={!ok || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
              onClose();
            } finally {
              setBusy(false);
            }
          }}
        >
          {actionLabel}
        </button>
      </div>
    </Modal>
  );
}
