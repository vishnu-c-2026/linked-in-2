import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  configure,
  markMessage,
  ledgerOf,
  isProcessed,
  loadPosts,
  processOne,
  checkInbox,
} from "../src/gmail/processor.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "li-email-"));
const ledgerFile = path.join(tmpDir, "processed-emails.json");
const postsFile = path.join(tmpDir, "posts.json");

configure({ ledgerFile, postsFile });

beforeEach(() => {
  fs.writeFileSync(ledgerFile, "{}");
  fs.writeFileSync(postsFile, "[]");
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const deps = {
  get: async (id) => ({ id, rfc822: `Message-ID: <${id}@x>\nFrom: A <a@b.c>\nSubject: S\nDate: Thu, 01 Oct 2026 05:00:00 GMT\n\nBody https://www.linkedin.com/posts/${id}` }),
  parse: async (msg) => ({ gmailMessageId: msg.id, sender: "A <a@b.c>", subject: "S", receivedAt: new Date().toISOString(), bodyText: "Source content", bodyHtml: "", linkedInUrl: `https://www.linkedin.com/posts/${msg.id}` }),
  rewrite: async () => "Rewritten LinkedIn post.",
  list: async ({ query, maxResults }) => [{ id: "m1", threadId: "t-m1" }, { id: "m2", threadId: "t-m2" }].slice(0, maxResults ?? 2),
};

test("processOne creates a pending draft and marks the message PROCESSED", async () => {
  const out = await processOne("m1", deps);
  assert.equal(out.status, "PROCESSED");
  assert.equal(isProcessed("m1"), true);

  const rows = loadPosts();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].mode, "email");
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[0].caption, "Rewritten LinkedIn post.");
  assert.equal(rows[0].email.gmailMessageId, "m1");
  assert.equal(rows[0].email.sourceLinkedInUrl, "https://www.linkedin.com/posts/m1");
});

test("processOne skips an already-processed message (idempotency)", async () => {
  markMessage("m1", "PROCESSED");
  const out = await processOne("m1", deps);
  assert.equal(out.skipped, true);
  assert.equal(loadPosts().length, 0);
});

test("processOne skips a queued message without reworking it", async () => {
  markMessage("m1", "PROCESSING");
  const out = await processOne("m1", deps);
  assert.equal(out.skipped, true);
  assert.equal(loadPosts().length, 0);
});

test("processOne records FAILED when Claude fails and keeps the draft safe", async () => {
  const bad = { ...deps, rewrite: async () => { throw new Error("Claude API timeout"); } };
  const out = await processOne("m1", bad);
  assert.equal(out.status, "FAILED");
  assert.match(out.error, /Claude API timeout/);
  assert.equal(ledgerOf("m1").status, "FAILED");
  assert.equal(ledgerOf("m1").attempts, 1);
  assert.equal(loadPosts().length, 0);
});

test("does not lose an email after repeated failures (max attempts), then a retry can succeed", async () => {
  const bad = { ...deps, rewrite: async () => { throw new Error("boom"); } };
  await processOne("m1", bad); // attempts 1
  await processOne("m1", bad); // attempts 2
  const out3 = await processOne("m1", bad); // attempts 3
  assert.equal(out3.status, "FAILED");
  assert.equal(ledgerOf("m1").attempts, 3);

  const out4 = await processOne("m1", bad);
  assert.equal(out4.skipped, true, "email is not reprocessed forever, and not lost");

  const retry = await processOne("m2", deps);
  assert.equal(retry.status, "PROCESSED");
  assert.equal(loadPosts().length, 1);
});

test("processOne rejects an email with no usable LinkedIn content", async () => {
  const empty = { ...deps, parse: async () => ({ gmailMessageId: "m1", sender: "", subject: "", receivedAt: "", bodyText: "", bodyHtml: "", linkedInUrl: "" }) };
  const out = await processOne("m1", empty);
  assert.equal(out.status, "FAILED");
  assert.match(out.error, /No usable LinkedIn content/);
  assert.equal(loadPosts().length, 0);
});

test("checkInbox lists, dedupes, and processes each new message only once", async () => {
  const first = await checkInbox({ query: "q", deps });
  assert.deepEqual(first.map((r) => r.status).sort(), ["PROCESSED", "PROCESSED"]);
  assert.equal(loadPosts().length, 2);

  const second = await checkInbox({ query: "q", deps });
  assert.ok(second.every((r) => r.skipped === true));
  assert.equal(loadPosts().length, 2, "no duplicate drafts");
});