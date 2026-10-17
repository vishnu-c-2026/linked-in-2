import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "li-nl-csv-"));
const postsFile = path.join(tmpDir, "posts.json");

let app, server, store;
const BASE = () => `http://localhost:${server.address().port}`;

const digest = {
  id: 9,
  mode: "newsletter",
  headline: "Newsletter digest",
  caption: "This week in solar.",
  image: "",
  status: "pending",
  error: "",
  newsletter: {
    windowDays: 6,
    postsScraped: 2,
    posts: [
      { url: "https://www.linkedin.com/posts/a", text: "Solar park milestone", postedAt: "2026-10-12T10:00:00Z", reactions: 12, comments: 3 },
      { url: "https://www.linkedin.com/posts/b", text: 'Grid "update", phase 2', postedAt: "2026-10-11T10:00:00Z", reactions: 4, comments: 0 },
    ],
    generatedAt: "2026-10-16T09:00:00Z",
    trigger: "manual",
  },
};

before(async () => {
  process.env.NODE_ENV = "test";
  store = await import("../src/store.js");
  store.configure({ postsFile, ledgerFile: path.join(tmpDir, "processed-emails.json") });
  fs.writeFileSync(postsFile, JSON.stringify([digest]));
  ({ app } = await import("../src/index.js"));
  server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
});

after(() => {
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("GET /newsletter/download.csv returns the digest's posts as an attachment", async () => {
  const res = await fetch(`${BASE()}/newsletter/download.csv?id=9`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^text\/csv/);
  assert.equal(res.headers.get("content-disposition"), 'attachment; filename="newsletter-2026-10-16.csv"');

  const buf = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], "UTF-8 BOM allows Excel to open it");

  const body = new TextDecoder("utf-8", { ignoreBOM: true }).decode(buf);
  assert.match(body, /Date,Reactions,Comments,URL,Text/);
  assert.match(body, /2026-10-12T10:00:00Z,12,3,https:\/\/www\.linkedin\.com\/posts\/a,Solar park milestone/);
  assert.ok(body.includes('"Grid ""update"", phase 2"'), "quotes and commas are RFC 4180 escaped");
  assert.ok(body.includes("\r\n"), "CRLF line endings");
});

test("an unknown newsletter id is a 404", async () => {
  const res = await fetch(`${BASE()}/newsletter/download.csv?id=999999`);
  assert.equal(res.status, 404);
});

test("a missing id is a 404", async () => {
  const res = await fetch(`${BASE()}/newsletter/download.csv`);
  assert.equal(res.status, 404);
});

test("a non-newsletter post id is a 404", async () => {
  store.savePosts([
    { id: 5, mode: "email", headline: "h", caption: "c", image: "", status: "pending", error: "" },
  ]);
  const res = await fetch(`${BASE()}/newsletter/download.csv?id=5`);
  assert.equal(res.status, 404);
  store.savePosts([digest]);
});
