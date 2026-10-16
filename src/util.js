// HTML-escapes a value so user-controlled text can never inject markup.
export const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// base64url encoding used for OAuth PKCE verifiers/challenges.
export const b64url = (b) => b.toString("base64url");

// Runs fn again when it throws a transient "busy" signal (429/503) — Gemini
// returns those when the model is overloaded. Anything else, and the last
// attempt, is thrown straight through. sleep is injectable so tests never wait.
export async function withBusyRetry(fn, { attempts = 3, backoff = [2000, 4000], sleep } = {}) {
  const nap = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await nap(backoff[Math.min(i - 1, backoff.length - 1)]);
    try {
      return await fn();
    } catch (e) {
      const busy = !!e && (e.status === 429 || e.status === 503);
      if (!busy) throw e;
      if (i === attempts - 1) {
        if (typeof e.message === "string") e.message += ` (after ${attempts} attempts)`;
        throw e;
      }
    }
  }
}
