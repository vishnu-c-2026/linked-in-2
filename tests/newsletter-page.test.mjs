import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { configure } from "../src/store.js";
import { renderNewsletterView } from "../src/views/newsletter-page.js";
import { newsletterRouter } from "../src/routes/newsletter.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "li-nl-page-"));
const postsFile = path.join(tmpDir, "posts.json");
configure({ postsFile, ledgerFile: path.join(tmpDir, "processed-emails.json") });

beforeEach(() => fs.writeFileSync(postsFile, "[]"));
after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

function digestDraft(overrides = {}) {
  return {
    id: 9,
    mode: "newsletter",
    status: "pending",
    caption: "Here's what happened this week in solar.",
    image: "",
    error: "",
    newsletter: {
      windowDays: 6,
      postsScraped: 2,
      posts: [
        { url: "https://www.linkedin.com/posts/a", text: "Solar park milestone", postedAt: "2026-10-12T10:00:00Z", reactions: 12, comments: 3 },
        { url: "https://www.linkedin.com/posts/b", text: "Grid update", postedAt: "2026-10-11T10:00:00Z", reactions: 4, comments: 0 },
      ],
      generatedAt: "2026-10-16T09:00:00Z",
      trigger: "manual",
    },
    ...overrides,
  };
}

test("renderNewsletterView shows the empty state with a generate button", () => {
  const html = renderNewsletterView({ draft: null, days: 6 });
  assert.match(html, /Generate newsletter \(last 6 days\)/);
  assert.match(html, /No newsletter has been generated yet/);
  assert.doesNotMatch(html, /Rewrite newsletter/);
});

test("renderNewsletterView shows the digest, posts and a rewrite button", () => {
  const html = renderNewsletterView({ draft: digestDraft(), days: 6 });
  assert.match(html, /happened this week in solar\./);
  assert.match(html, /Rewrite newsletter/);
  assert.match(html, /Posts this week \(2\)/);
  assert.match(html, /https:\/\/www\.linkedin\.com\/posts\/a/);
  assert.match(html, /Solar park milestone/);
  assert.match(html, /12 reactions/);
});

test("renderNewsletterView escapes digest and post text", () => {
  const draft = digestDraft();
  draft.caption = "<script>alert('x')</script>";
  draft.newsletter.posts[0].text = "<img src=x onerror=alert(1)>";
  const html = renderNewsletterView({ draft, days: 6 });
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("<img src=x"), false);
  assert.ok(html.includes("&lt;script&gt;"));
});

test("long post text renders a word-boundary preview with …more / …less", () => {
  const long = "Solar milestone announcement. ".repeat(30);
  const draft = digestDraft();
  draft.newsletter.posts[0].text = long;

  const html = renderNewsletterView({ draft, days: 6 });

  assert.ok(long.length > 500, "fixture actually exceeds the clip");
  assert.match(html, /class="nl-clip"/);
  assert.match(html, /class="nl-full"[^>]*hidden/);
  assert.ok(html.includes("milestone… <button"), "preview ends on a whole word plus the …more button");
  assert.ok(!html.includes("milestone annou…"), "never cut mid-word");
  assert.ok(html.includes(long.slice(-30)), "the full text is on the page for expansion");
});

test("the newsletter digest renders a Preview button and a read-only modal", () => {
  const html = renderNewsletterView({ draft: digestDraft(), days: 6 });
  assert.match(html, /class="preview-btn"/);
  assert.match(html, /data-pv="pv-nl-9"/);
  assert.match(html, /class="modal-backdrop" id="pv-nl-9" hidden/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /DeCircle Solar/);
  assert.match(html, /class="li-text"/);
  assert.doesNotMatch(html, /class="li-edit"/);
});

test("short post text renders plainly, with no expand control", () => {
  const html = renderNewsletterView({ draft: digestDraft(), days: 6 });
  assert.ok(!html.includes("nl-clip"));
  assert.ok(!html.includes("nl-more"));
  assert.ok(html.includes("Solar park milestone"));
});

test("long post text is escaped in both the preview and the expanded copy", () => {
  const draft = digestDraft();
  draft.newsletter.posts[0].text = "<img src=x onerror=alert(1)> " + "lorem ".repeat(100);

  const html = renderNewsletterView({ draft, days: 6 });

  assert.equal(html.includes("<img"), false);
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok((html.match(/&lt;img/g) || []).length >= 2, "escaped in both copies");
});

// The GET handler must render from disk only — no Apify/Gemini call.
function getHandler() {
  const layer = newsletterRouter.stack.find((l) => l.route && l.route.path === "/" && l.route.methods.get);
  return layer.route.stack[0].handle;
}

test("GET /newsletter renders the saved digest without scraping", () => {
  fs.writeFileSync(postsFile, JSON.stringify([digestDraft()]));

  let body = "";
  const res = { send: (html) => { body = html; } };
  const returned = getHandler()({ query: {} }, res);

  assert.equal(returned, undefined, "handler is synchronous — it starts no async scrape");
  assert.match(body, /happened this week in solar\./);
  assert.match(body, /Solar park milestone/);
});
