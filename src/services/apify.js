import "dotenv/config";

// Apify REST scrape of our own LinkedIn profile's recent posts (no cookies in
// this app — the Apify actor handles access). Uses Node's built-in fetch, so
// there is no extra dependency.

const APIFY_API = "https://api.apify.com/v2/actors";
const DEFAULT_ACTOR = "harvestapi/linkedin-profile-posts";
const DAY_MS = 86400000;
const REQUEST_TIMEOUT_S = 240;

// Handle from a profile/company URL: "https://www.linkedin.com/in/jane-doe/" -> "jane-doe".
export function handleOf(url = "") {
  const m = String(url).match(/linkedin\.com\/(?:in|company)\/([^/?#]+)/i);
  return m ? m[1].replace(/\/+$/, "").toLowerCase() : "";
}

// Every actor shapes its items a little differently; pull the fields we need
// from the known candidate names and normalise them once.
function normalize(item) {
  const text = String(item.content || item.text || item.postText || "").trim();
  const url = String(item.linkedinUrl || item.url || item.postUrl || "").split("?")[0].trim();

  const posted = item.postedAt || {};
  let ts = Number(posted.timestamp ?? item.timestamp ?? item.postedAtTimestamp);
  if (Number.isFinite(ts) && ts > 0 && ts < 1e12) ts *= 1000; // seconds -> ms
  if (!Number.isFinite(ts) || ts <= 0) {
    const raw = posted.date || item.postedDate || item.publishedAt || item.date;
    const parsed = raw ? Date.parse(raw) : NaN;
    ts = Number.isFinite(parsed) ? parsed : 0;
  }

  const author = item.author || {};
  const authorCandidates = [author.publicIdentifier, author.username, author.handle]
    .concat([author.profileUrl, author.profile_url, author.url])
    .filter(Boolean)
    .map((v) => handleOf(v) || String(v).toLowerCase());

  const stats = item.stats || {};
  const reactions = stats.totalReactions ?? stats.reactions ?? stats.like ?? stats.likes ?? 0;
  const comments = stats.comments ?? stats.commentsCount ?? stats.numComments ?? 0;

  return { url, text, ts, authorCandidates, reactions, comments };
}

function actorUrl(actorId, token) {
  const id = actorId.replace("/", "~");
  return `${APIFY_API}/${id}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=${REQUEST_TIMEOUT_S}`;
}

export async function scrapeRecentPosts(opts = {}, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const token = opts.token ?? process.env.APIFY_TOKEN;
  const profileUrl = opts.profileUrl ?? process.env.LINKEDIN_PROFILE_URL;
  const actorId = opts.actorId ?? (process.env.APIFY_ACTOR_ID || DEFAULT_ACTOR);
  const days = Number.isInteger(Number(opts.days)) && Number(opts.days) > 0
    ? Number(opts.days)
    : Number(process.env.NEWSLETTER_LOOKBACK_DAYS) || 6;
  const maxPosts = Number(opts.maxPosts) || Number(process.env.NEWSLETTER_MAX_POSTS) || 30;

  if (!token) throw new Error("APIFY_TOKEN is not set");
  if (!profileUrl) throw new Error("LINKEDIN_PROFILE_URL is not set");

  const cutoff = Date.now() - days * DAY_MS;
  const res = await fetchImpl(actorUrl(actorId, token), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetUrls: [profileUrl],
      maxPosts,
      postedLimitDate: new Date(cutoff).toISOString(),
      includeReposts: false,
      scrapeReactions: false,
      scrapeComments: false,
    }),
  });

  if (res.status === 402) {
    throw new Error("Apify credits are exhausted — top up the Apify account (or wait for the reset) and try again.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Apify scrape failed: HTTP ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
  }

  const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
  const expected = handleOf(profileUrl);

  const inWindow = [];
  let authorDrops = 0;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const n = normalize(item);
    if (n.ts < cutoff) continue; // outside the lookback window
    if (expected && n.authorCandidates.length && !n.authorCandidates.includes(expected)) {
      authorDrops++; // authored by someone else — refuse to ingest
      continue;
    }
    inWindow.push(n);
  }

  if (items.length && !inWindow.length && authorDrops === items.filter(Boolean).length) {
    throw new Error(
      `Apify returned ${items.length} posts but none authored by "${expected}" — check LINKEDIN_PROFILE_URL or APIFY_ACTOR_ID.`,
    );
  }

  return inWindow
    .filter((n) => n.text)
    .map(({ url, text, ts, reactions, comments }) => ({ url, text, ts, postedAt: new Date(ts).toISOString(), reactions, comments }));
}
