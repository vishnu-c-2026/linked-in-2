import "dotenv/config";
import { shortenLinkedInUrl } from "../util.js";

// Free, no-key shorteners. Each takes the long URL and returns the endpoint
// whose plain-text response is the short link.
const PROVIDERS = {
  "is.gd": (u) => `https://is.gd/create.php?format=simple&url=${encodeURIComponent(u)}`,
  tinyurl: (u) => `https://tinyurl.com/api-create.php?url=${encodeURIComponent(u)}`,
};

// Cache long -> short for the life of the process, so re-generating a digest
// reuses the links instead of re-calling the shortener.
const cache = new Map();

// The providers to try, in order. URL_SHORTENER="none" disables shortening
// entirely (the digest then uses the canonical LinkedIn permalink).
function providerList() {
  const raw = (process.env.URL_SHORTENER || "is.gd,tinyurl").trim();
  if (raw.toLowerCase() === "none") return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

// Shortens a URL with the configured providers. On any failure it falls back to
// LinkedIn's canonical permalink so a published link is never broken.
export async function shortenUrl(url, opts = {}) {
  const raw = String(url || "").trim();
  if (!/^https?:\/\//i.test(raw)) return raw;
  if (cache.has(raw)) return cache.get(raw);

  const fetchImpl = opts.fetchImpl || fetch;
  const providers = opts.providers || providerList();
  const timeoutMs = opts.timeoutMs ?? (Number(process.env.URL_SHORTENER_TIMEOUT_MS) || 5000);
  const minIntervalMs = opts.minIntervalMs ?? (Number(process.env.URL_SHORTENER_MIN_INTERVAL_MS) || 2200);
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now || (() => Date.now());

  for (const name of providers) {
    const make = PROVIDERS[name];
    if (!make) continue;

    // is.gd rate-limits (~5 requests / 10s); space the calls out.
    if (minIntervalMs > 0) {
      const wait = shortenUrl._last + minIntervalMs - now();
      if (wait > 0) await sleep(wait);
    }
    shortenUrl._last = now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(make(raw), { signal: controller.signal });
      const text = res.ok ? String(await res.text()).trim() : "";
      if (/^https?:\/\/\S+$/i.test(text)) {
        cache.set(raw, text);
        return text;
      }
    } catch {
      // provider unreachable or timed out — try the next one
    } finally {
      clearTimeout(timer);
    }
  }

  return shortenLinkedInUrl(raw);
}
shortenUrl._last = 0;
