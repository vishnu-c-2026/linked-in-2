import "dotenv/config";
import fs from "fs";
import { NEWSLETTER_PROMPT_FILE } from "../config.js";
import { withBusyRetry } from "../util.js";

const LINKEDIN_MAX_CHARS = 2800;
const MAX_POST_CHARS = 1200;

// Renders the scraped posts into the prompt section Gemini reads.
function renderPosts(posts) {
  return posts
    .map((p, i) => {
      const when = p.postedAt ? new Date(p.postedAt).toISOString().slice(0, 10) : "unknown date";
      const engage = [p.reactions ? `${p.reactions} reactions` : "", p.comments ? `${p.comments} comments` : ""]
        .filter(Boolean)
        .join(", ");
      return [
        `${i + 1}. [${when}]${engage ? ` (${engage})` : ""}`,
        p.url ? `Link: ${p.url}` : "",
        p.text.slice(0, MAX_POST_CHARS),
      ].filter(Boolean).join("\n");
    })
    .join("\n\n");
}

// Writes the digest with Gemini (Google AI Studio), same REST shape as
// services/image.js: x-goog-api-key header + contents/parts.
export async function composeNewsletterDigest(posts, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const key = opts.apiKey !== undefined ? opts.apiKey : process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const model = opts.model || process.env.NEWSLETTER_MODEL || "gemini-3.1-flash-lite-preview";

  const guide = fs.existsSync(NEWSLETTER_PROMPT_FILE) ? fs.readFileSync(NEWSLETTER_PROMPT_FILE, "utf8") : "";
  const windowDays = opts.windowDays ? `\nPosts cover the last ${opts.windowDays} days.` : "";
  const task =
    guide +
    "\n\n==================================================\nTHIS WEEK'S POSTS\n==================================================\n" +
    windowDays +
    "\n" +
    renderPosts(posts) +
    "\n\nReturn ONLY the final newsletter post text, with no preface, notes or word count.";

  const data = await withBusyRetry(
    async () => {
      const res = await fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: task }] }],
            generationConfig: { maxOutputTokens: 4096 },
          }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(`Gemini newsletter request failed: ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
        err.status = res.status;
        throw err;
      }
      return body;
    },
    { sleep: opts.sleep },
  );

  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  const text = parts
    .map((p) => p.text)
    .filter(Boolean)
    .join("")
    .trim();
  if (!text) throw new Error(`Gemini returned no text for the newsletter: ${JSON.stringify(data).slice(0, 300)}`);

  if (text.length > LINKEDIN_MAX_CHARS) {
    throw new Error(`Newsletter is ${text.length} characters; LinkedIn's limit is ${LINKEDIN_MAX_CHARS}.`);
  }
  return text;
}
