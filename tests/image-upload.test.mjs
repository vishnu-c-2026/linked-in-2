import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "li-upload-"));
const postsFile = path.join(tmpDir, "posts.json");

let app, server, store, IMAGES_DIR;
const BASE = () => `http://localhost:${server.address().port}`;

const posts = [
  { id: 111, headline: "h1", caption: "c1", image: "", status: "pending", error: "" },
  { id: 222, headline: "h2", caption: "c2", image: "", status: "posted", error: "" },
  { id: 333, headline: "h3", caption: "c3", image: "", status: "rejected", error: "" },
  { id: 444, headline: "h4", caption: "c4", image: "", status: "pending", error: "" },
  { id: 555, headline: "h5", caption: "c5", image: "", status: "pending", error: "" },
];

before(async () => {
  process.env.NODE_ENV = "test";
  store = await import("../src/store.js");
  ({ IMAGES_DIR } = await import("../src/config.js"));
  store.configure({ postsFile });
  fs.writeFileSync(postsFile, JSON.stringify(posts));
  ({ app } = await import("../src/index.js"));
  server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
});

after(() => {
  server.close();
  for (const p of posts) fs.rmSync(path.join(IMAGES_DIR, `${p.id}.png`), { force: true });
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const pngBuffer = (r, g, b) => sharp({
  create: { width: 640, height: 640, channels: 3, background: { r, g, b } },
}).png().toBuffer();

async function postUpload(id, { name = "shot.png", type = "image/png", data }) {
  const fd = new FormData();
  fd.append("image", new Blob([data], { type }), name);
  const res = await fetch(`${BASE()}/upload-image/${id}`, { method: "POST", body: fd, redirect: "manual" });
  return res;
}

const findPost = (id) => store.loadPosts().find((p) => p.id === id);

test("uploading an image replaces the post's image and cache-busts it", async () => {
  const res = await postUpload(111, { data: await pngBuffer(10, 120, 200) });
  assert.equal(res.status, 302);

  const post = findPost(111);
  assert.equal(post.image, "images/111.png");
  assert.ok(post.imageAt, "imageAt must be set so the browser refetches the file");
  assert.equal(post.error, "");

  const meta = await sharp(path.join(IMAGES_DIR, "111.png")).metadata();
  assert.equal(meta.width, 1080, "output is normalised to 1080 wide");
  assert.equal(meta.height, 1350, "output is normalised to 1350 tall (4:5)");
  assert.equal(meta.format, "png");
});

test("uploading to a posted post is ignored", async () => {
  const res = await postUpload(222, { data: await pngBuffer(1, 2, 3) });
  assert.equal(res.status, 302);
  const post = findPost(222);
  assert.equal(post.image, "", "posted post must not change");
  assert.equal(post.imageAt, undefined);
  assert.ok(!fs.existsSync(path.join(IMAGES_DIR, "222.png")));
});

test("uploading to a rejected post is ignored", async () => {
  const res = await postUpload(333, { data: await pngBuffer(4, 5, 6) });
  assert.equal(res.status, 302);
  assert.equal(findPost(333).image, "");
  assert.ok(!fs.existsSync(path.join(IMAGES_DIR, "333.png")));
});

test("a non-image payload is rejected with an inline error, not a 500", async () => {
  const res = await postUpload(444, { data: Buffer.from("this is not an image"), type: "image/png" });
  assert.equal(res.status, 302);
  const post = findPost(444);
  assert.match(post.error, /Image upload failed/);
  assert.equal(post.image, "", "no image is stored when decoding fails");
});

test("an unsupported mime type is rejected by the file filter", async () => {
  const res = await postUpload(555, { name: "doc.pdf", data: Buffer.from("%PDF-1.4"), type: "application/pdf" });
  assert.equal(res.status, 302);
  assert.match(findPost(555).error, /Unsupported image type/);
});

test("an unknown post id redirects without crashing", async () => {
  const res = await postUpload(999999, { data: await pngBuffer(7, 8, 9) });
  assert.equal(res.status, 302);
});
