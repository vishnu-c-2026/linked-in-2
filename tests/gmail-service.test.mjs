import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { listMessages, getMessage, gmailToken, __resetTokenCache } from "../src/gmail/service.js";

beforeEach(() => {
  __resetTokenCache();
  process.env.GOOGLE_CLIENT_ID = "cid";
  process.env.GOOGLE_CLIENT_SECRET = "csecret";
  process.env.GOOGLE_GMAIL_REFRESH_TOKEN = "refresh-xyz";
});

function mockFetch(handler) {
  globalThis.fetch = async (url, init) => handler(String(url), init);
}

function withToken(handler) {
  return (url) => {
    if (url === "https://oauth2.googleapis.com/token") {
      return new Response(JSON.stringify({ access_token: "at-1", expires_in: 3600 }), { status: 200 });
    }
    return handler(url);
  };
}

test("gmailToken refreshes and caches a working access token", async () => {
  let calls = 0;
  mockFetch(async (url) => {
    if (url === "https://oauth2.googleapis.com/token") {
      calls++;
      return new Response(JSON.stringify({ access_token: "at-1", expires_in: 3600 }), { status: 200 });
    }
    throw new Error(`unexpected ${url}`);
  });
  const a = await gmailToken();
  const b = await gmailToken();
  assert.equal(a, "at-1");
  assert.equal(b, "at-1");
  assert.equal(calls, 1);
});

test("gmailToken throws a typed error when no refresh token is configured", async () => {
  delete process.env.GOOGLE_GMAIL_REFRESH_TOKEN;
  await assert.rejects(() => gmailToken(), (e) => e.code === "no-token");
});

test("gmailToken reports an expired/revoked token", async () => {
  mockFetch(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
  await assert.rejects(() => gmailToken(), (e) => e.code === "expired");
});

test("listMessages passes the query and returns message ids", async () => {
  mockFetch(withToken(async (url) => {
    assert.match(url, /q=%28to%3Alinkedin-post-bot%40decirclesolar\.com%29\+is%3Aunread/);
    return new Response(JSON.stringify({ messages: [{ id: "m1", threadId: "t1" }] }), { status: 200 });
  }));
  const msgs = await listMessages({ query: "(to:linkedin-post-bot@decirclesolar.com) is:unread" });
  assert.deepEqual(msgs, [{ id: "m1", threadId: "t1" }]);
});

test("listMessages returns empty array when nothing matches", async () => {
  mockFetch(withToken(async () => new Response(JSON.stringify({ resultSizeEstimate: 0 }), { status: 200 })));
  assert.deepEqual(await listMessages({ query: "q" }), []);
});

test("listMessages rejects malformed responses", async () => {
  mockFetch(withToken(async () => new Response(JSON.stringify({ messages: { unexpected: true } }), { status: 200 })));
  await assert.rejects(() => listMessages({ query: "q" }), (e) => e.code === "malformed");
});

test("listMessages surfaces API errors", async () => {
  mockFetch(withToken(async () => new Response("{}", { status: 500 })));
  await assert.rejects(() => listMessages({ query: "q" }), (e) => e.code === "api");
});

test("getMessage decodes the raw RFC822 payload", async () => {
  const rfc822 = "Subject: Hi\n\nBody text";
  const raw = Buffer.from(rfc822).toString("base64url");
  mockFetch(withToken(async (url) => {
    assert.match(url, /messages\/m1\?format=raw/);
    return new Response(JSON.stringify({ id: "m1", threadId: "t1", raw }), { status: 200 });
  }));
  const msg = await getMessage("m1");
  assert.equal(msg.id, "m1");
  assert.equal(msg.rfc822, rfc822);
});

test("getMessage reports a missing message", async () => {
  mockFetch(withToken(async () => new Response("{}", { status: 404 })));
  await assert.rejects(() => getMessage("gone"), (e) => e.code === "missing");
});

test("getMessage rejects malformed payloads", async () => {
  mockFetch(withToken(async () => new Response(JSON.stringify({ id: "m1" }), { status: 200 })));
  await assert.rejects(() => getMessage("m1"), (e) => e.code === "malformed");
});