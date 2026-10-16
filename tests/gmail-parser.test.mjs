import { test } from "node:test";
import assert from "node:assert/strict";
import { extractLinkedInUrl, stripQuoteChain, normalizeEmail } from "../src/gmail/parser.js";

const wrap = (body, extra = "") => {
  const date = new Date("2026-10-01T05:00:00Z").toUTCString();
  return `From: Vishnu <vishnu.c@decirclesolar.com>\nTo: linkedin-post-bot@decirclesolar.com\nSubject: Rewrite this\nDate: ${date}\nMessage-ID: <test-1@x>\n${extra ? `Content-Type: ${extra}\n` : ""}\n\n${body}`;
};

test("extractLinkedInUrl finds a plain LinkedIn post URL", () => {
  const url = extractLinkedInUrl("See this post https://www.linkedin.com/posts/company-1_activity-12345 please rewrite it.");
  assert.equal(url, "https://www.linkedin.com/posts/company-1_activity-12345");
});

test("extractLinkedInUrl rejoins URLs wrapped across lines", () => {
  const url = extractLinkedInUrl("https://www.linkedin.com/posts/\ncompany-1_activity-12345\n");
  assert.equal(url, "https://www.linkedin.com/posts/company-1_activity-12345");
});

test("extractLinkedInUrl returns empty when only a non-LinkedIn URL exists", () => {
  assert.equal(extractLinkedInUrl("Check https://example.com/abc"), "");
  assert.equal(extractLinkedInUrl(""), "");
});

test("stripQuoteChain removes a signature after --", () => {
  const out = stripQuoteChain("Hello content\n\n-- \nVishnu\nDeCircle Solar");
  assert.equal(out, "Hello content");
});

test("stripQuoteChain removes older quoted threads (On ... wrote:)", () => {
  const out = stripQuoteChain("New content here\n\nOn Monday, Oct 1, 2026 at 9:00 AM Someone <s@x.com> wrote:\n> old quoted line\n> another");
  assert.equal(out, "New content here");
});

test("stripQuoteChain drops > quoted lines", () => {
  const out = stripQuoteChain("First line\n> quoted\nSecond line");
  assert.equal(out, "First line\nSecond line");
});

test("normalizeEmail extracts a plain-text email", async () => {
  const email = await normalizeEmail({
    id: "msg-1",
    rfc822: wrap(
      "India's solar capacity is growing fast. https://www.linkedin.com/posts/x-activity-1\n\nPlease rewrite for DeCircle Solar.",
    ),
  });
  assert.equal(email.gmailMessageId, "msg-1");
  assert.equal(email.sender, "Vishnu <vishnu.c@decirclesolar.com>");
  assert.equal(email.subject, "Rewrite this");
  assert.ok(email.receivedAt);
  assert.match(email.bodyText, /India's solar capacity/);
  assert.equal(email.linkedInUrl, "https://www.linkedin.com/posts/x-activity-1");
});

test("normalizeEmail handles an HTML-only message and strips tags", async () => {
  const email = await normalizeEmail({
    id: "msg-2",
    rfc822: wrap(
      "<html><body><p>Solar PPA prices fell.</p><p><a href=\"https://www.linkedin.com/posts/y-activity-2\">source</a></p></body></html>",
      "text/html; charset=utf-8",
    ),
  });
  assert.match(email.bodyText, /Solar PPA prices fell/);
  assert.equal(email.linkedInUrl, "https://www.linkedin.com/posts/y-activity-2");
});

test("normalizeEmail drops script tags from HTML so nothing executes", async () => {
  const email = await normalizeEmail({
    id: "msg-3",
    rfc822: wrap("<html><body><script>alert(1)</script><p>Safe text here</p></body></html>", "text/html; charset=utf-8"),
  });
  assert.doesNotMatch(email.bodyText, /script/);
  assert.match(email.bodyText, /Safe text here/);
});

test("normalizeEmail leaves email wrapped in rich format but no LinkedIn URL gives empty linkedInUrl", async () => {
  const email = await normalizeEmail({ id: "msg-4", rfc822: wrap("Just some plain content about solar.") });
  assert.equal(email.linkedInUrl, "");
  assert.match(email.bodyText, /Just some plain content/);
});