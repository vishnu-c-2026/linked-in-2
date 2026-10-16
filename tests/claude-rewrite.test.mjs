import { test } from "node:test";
import assert from "node:assert/strict";
import { rewriteLinkedInContent } from "../src/services/claude-rewrite.js";

function stubClient(text) {
  return {
    messages: {
      create: async () => ({ content: [{ type: "text", text }] }),
    },
  };
}

test("rewriteLinkedInContent returns Claude's trimmed post on success", async () => {
  const text = await rewriteLinkedInContent(
    { sender: "s@x.com", subject: "Topic", bodyText: "India solar news" },
    { client: stubClient("  This is the rewritten post.  ") },
  );
  assert.equal(text, "This is the rewritten post.");
});

test("rewriteLinkedInContent includes the email but never auto-publishes", async () => {
  let seenPrompt = "";
  const client = {
    messages: { create: async ({ messages }) => { seenPrompt = messages[0].content; return { content: [{ type: "text", text: "out" }] }; } },
  };
  await rewriteLinkedInContent({ subject: "S1", sender: "a@b.c", bodyText: "Body X", linkedInUrl: "https://www.linkedin.com/posts/z" }, { client });
  assert.match(seenPrompt, /Subject: S1/);
  assert.match(seenPrompt, /Body X/);
  assert.match(seenPrompt, /Source LinkedIn URL/);
});

test("the rewrite prompt forbids naming other companies and branded hashtags", async () => {
  let seenPrompt = "";
  const client = {
    messages: { create: async ({ messages }) => { seenPrompt = messages[0].content; return { content: [{ type: "text", text: "out" }] }; } },
  };
  await rewriteLinkedInContent({ bodyText: "Body from enemysolar.com #EnemySolar @competitor" }, { client });
  assert.match(seenPrompt, /Only DeCircle Solar may be named/);
  assert.match(seenPrompt, /NEVER name, credit, promote, or\s+represent any other company/);
  assert.match(seenPrompt, /branded hashtags or @mentions/);
  assert.match(seenPrompt, /branded hashtags or @mentions/);
  assert.match(seenPrompt, /NEVER carry over another organisation's branded hashtags/);
});

test("rewriteLinkedInContent throws when Claude returns no text", async () => {
  await assert.rejects(
    () => rewriteLinkedInContent({ bodyText: "x" }, { client: stubClient("") }),
    /returned no text/,
  );
});

test("rewriteLinkedInContent rejects output over LinkedIn's limit", async () => {
  await assert.rejects(
    () => rewriteLinkedInContent({ bodyText: "x" }, { client: stubClient("a".repeat(3000)) }),
    /LinkedIn's limit/,
  );
});