import { test } from "node:test";
import assert from "node:assert/strict";
import { shortenUrl } from "../src/services/shortener.js";

const longPost = (id) => `https://www.linkedin.com/posts/x-activity-${id}-abc`;
const res = (text, ok = true) => ({ ok, text: async () => text });

test("shortenUrl returns the provider's short link", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return res("https://is.gd/Ab3xYz");
  };

  const out = await shortenUrl(longPost(1001), { fetchImpl, minIntervalMs: 0 });

  assert.equal(out, "https://is.gd/Ab3xYz");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /is\.gd\/create\.php/);
  assert.match(calls[0], /url=https%3A%2F%2Fwww\.linkedin\.com/);
});

test("shortenUrl falls back to the next provider when the first fails", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes("is.gd")) return res("error: rate limited", false);
    return res("https://tinyurl.com/abc123");
  };

  const out = await shortenUrl(longPost(1002), { fetchImpl, minIntervalMs: 0 });

  assert.equal(out, "https://tinyurl.com/abc123");
  assert.equal(calls.length, 2);
  assert.match(calls[0], /is\.gd/);
  assert.match(calls[1], /tinyurl\.com/);
});

test("shortenUrl falls back to the canonical permalink when every provider fails", async () => {
  const fetchImpl = async () => res("boom", false);
  const out = await shortenUrl(longPost(1003), { fetchImpl, minIntervalMs: 0 });
  assert.equal(out, "https://www.linkedin.com/feed/update/urn:li:activity:1003/");
});

test("shortenUrl treats a non-URL response as a failure", async () => {
  const fetchImpl = async () => res("not a url");
  const out = await shortenUrl(longPost(1004), { fetchImpl, minIntervalMs: 0 });
  assert.equal(out, "https://www.linkedin.com/feed/update/urn:li:activity:1004/");
});

test("shortenUrl returns non-http input unchanged", async () => {
  assert.equal(await shortenUrl(""), "");
  assert.equal(await shortenUrl("mailto:x@example.com", { providers: [] }), "mailto:x@example.com");
  assert.equal(await shortenUrl("ftp://example.com/f", { providers: [] }), "ftp://example.com/f");
});

test("shortenUrl caches a resolved link and does not call out again", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return res("https://is.gd/Cache1");
  };
  const url = longPost(1005);

  const a = await shortenUrl(url, { fetchImpl, minIntervalMs: 0 });
  const b = await shortenUrl(url, { fetchImpl, minIntervalMs: 0 });

  assert.equal(a, "https://is.gd/Cache1");
  assert.equal(b, "https://is.gd/Cache1");
  assert.equal(calls.length, 1);
});

test("shortenUrl with no providers falls back to the canonical permalink", async () => {
  const out = await shortenUrl(longPost(1006), { providers: [], minIntervalMs: 0 });
  assert.equal(out, "https://www.linkedin.com/feed/update/urn:li:activity:1006/");
});

test("URL_SHORTENER=none disables the shortener", async () => {
  const saved = process.env.URL_SHORTENER;
  try {
    process.env.URL_SHORTENER = "none";
    const out = await shortenUrl(longPost(1007), { minIntervalMs: 0 });
    assert.equal(out, "https://www.linkedin.com/feed/update/urn:li:activity:1007/");
  } finally {
    if (saved === undefined) delete process.env.URL_SHORTENER;
    else process.env.URL_SHORTENER = saved;
  }
});
