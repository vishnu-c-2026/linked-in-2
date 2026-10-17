import express from "express";
import { esc } from "../util.js";
import { page } from "../views/layout.js";
import { loadPosts } from "../store.js";
import { generateNewsletter, latestNewsletterDraft } from "../newsletter.js";
import { renderNewsletterView } from "../views/newsletter-page.js";
import { toCsv } from "../csv.js";

export const newsletterRouter = express.Router();

// Columns for the per-newsletter CSV export (one row per source post).
const CSV_COLUMNS = [
  { key: "postedAt", label: "Date" },
  { key: "reactions", label: "Reactions" },
  { key: "comments", label: "Comments" },
  { key: "url", label: "URL" },
  { key: "text", label: "Text" },
];

const csvFilename = (r) => {
  const t = Date.parse(r.newsletter?.generatedAt);
  const day = Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : String(r.id);
  return `newsletter-${day}.csv`;
};

// Download the source posts behind one newsletter digest as a CSV file.
// Scoped by ?id= so every newsletter can be exported individually.
newsletterRouter.get("/download.csv", (req, res) => {
  const id = Number(req.query.id);
  const r = loadPosts().find((p) => p.id === id && p.mode === "newsletter");
  if (!r) return res.status(404).send("Newsletter not found");

  const body = toCsv(r.newsletter?.posts || [], CSV_COLUMNS);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${csvFilename(r)}"`);
  res.send(body);
});

// The tab only ever renders what has already been generated — it never scrapes
// on load. A new digest is written by the Rewrite button here or by the weekly
// timer (scheduler.js).
newsletterRouter.get("/", (req, res) => {
  const draft = latestNewsletterDraft(loadPosts());
  const days = Number(process.env.NEWSLETTER_LOOKBACK_DAYS) || 6;
  res.send(page("Newsletter", "newsletter", renderNewsletterView({ draft, days })));
});

// Rewrite/generate: scrape the trailing window of our own posts (Apify) and
// write one digest with Gemini. Nothing publishes here — the draft lands in the
// approval queue on the dashboard.
newsletterRouter.post("/generate-digest", async (req, res) => {
  try {
    const r = await generateNewsletter({ trigger: "manual" });
    if (r.ok) return res.redirect("/newsletter");

    const msg = r.reason === "no-posts"
      ? `No posts were found in the last ${r.days} days, so there was nothing to digest.`
      : r.reason === "busy"
        ? "A newsletter run is already in progress. Try again in a minute."
        : `Newsletter run stopped: ${r.reason}`;
    return res.send(page("Newsletter", "newsletter", `
<h1>Newsletter</h1>
<div class="notice"><p>${esc(msg)}</p>
<p><a href="/newsletter">Back to Newsletter</a> &middot; <a href="/">Back to approvals</a></p></div>`));
  } catch (e) {
    console.log("Newsletter generation failed:", e.message);
    return res.send(page("Newsletter", "newsletter", `
<h1>Newsletter</h1>
<div class="notice"><p>${esc(e.message)}</p>
<p><a href="/newsletter">Back to Newsletter</a></p></div>`));
  }
});
