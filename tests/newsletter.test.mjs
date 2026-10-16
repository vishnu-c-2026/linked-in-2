import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { configure, loadPosts } from "../src/store.js";
import { handleOf, scrapeRecentPosts } from "../src/services/apify.js";
import { composeNewsletterDigest } from "../src/services/gemini-newsletter.js";
import { generateNewsletter, latestNewsletterDraft } from "../src/newsletter.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "li-newsletter-"));
const postsFile = path.join(tmpDir, "posts.json");
configure({ postsFile, ledgerFile: path.join(tmpDir, "processed-emails.json") });

const DAY = 86400000;
const NOW = Date.now();
const PROFILE = "https://www.linkedin.com/in/decirclesolar";

beforeEach(() => fs.writeFileSync(postsFile, "[]"));
after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

const item = ({ daysAgo = 1, handle = "decirclesolar", text = "Post about India solar parks", url = "https://www.linkedin.com/posts/x-activity-1", reactions = 5, comments = 1 } = {}) => ({
  content: text,
  linkedinUrl: url,
  author: { publicIdentifier: handle },
  postedAt: { timestamp: NOW - daysAgo * DAY, date: new Date(NOW - daysAgo * DAY).toISOString() },
  stats: { totalReactions: reactions, comments },
});

const fetchItems = (items) => async () => ({ ok: true, status: 200, json: async () => items });

test("handleOf parses /in/ and /company/ URLs", () => {
  assert.equal(handleOf("https://www.linkedin.com/in/Jane-Doe/"), "jane-doe");
  assert.equal(handleOf("https://www.linkedin.com/company/acme/"), "acme");
  assert.equal(handleOf("not a url"), "");
});

test("scrapeRecentPosts keeps only the author's posts inside the window", async () => {
  const posts = await scrapeRecentPosts(
    { days: 6, token: "t", profileUrl: PROFILE },
    {
      fetchImpl: fetchItems([
        item({ daysAgo: 1, url: "https://www.linkedin.com/posts/keep" }),
        item({ daysAgo: 10, url: "https://www.linkedin.com/posts/old" }),
        item({ daysAgo: 2, handle: "someoneelse", url: "https://www.linkedin.com/posts/other" }),
      ]),
    },
  );
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, "https://www.linkedin.com/posts/keep");
  assert.equal(posts[0].reactions, 5);
  assert.match(posts[0].postedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("scrapeRecentPosts sends the lookback window and profile to Apify", async () => {
  let seenUrl = "";
  let seenBody = null;
  const fetchImpl = async (url, init) => {
    seenUrl = url;
    seenBody = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => [] };
  };
  await scrapeRecentPosts({ days: 6, token: "tok", profileUrl: PROFILE, actorId: "harvestapi/linkedin-profile-posts" }, { fetchImpl });

  assert.match(seenUrl, /harvestapi~linkedin-profile-posts/);
  assert.match(seenUrl, /token=tok/);
  assert.deepEqual(seenBody.targetUrls, [PROFILE]);
  assert.ok(Date.parse(seenBody.postedLimitDate) < NOW - 5.9 * DAY);
  assert.equal(seenBody.includeReposts, false);
});

test("scrapeRecentPosts fails clearly on missing token, credits and author mismatch", async () => {
  await assert.rejects(
    () => scrapeRecentPosts({ days: 6, token: "", profileUrl: PROFILE }, { fetchImpl: fetchItems([]) }),
    /APIFY_TOKEN is not set/,
  );
  await assert.rejects(
    () => scrapeRecentPosts({ days: 6, token: "t", profileUrl: PROFILE }, { fetchImpl: async () => ({ ok: false, status: 402, json: async () => ({}) }) }),
    /credits/i,
  );
  await assert.rejects(
    () => scrapeRecentPosts({ days: 6, token: "t", profileUrl: PROFILE }, { fetchImpl: fetchItems([item({ handle: "other" })]) }),
    /none authored/,
  );
});

test("composeNewsletterDigest returns Gemini's trimmed text and includes the posts", async () => {
  let seenPrompt = "";
  const fetchImpl = async (url, init) => {
    seenPrompt = JSON.parse(init.body).contents[0].parts[0].text;
    assert.match(url, /generativelanguage\.googleapis\.com/);
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "  Weekly digest.  " }] } }] }) };
  };

  const text = await composeNewsletterDigest(
    [{ url: "https://www.linkedin.com/posts/a", text: "Solar park milestone", postedAt: new Date().toISOString(), reactions: 12, comments: 3 }],
    { fetchImpl, windowDays: 6 },
  );

  assert.equal(text, "Weekly digest.");
  assert.match(seenPrompt, /Solar park milestone/);
  assert.match(seenPrompt, /https:\/\/www\.linkedin\.com\/posts\/a/);
  assert.match(seenPrompt, /Only DeCircle Solar may be named/);
  assert.match(seenPrompt, /Never publish or post anything/);
});

test("composeNewsletterDigest rejects missing key, empty and over-limit output", async () => {
  const ok = (text) => async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) });

  await assert.rejects(
    () => composeNewsletterDigest([{ text: "x" }], { apiKey: "", fetchImpl: ok("y") }),
    /GEMINI_API_KEY is not set/,
  );
  await assert.rejects(
    () => composeNewsletterDigest([{ text: "x" }], { apiKey: "k", fetchImpl: ok("") }),
    /returned no text/,
  );
  await assert.rejects(
    () => composeNewsletterDigest([{ text: "x" }], { apiKey: "k", fetchImpl: ok("a".repeat(3000)) }),
    /LinkedIn's limit/,
  );
});

test("generateNewsletter queues a pending digest and clears old newsletter drafts", async () => {
  fs.writeFileSync(postsFile, JSON.stringify([
    { id: 1, mode: "email", status: "pending", caption: "email draft" },
    { id: 2, mode: "newsletter", status: "pending", caption: "old digest" },
    { id: 3, mode: "newsletter", status: "posted", caption: "published digest" },
  ]));

  const r = await generateNewsletter({ trigger: "manual" }, {
    scrape: async () => [{ url: "https://www.linkedin.com/posts/a", text: "Post A", postedAt: new Date().toISOString() }],
    compose: async () => "Weekly digest text",
  });

  assert.equal(r.ok, true);
  assert.equal(r.scraped, 1);
  assert.equal(r.removedDrafts, 1);

  const rows = loadPosts();
  assert.equal(rows.length, 3, "email draft + published digest + new draft");
  assert.ok(rows.some((x) => x.mode === "email"));
  assert.ok(rows.some((x) => x.mode === "newsletter" && x.status === "posted"), "published history is kept");

  const draft = rows.find((x) => x.mode === "newsletter" && x.status === "pending");
  assert.equal(draft.caption, "Weekly digest text");
  assert.equal(draft.image, "");
  assert.equal(draft.newsletter.trigger, "manual");
  assert.equal(draft.newsletter.posts.length, 1);
  assert.equal(draft.newsletter.posts[0].url, "https://www.linkedin.com/posts/a");
  assert.equal(draft.newsletter.posts[0].text, "Post A");
});

test("composeNewsletterDigest retries a busy Gemini (503) twice before succeeding", async () => {
  const delays = [];
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls < 3) return { ok: false, status: 503, json: async () => ({ error: { message: "busy" } }) };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "Recovered digest." }] } }] }) };
  };

  const text = await composeNewsletterDigest(
    [{ url: "https://www.linkedin.com/posts/a", text: "Solar park milestone", postedAt: new Date().toISOString(), reactions: 1, comments: 0 }],
    { fetchImpl, apiKey: "k", sleep: async (ms) => { delays.push(ms); } },
  );

  assert.equal(text, "Recovered digest.");
  assert.equal(calls, 3, "two busy failures, then the real attempt");
  assert.deepEqual(delays, [2000, 4000], "backoff between attempts");
});

test("composeNewsletterDigest gives up after three busy attempts", async () => {
  const delays = [];
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: false, status: 503, json: async () => ({}) };
  };

  await assert.rejects(
    () => composeNewsletterDigest([{ text: "x" }], { fetchImpl, apiKey: "k", sleep: async (ms) => delays.push(ms) }),
    /failed: 503.*after 3 attempts/s,
  );
  assert.equal(calls, 3);
  assert.deepEqual(delays, [2000, 4000]);
});

test("composeNewsletterDigest does not retry non-transient errors", async () => {
  const delays = [];
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: false, status: 400, json: async () => ({}) };
  };

  await assert.rejects(
    () => composeNewsletterDigest([{ text: "x" }], { fetchImpl, apiKey: "k", sleep: async (ms) => delays.push(ms) }),
    /failed: 400/,
  );
  assert.equal(calls, 1, "a 400 is not transient — fail on the first attempt");
  assert.deepEqual(delays, []);
});

test("composeNewsletterDigest defaults to gemini-3.1-flash-lite-preview", async () => {
  const saved = process.env.NEWSLETTER_MODEL;
  delete process.env.NEWSLETTER_MODEL;
  let url = "";
  try {
    await composeNewsletterDigest([{ text: "x" }], {
      apiKey: "k",
      fetchImpl: async (u) => {
        url = u;
        return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "Digest." }] } }] }) };
      },
    });
  } finally {
    if (saved !== undefined) process.env.NEWSLETTER_MODEL = saved;
  }
  assert.match(url, /\/models\/gemini-3\.1-flash-lite-preview:generateContent/);
});

test("generateNewsletter stores the full post text so the tab can expand it", async () => {
  const long = "Solar milestone announcement. ".repeat(30);

  const r = await generateNewsletter({ trigger: "manual" }, {
    scrape: async () => [{ url: "https://www.linkedin.com/posts/a", text: long, postedAt: new Date().toISOString() }],
    compose: async () => "Weekly digest text",
  });

  assert.equal(r.ok, true);
  const draft = loadPosts().find((x) => x.mode === "newsletter" && x.status === "pending");
  assert.equal(draft.newsletter.posts[0].text, long, "stored intact — clipping happens only for display");
});

test("generateNewsletter can be rewritten (replaces the single pending draft)", async () => {
  const deps = (caption) => ({
    scrape: async () => [{ url: "https://www.linkedin.com/posts/a", text: "Post A", postedAt: new Date().toISOString() }],
    compose: async () => caption,
  });

  const first = await generateNewsletter({ trigger: "manual" }, deps("First digest"));
  const second = await generateNewsletter({ trigger: "manual" }, deps("Second digest"));

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.removedDrafts, 1, "the previous pending digest is replaced, not duplicated");

  const digests = loadPosts().filter((x) => x.mode === "newsletter");
  assert.equal(digests.length, 1, "only one digest is kept");
  assert.equal(digests[0].caption, "Second digest");
});

test("latestNewsletterDraft returns the newest digest or null", () => {
  assert.equal(latestNewsletterDraft([]), null);
  const rows = [
    { id: 1, mode: "email" },
    { id: 5, mode: "newsletter", status: "posted" },
    { id: 9, mode: "newsletter", status: "pending" },
  ];
  assert.equal(latestNewsletterDraft(rows).id, 9);
});

test("generateNewsletter creates nothing when the window has no posts", async () => {
  let composed = false;
  const r = await generateNewsletter({ trigger: "schedule" }, {
    scrape: async () => [],
    compose: async () => { composed = true; return "x"; },
  });

  assert.equal(r.ok, false);
  assert.equal(r.reason, "no-posts");
  assert.equal(composed, false, "Gemini is never called without posts");
  assert.equal(loadPosts().length, 0);
});
