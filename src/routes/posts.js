import express from "express";
import multer from "multer";
import { loadPosts, savePosts } from "../store.js";
import { renderPostItem } from "../views/post-item.js";
import { page } from "../views/layout.js";
import { pickTopic, makeCaption } from "../services/claude.js";
import { generateImageForPost, replaceImageFromBuffer } from "../services/image.js";
import { postToLinkedIn } from "../services/linkedin.js";

export const postsRouter = express.Router();

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ACCEPTED_UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp"];

// Dashboard view filter: "all" (default), "posts" (regular posts) or "news"
// (newsletter digests). Anything else falls back to "all".
const dashFilter = (q) => (["posts", "news"].includes(q) ? q : "all");
// Where an action should land after it redirects, keeping the active filter.
const backTo = (q) => {
  const f = dashFilter(q);
  return f === "all" ? "/" : `/?filter=${f}`;
};

// Buffered upload: sharp re-encodes it to 1080x1350 before it is ever written
// to disk, so a rejected or oversized file never lands in images/.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (ACCEPTED_UPLOAD_TYPES.includes(file.mimetype)) return cb(null, true);
    cb(new Error(`Unsupported image type (${file.mimetype || "unknown"}). Use PNG, JPEG or WebP.`));
  },
});

postsRouter.get("/", (req, res) => {
  const filter = dashFilter(req.query.filter);
  const rows = loadPosts().reverse();
  const shown = rows.filter((r) => filter === "all" || (filter === "news") === (r.mode === "newsletter"));

  // Posts and News are numbered in separate sequences.
  let postN = 0;
  let newsN = 0;
  const items = shown
    .map((r) => (r.mode === "newsletter" ? renderPostItem(r, ++newsN, filter) : renderPostItem(r, ++postN, filter)))
    .join("");

  const newsCount = rows.filter((r) => r.mode === "newsletter").length;
  const postCount = rows.length - newsCount;
  const tab = (val, label, count) =>
    `<a href="/?filter=${val}"${filter === val ? ' class="cur"' : ""}>${label} (${count})</a>`;
  const tabs = `<div class="pager">${tab("all", "All", rows.length)}${tab("posts", "Posts", postCount)}${tab("news", "Newsletter", newsCount)}</div>`;

  const nlDays = Number(process.env.NEWSLETTER_LOOKBACK_DAYS) || 6;
  res.send(page("LinkedIn approvals", "posts", `
<h1>Posts waiting for approval</h1>
<form class="gen" method="post" action="/generate" onsubmit="var b=this.querySelector('button');b.disabled=true;b.textContent='Generating... this can take 2-3 minutes'">
<input name="headline" placeholder="Type a headline to use, or leave empty to pick today's solar news automatically" aria-label="Headline (optional)"><button>Generate post</button></form>
<form class="gen" method="post" action="/gmail-post" onsubmit="var b=this.querySelector('button');b.disabled=true;b.textContent='Fetching mail + AI + image... can take 2-3 min'"><button>gmail-post</button></form>
<form class="gen" method="post" action="/newsletter/generate-digest" onsubmit="var b=this.querySelector('button');b.disabled=true;b.textContent='Scraping posts + writing... this can take 1-3 minutes'"><button>Generate newsletter digest (last ${nlDays} days)</button></form>
${tabs}
${items || "<p>No posts yet. Generate one to review it here.</p>"}`));
});

postsRouter.post("/generate", async (req, res) => {
  let headline = ((req.body && req.body.headline) || "").trim();
  const rows = loadPosts();
  const post = { id: Date.now(), headline, mode: headline ? "manual" : "auto", caption: "", image: "", status: "pending", error: "" };
  try {
    let context = "";
    if (!headline) {
      // Auto mode: nothing typed, so find today's story from current news
      const topic = await pickTopic(rows.map((r) => r.headline).filter(Boolean).slice(-10));
      headline = topic.headline;
      context = topic.news_summary;
      post.headline = headline;
    }
    post.caption = await makeCaption(headline, context);
    post.image = await generateImageForPost(headline, post.id, post.caption);
  } catch (e) {
    post.status = "failed";
    post.error = e.message;
  }
  rows.push(post);
  savePosts(rows);
  res.redirect("/");
});

postsRouter.post("/approve/:id", async (req, res) => {
  const rows = loadPosts();
  const post = rows.find((r) => String(r.id) === req.params.id);
  if (post) {
    post.caption = req.body.caption;
    try {
      // Newsletter digests are text-only by design; every other mode may get an image.
      if (!post.image && post.mode !== "newsletter") {
        const image = await generateImageForPost(post.headline || post.caption, post.id, post.caption);
        if (image) post.image = image;
      }
      post.linkedinId = await postToLinkedIn(post.caption, post.image);
      post.status = "posted";
      post.error = "";
    } catch (e) {
      post.status = "failed";
      post.error = e.message;
    }
    savePosts(rows);
  }
  res.redirect(backTo(req.body.filter));
});

postsRouter.post("/reject/:id", (req, res) => {
  const rows = loadPosts();
  const post = rows.find((r) => String(r.id) === req.params.id);
  if (post) { post.status = "rejected"; savePosts(rows); }
  res.redirect(backTo(req.body.filter));
});

postsRouter.post("/regenerate-image/:id", async (req, res) => {
  const rows = loadPosts();
  const post = rows.find((r) => String(r.id) === req.params.id);
  if (post && !["posted", "rejected"].includes(post.status)) {
    try {
      const image = await generateImageForPost(post.headline || post.caption, post.id, post.caption);
      if (image) {
        post.image = image;
        post.imageAt = Date.now();
        post.error = "";
      }
    } catch (e) {
      post.error = e.message;
    }
    savePosts(rows);
  }
  res.redirect(backTo(req.body.filter));
});

postsRouter.post("/upload-image/:id", (req, res) => {
  const rows = loadPosts();
  const post = rows.find((r) => String(r.id) === req.params.id);
  if (!post || ["posted", "rejected"].includes(post.status)) return res.redirect(backTo(req.body && req.body.filter));

  // Multer errors (size limit, unsupported type) arrive as `err`; every path
  // below records the message on the post so the user sees it in the dashboard.
  upload.single("image")(req, res, async (err) => {
    const fail = (message) => {
      post.error = `Image upload failed: ${message}`;
      savePosts(rows);
      return res.redirect(backTo(req.body && req.body.filter));
    };

    if (err) return fail(err.message);
    if (!req.file) return fail("no file was selected.");

    try {
      post.image = await replaceImageFromBuffer(post.id, req.file.buffer);
      post.imageAt = Date.now();
      post.error = "";
    } catch (e) {
      return fail(e.message);
    }
    savePosts(rows);
    res.redirect(backTo(req.body && req.body.filter));
  });
});
