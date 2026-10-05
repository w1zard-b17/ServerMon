// fetch wrapper: sends the CSRF header on writes and throws ApiError on failure

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `request failed (${status})`);
    this.status = status;
    this.body = body || {};
  }
}

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { "X-ServerMon": "1" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new ApiError(res.status, data);
    if (res.status === 401 && !path.startsWith("/api/auth/")) window.dispatchEvent(new Event("servermon:unauthorized"));
    throw err;
  }
  return data;
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, body = {}) => request("POST", path, body),
};

export function shellUrl(host, cols, rows) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/api/hosts/${encodeURIComponent(host)}/shell?cols=${cols}&rows=${rows}`;
}
