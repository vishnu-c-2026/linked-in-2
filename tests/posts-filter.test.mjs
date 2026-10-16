import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { configure } from "../src/store.js";
import { postsRouter } from "../src/routes/posts.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "li-posts-filter-"));
const postsFile = path.join(tmpDir, "posts.json");
configure({ postsFile, ledgerFile: path.join(tmpDir, "processed-emails.json") });

const rows = () => [
  { id: 1, mode: "email", headline: "H1", caption: "Post one text", status: "posted", error: "" },
  { id: 2, mode: "newsletter", headline: "H2", caption: "News one text", status: "pending", error: "", newsletter: { windowDays: 6, postsScraped: 1, posts: [], generatedAt: "2026-10-16T09:00:00Z" } },
  { id: 3, mode: "manual", headline: "H3", caption: "Post two text", status: "posted", error: "" },
];

beforeEach(() => fs.writeFileSync(postsFile, JSON.stringify(rows())));
after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

function handler(method, routePath) {
  const layer = postsRouter.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  return layer.route.stack[0].handle;
}

function renderDashboard(query = {}) {
  let body = "";
  const res = { send: (html) => { body = html; } };
  handler("get", "/")({ query }, res);
  return body;
}

test("default view shows posts and newsletter items together", () => {
  const html = renderDashboard({});
  assert.match(html, /Post #1/);
  assert.match(html, /Post #2/);
  assert.match(html, /News #1/);
  assert.match(html, /All \(3\)/);
  assert.match(html, /Posts \(2\)/);
  assert.match(html, /Newsletter \(1\)/);
});

test("filter=posts hides newsletter items", () => {
  const html = renderDashboard({ filter: "posts" });
  assert.match(html, /Post #1/);
  assert.match(html, /Post #2/);
  assert.doesNotMatch(html, /News #\d/);
  assert.doesNotMatch(html, /News one text/);
  assert.match(html, /href="\/\?filter=posts" class="cur"/);
});

test("filter=news shows only newsletter items", () => {
  const html = renderDashboard({ filter: "news" });
  assert.match(html, /News #1/);
  assert.doesNotMatch(html, /Post #\d/);
  assert.doesNotMatch(html, /Post one text/);
  assert.match(html, /href="\/\?filter=news" class="cur"/);
});

test("an unknown filter falls back to showing everything", () => {
  const html = renderDashboard({ filter: "bogus" });
  assert.match(html, /Post #1/);
  assert.match(html, /News #1/);
  assert.match(html, /href="\/\?filter=all" class="cur"/);
});

test("reject keeps the active filter in its redirect", () => {
  let target = "";
  const res = { redirect: (url) => { target = url; } };
  handler("post", "/reject/:id")({ params: { id: "1" }, body: { filter: "news" } }, res);
  assert.equal(target, "/?filter=news");
});

test("reject returns to the default view with no filter", () => {
  let target = "";
  const res = { redirect: (url) => { target = url; } };
  handler("post", "/reject/:id")({ params: { id: "1" }, body: {} }, res);
  assert.equal(target, "/");
});
