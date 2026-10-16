import { loadPosts, savePosts } from "./store.js";
import { scrapeRecentPosts } from "./services/apify.js";
import { composeNewsletterDigest } from "./services/gemini-newsletter.js";

// One run at a time: the weekly timer and the dashboard button share this flag
// so they can never scrape + bill Apify twice concurrently.
let busy = false;
export const isNewsletterBusy = () => busy;

// The tab shows the most recently generated digest, whatever its status.
export function latestNewsletterDraft(rows = loadPosts()) {
  return rows.filter((r) => r.mode === "newsletter").sort((a, b) => b.id - a.id)[0] || null;
}

// Scrape the trailing window of our own posts, write a digest with Gemini and
// queue it as a pending draft. Previous newsletter drafts that were never
// posted are removed; posted newsletters stay as history.
export async function generateNewsletter({ trigger = "manual" } = {}, deps = {}) {
  if (busy) return { ok: false, reason: "busy" };
  busy = true;
  try {
    const scrape = deps.scrape || scrapeRecentPosts;
    const compose = deps.compose || composeNewsletterDigest;
    const days = Number(process.env.NEWSLETTER_LOOKBACK_DAYS) || 6;

    const posts = await scrape({ days });
    if (!posts.length) return { ok: false, reason: "no-posts", days };

    const caption = await compose(posts, { windowDays: days });

    const rows = loadPosts();
    const kept = rows.filter((r) => r.mode !== "newsletter" || r.status === "posted");
    const removedDrafts = rows.length - kept.length;

    const id = Date.now();
    kept.push({
      id,
      mode: "newsletter",
      headline: `Newsletter digest · week of ${new Date().toISOString().slice(0, 10)}`,
      caption,
      image: "",
      status: "pending",
      error: "",
      newsletter: {
        windowDays: days,
        postsScraped: posts.length,
        posts: posts.map((p) => ({
          url: p.url || "",
          text: p.text || "",
          postedAt: p.postedAt || "",
          reactions: p.reactions || 0,
          comments: p.comments || 0,
        })),
        generatedAt: new Date().toISOString(),
        trigger,
      },
    });
    savePosts(kept);

    return { ok: true, id, scraped: posts.length, removedDrafts, days, posts, caption };
  } finally {
    busy = false;
  }
}
