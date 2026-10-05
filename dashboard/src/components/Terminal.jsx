// xterm.js connected to /api/hosts/:name/shell. asks for a fresh code first, the server checks it again

import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { shellUrl } from "../lib/api";
import { useSession } from "../lib/context";

const THEME = {
  background: "#050807",
  foreground: "#dbe7e0",
  cursor: "#22d37a",
  cursorAccent: "#050807",
  selectionBackground: "rgba(34, 211, 122, 0.25)",
  black: "#0b0f0d", brightBlack: "#4d5a54",
  red: "#ef5350", brightRed: "#ff7a77",
  green: "#22d37a", brightGreen: "#5ef0a4",
  yellow: "#fab219", brightYellow: "#ffd065",
  blue: "#4aa3ff", brightBlue: "#7fbfff",
  magenta: "#d55181", brightMagenta: "#f07fab",
  cyan: "#2cc5c5", brightCyan: "#6fe3e3",
  white: "#c9d4ce", brightWhite: "#ffffff",
};

export default function Terminal({ host, active = true, onStatus }) {
  const box = useRef(null);
  const { requireElevation } = useSession();
  const [status, setStatus] = useState("idle");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    onStatus?.(status);
  }, [status, onStatus]);

  useEffect(() => {
    let disposed = false;
    let ws;
    const term = new XTerm({
      fontFamily: '"JetBrains Mono Variable", ui-monospace, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      theme: THEME,
      scrollback: 5000,
      allowProposedApi: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(box.current);
    fit.fit();

    const connect = async () => {
      setStatus("authorizing");
      try {
        await requireElevation(`Open a shell on ${host}`);
      } catch {
        if (!disposed) {
          setStatus("cancelled");
          term.writeln("\x1b[90mShell cancelled, a fresh authenticator code is required.\x1b[0m");
        }
        return;
      }
      if (disposed) return;
      setStatus("connecting");
      term.writeln(`\x1b[90mConnecting to ${host}...\x1b[0m`);
      ws = new WebSocket(shellUrl(host, term.cols, term.rows));
      ws.binaryType = "arraybuffer";
      ws.onmessage = (e) => {
        if (typeof e.data === "string") {
          const msg = JSON.parse(e.data);
          if (msg.t === "s" && msg.m === "connected") {
            setStatus("connected");
            term.focus();
          } else if (msg.t === "e") {
            setStatus("error");
            term.writeln(`\r\n\x1b[31m${msg.m}\x1b[0m`);
          }
          return;
        }
        term.write(new Uint8Array(e.data));
      };
      ws.onclose = (e) => {
        if (disposed) return;
        setStatus((s) => (s === "error" ? s : "closed"));
        const why = e.code === 4403 ? "elevation expired" : e.code === 4401 ? "not signed in" : "session ended";
        term.writeln(`\r\n\x1b[90m[${why}]\x1b[0m`);
      };
    };

    const send = (payload) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(payload));
    const input = term.onData((d) => send({ t: "i", d }));
    const resize = term.onResize(({ cols, rows }) => send({ t: "r", c: cols, r: rows }));
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        // hidden tab, nothing to measure
      }
    });
    ro.observe(box.current);

    connect();

    return () => {
      disposed = true;
      ro.disconnect();
      input.dispose();
      resize.dispose();
      ws?.close();
      term.dispose();
    };
  }, [host, attempt]);

  return (
    <div style={{ display: active ? "flex" : "none", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div ref={box} className="term-body" />
      <div className="term-status">
        <span>
          {host} · {status}
        </span>
        {(status === "closed" || status === "error" || status === "cancelled") && (
          <button className="btn btn-sm btn-ghost" style={{ color: "#dbe7e0" }} onClick={() => setAttempt((a) => a + 1)}>
            Reconnect
          </button>
        )}
      </div>
    </div>
  );
}
