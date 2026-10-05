// first run: console token, QR code, confirm code. afterwards only the code

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { KeyRound, ScanLine } from "lucide-react";
import Bear from "../components/Bear";
import CodeInput from "../components/CodeInput";
import { api } from "../lib/api";
import { useSession } from "../lib/context";

function Shell({ children }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card card">{children}</div>
    </div>
  );
}

function errorText(e) {
  if (e.status === 429) return `Too many attempts, try again in ${e.body.retry_after}s`;
  return e.message;
}

function LoginForm() {
  const { setSession } = useSession();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (code) => {
    setBusy(true);
    try {
      const state = await api.post("/api/auth/login", { code });
      setSession((s) => ({ ...s, ...state }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <Bear size={64} />
      <h1>Welcome back</h1>
      <p>Enter the 6-digit code from your authenticator app.</p>
      <CodeInput onComplete={submit} error={error} disabled={busy} />
      <div className="form-error">{error}</div>
    </Shell>
  );
}

function EnrollForm() {
  const { setSession } = useSession();
  const [step, setStep] = useState(0);
  const [token, setToken] = useState("");
  const [enrol, setEnrol] = useState(null);
  const [qr, setQr] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (enrol) QRCode.toDataURL(enrol.uri, { margin: 0, width: 368, color: { dark: "#07100b", light: "#ffffff" } }).then(setQr);
  }, [enrol]);

  const start = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setEnrol(await api.post("/api/auth/enroll/start", { token: token.trim() }));
      setStep(1);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (code) => {
    setBusy(true);
    try {
      const state = await api.post("/api/auth/enroll/confirm", { token: token.trim(), code });
      setSession((s) => ({ ...s, ...state, enrolled: true }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <div className="steps">
        <i className="on" />
        <i className={step >= 1 ? "on" : ""} />
      </div>
      <Bear size={56} />
      {step === 0 ? (
        <form onSubmit={start}>
          <h1>Set up ServerMon</h1>
          <p>
            Paste the one-time enrolment token that <code>python -m api.server</code> printed on the monitoring host's console.
          </p>
          <div className="row">
            <KeyRound size={16} className="muted" />
            <input className="input grow" placeholder="Enrolment token" value={token} onChange={(e) => setToken(e.target.value)} autoFocus spellCheck={false} />
          </div>
          <div className="form-error">{error}</div>
          <button className="btn btn-primary" style={{ width: "100%", height: 40 }} disabled={!token.trim() || busy}>
            Continue
          </button>
        </form>
      ) : (
        <>
          <h1>Link your authenticator</h1>
          <p>Scan with Aegis, Google Authenticator, 1Password or any TOTP app, then type the code it shows.</p>
          <div className="qr">{qr ? <img src={qr} alt="Authenticator QR code" /> : <div style={{ width: 184, height: 184 }} className="skeleton" />}</div>
          <details style={{ marginBottom: 18 }}>
            <summary className="muted" style={{ cursor: "pointer", fontSize: 12.5 }}>
              <ScanLine size={13} style={{ verticalAlign: -2 }} /> Can't scan? Enter the key manually
            </summary>
            <div className="secret" style={{ marginTop: 8 }}>{enrol?.secret}</div>
          </details>
          <CodeInput onComplete={confirm} error={error} disabled={busy} />
          <div className="form-error">{error}</div>
        </>
      )}
    </Shell>
  );
}

export default function Login() {
  const { session } = useSession();
  if (!session) return null;
  return session.enrolled ? <LoginForm /> : <EnrollForm />;
}
