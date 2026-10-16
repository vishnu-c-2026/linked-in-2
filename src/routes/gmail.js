import express from "express";
import { esc } from "../util.js";
import { page } from "../views/layout.js";
import { loadPosts, savePosts } from "../store.js";
import { checkInbox } from "../gmail/processor.js";
import { generateImageForPost } from "../services/image.js";

export const gmailRouter = express.Router();

gmailRouter.get("/check-gmail", async (req, res) => {
  try {
    const results = await checkInbox({});
    res.send(page("Gmail check", "posts", `
<h1>Gmail check</h1>
<p>${results.length} message(s) processed this run.</p>
<ul>${results.map((r) => `<li>${esc(r.id)} &rarr; ${esc(r.status)}${r.skipped ? " (skipped)" : ""}${r.error ? " &middot; " + esc(r.error) : ""}</li>`).join("")}</ul>
<p><a href="/">Back to approvals</a></p>`));
  } catch (e) {
    const link = ["no-token", "expired", "forbidden"].includes(e.code)
      ? `<p><a href="/gmail/login">Connect Gmail</a> to read the inbox.</p>` : "";
    console.log("Gmail check failed:", e.code || "", e.message);
    res.send(page("Gmail check", "posts", `
<h1>Gmail check</h1>
<div class="notice"><p>${esc(e.message)}</p>${link}
<p><a href="/check-gmail">Try again</a></p></div>`));
  }
});

/* ---------- One-click: fetch new mail -> Claude caption -> image ---------- */

gmailRouter.post("/gmail-post", async (req, res) => {
  try {
    const results = await checkInbox({});
    const freshIds = new Set(results.filter((r) => r.status === "PROCESSED" && !r.skipped).map((r) => String(r.id)));
    const rows = loadPosts();
    let images = 0;
    const lines = [];
    for (const r of results) {
      const post = rows.find((p) => p.mode === "email" && p.email && String(p.email.gmailMessageId) === String(r.id));
      let note = r.error || "";
      if (freshIds.has(String(r.id)) && post) {
        if (!post.image) {
          try {
            post.image = await generateImageForPost(post.headline || post.caption, post.id, post.caption);
            if (post.image) images += 1;
          } catch (e) {
            note = "image failed: " + String((e && e.message) || e);
          }
        }
        if (post.image && !note) note = "image ready";
      } else if (r.skipped) {
        note = "already processed earlier";
      }
      lines.push({ subject: post ? post.headline : r.id, status: r.status, note });
    }
    savePosts(rows);
    res.send(page("Gmail post", "posts", `
<h1>Gmail post</h1>
<p>${freshIds.size} new email(s) processed, ${images} image(s) generated.</p>
${lines.length ? `<table><thead><tr><th>Email</th><th>Status</th><th>Detail</th></tr></thead><tbody>${lines
      .map((l) => `<tr><td>${esc(l.subject)}</td><td>${esc(l.status)}</td><td>${esc(l.note)}</td></tr>`)
      .join("")}</tbody></table>` : "<p>No messages matched the query.</p>"}
<p><a href="/">Back to approvals</a></p>`));
  } catch (e) {
    const link = ["no-token", "expired", "forbidden"].includes(e.code)
      ? `<p><a href="/gmail/login">Connect Gmail</a> to read the inbox.</p>` : "";
    console.log("Gmail post failed:", e.code || "", e.message);
    res.send(page("Gmail post", "posts", `
<h1>Gmail post</h1>
<div class="notice"><p>${esc(e.message)}</p>${link}
<p><a href="/">Back to approvals</a></p></div>`));
  }
});
