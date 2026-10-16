import { checkInbox } from "./gmail/processor.js";
import { generateNewsletter } from "./newsletter.js";

// In-process timer. Checking Gmail costs no tokens; Claude is only called when
// there is actually a new email.
export function startGmailPoller() {
  if (process.env.GMAIL_ENABLED === "false") return;
  const intervalMs = Math.max(Number(process.env.GMAIL_POLL_INTERVAL_MS || 3600000) || 3600000, 60000);
  let busy = false;

  setInterval(async () => {
    if (busy) return;
    if (!process.env.GOOGLE_GMAIL_REFRESH_TOKEN) return;
    busy = true;
    try {
      const results = await checkInbox({ maxResults: 10 });
      if (results.length) console.log(new Date().toISOString(), "Gmail check:", results.map((r) => `${r.status}:${r.id}`).join(", "));
    } catch (e) {
      console.log("Gmail poll failed:", e.code || "", e.message);
    } finally {
      busy = false;
    }
  }, intervalMs);
}

// Weekly newsletter digest. Runs once a week at NEWSLETTER_DAY/NEWSLETTER_HOUR
// (local time) and only queues a pending draft — publishing still needs a human
// approval in the dashboard.
export function startNewsletterScheduler() {
  if (process.env.NEWSLETTER_ENABLED === "false") return;
  if (!process.env.APIFY_TOKEN) {
    console.log("Newsletter scheduler off: APIFY_TOKEN is not set");
    return;
  }

  const dayNum = Number(process.env.NEWSLETTER_DAY);
  const day = Number.isInteger(dayNum) && dayNum >= 0 && dayNum <= 6 ? dayNum : 1; // Monday
  const hourNum = Number(process.env.NEWSLETTER_HOUR);
  const hour = Number.isInteger(hourNum) && hourNum >= 0 && hourNum <= 23 ? hourNum : 9;

  async function run() {
    try {
      const r = await generateNewsletter({ trigger: "schedule" });
      if (r.ok) console.log(new Date().toISOString(), `Newsletter: draft from ${r.scraped} posts (${r.removedDrafts} old drafts removed)`);
      else console.log(new Date().toISOString(), "Newsletter:", r.reason === "no-posts" ? `no posts in the last ${r.days} days` : r.reason);
    } catch (e) {
      console.log("Newsletter generation failed:", e.message);
    } finally {
      schedule();
    }
  }

  function schedule() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, 0, 0, 0);
    let delta = (day - next.getDay() + 7) % 7;
    if (delta === 0 && next <= now) delta = 7;
    next.setDate(next.getDate() + delta);
    setTimeout(run, Math.max(next.getTime() - now.getTime(), 60000));
    console.log(`Newsletter scheduled for ${next.toLocaleString()} (weekly)`);
  }

  schedule();
}
