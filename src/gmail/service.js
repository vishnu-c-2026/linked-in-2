import "dotenv/config";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

// Shared Google OAuth endpoints (used by the Gmail login flow in routes/auth.js).
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export class GmailError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

let cachedToken = null;
let cachedTokenExp = 0;
let tokenInFlight = null;

export function __resetTokenCache() {
  cachedToken = null;
  cachedTokenExp = 0;
  tokenInFlight = null;
}

async function exchange(body) {
  const r = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) {
    if (r.status === 400 || r.status === 401) {
      throw new GmailError("expired", "Google access has expired or was revoked. Run /gmail/login again to re-connect Gmail.");
    }
    throw new GmailError("auth-failed", `Google refused the access token (HTTP ${r.status}).`);
  }
  return data;
}

export async function gmailToken() {
  if (cachedToken && Date.now() < cachedTokenExp) return cachedToken;
  if (tokenInFlight) return tokenInFlight;

  const refresh = process.env.GOOGLE_GMAIL_REFRESH_TOKEN;
  if (!refresh) throw new GmailError("no-token", "Gmail is not connected yet. Run /gmail/login to authorise.");

  tokenInFlight = (async () => {
    const data = await exchange({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refresh,
      grant_type: "refresh_token",
    });
    cachedToken = data.access_token;
    cachedTokenExp = Date.now() + Math.max((Number(data.expires_in) || 3600) - 60, 60) * 1000;
    return cachedToken;
  })();

  try {
    return await tokenInFlight;
  } finally {
    tokenInFlight = null;
  }
}

export function defaultQuery() {
  return (
    (process.env.GMAIL_QUERY || "").trim() ||
    "(to:linkedin-post-bot@decirclesolar.com OR deliveredto:linkedin-post-bot@decirclesolar.com) is:unread"
  );
}

async function gmailFetch(url, token) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 401 || r.status === 403) {
    cachedToken = null;
    throw new GmailError("forbidden", "Gmail would not share this mailbox. Re-authorise via /gmail/login and check the mailbox owner matches the OAuth account.");
  }
  return r;
}

export async function listMessages({ query = defaultQuery(), maxResults = 10 } = {}) {
  const token = await gmailToken();
  const q = new URLSearchParams({ maxResults: String(maxResults) });
  if (query) q.set("q", query);
  const r = await gmailFetch(`${GMAIL_API}/messages?${q}`, token);
  if (!r.ok) throw new GmailError("api", `Gmail API returned HTTP ${r.status} while listing messages.`);
  const json = await r.json().catch(() => { throw new GmailError("malformed", "Gmail returned an unparseable response while listing messages."); });
  if (json.messages === undefined) return [];
  if (!Array.isArray(json.messages)) throw new GmailError("malformed", "Gmail returned an unexpected response shape while listing messages.");
  return json.messages.map((m) => ({ id: m.id, threadId: m.threadId }));
}

export async function getMessage(id) {
  const token = await gmailToken();
  const r = await gmailFetch(`${GMAIL_API}/messages/${encodeURIComponent(id)}?format=raw`, token);
  if (r.status === 404) throw new GmailError("missing", `Gmail message ${id} was not found.`);
  if (!r.ok) throw new GmailError("api", `Gmail API returned HTTP ${r.status} while reading message ${id}.`);
  const json = await r.json().catch(() => { throw new GmailError("malformed", `Gmail returned an unparseable response for message ${id}.`); });
  if (!json.id || !json.raw) throw new GmailError("malformed", `Gmail message ${id} payload was malformed.`);
  return {
    id: json.id,
    threadId: json.threadId,
    rfc822: Buffer.from(String(json.raw), "base64url").toString("utf8"),
  };
}