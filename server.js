import "dotenv/config";
import express from "express";
import fs from "fs";
import sharp from "sharp";
import Anthropic from "@anthropic-ai/sdk";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use("/images", express.static("images"));
fs.mkdirSync("images", { recursive: true });

const DB = "posts.json";
const BASE_IMAGE = process.env.BASE_IMAGE || "base.png";
const DEFAULT_HEADLINE =
  process.env.DEFAULT_HEADLINE ||
  "INDIA DOESN'T JUST NEED MORE SOLAR CAPACITY. IT NEEDS MORE USABLE SOLAR ENERGY";

const load = () => (fs.existsSync(DB) ? JSON.parse(fs.readFileSync(DB, "utf8")) : []);
const save = (rows) => fs.writeFileSync(DB, JSON.stringify(rows, null, 2));
const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function makeCaption(headline) {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY
  const msg = await client.messages.create({
    model: process.env.CLAUDE_MODEL || "claude-sonnet-5-5",
    max_tokens: 600,
    messages: [{
      role: "user",
      content:
        `Write a LinkedIn post for an Indian energy-sector audience built around this headline: ${headline}\n` +
        "Under 900 characters, short paragraphs, one concrete insight about making solar usable " +
        "(curtailment, storage, transmission, demand matching), end with a question, at most 3 hashtags. " +
        "Return only the post text.",
    }],
  });
  return msg.content[0].text.trim();
}

function wrap(text, width = 24) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if ((line + " " + word).trim().length > width) { lines.push(line); line = word; }
    else line = (line + " " + word).trim();
  }
  if (line) lines.push(line);
  return lines;
}

async function makeImage(headline, id) {
  if (!fs.existsSync(BASE_IMAGE)) {
    throw new Error(`Base image "${BASE_IMAGE}" not found. Save your solar image in this folder with that name.`);
  }
  const lines = wrap(headline);
  const text = lines
    .map((l, i) => `<text x="80" y="${140 + i * 74}" font-family="Arial, Helvetica, sans-serif" font-size="58" font-weight="700" fill="#fff">${esc(l)}</text>`)
    .join("");
  const svg = `<svg width="1080" height="1350" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0a141e" stop-opacity="0.7"/><stop offset="1" stop-color="#0a141e" stop-opacity="0"/>
    </linearGradient></defs>
    <rect width="1080" height="560" fill="url(#g)"/>${text}</svg>`;
  const out = `images/${id}.png`;
  await sharp(BASE_IMAGE).resize(1080, 1350, { fit: "cover" })
    .composite([{ input: Buffer.from(svg) }]).png().toFile(out);
  return out;
}

const escapeCommentary = (t) => t.replace(/([\\|{}@\[\]()<>*_~])/g, "\\$1"); // LinkedIn markup characters

async function postToLinkedIn(caption, imagePath) {
  const token = process.env.LINKEDIN_TOKEN;
  const author = process.env.LINKEDIN_AUTHOR_URN;
  const headers = {
    Authorization: `Bearer ${token}`,
    "LinkedIn-Version": process.env.LINKEDIN_VERSION || "202506",
    "X-Restli-Protocol-Version": "2.0.0",
    "Content-Type": "application/json",
  };
  const init = await fetch("https://api.linkedin.com/rest/images?action=initializeUpload", {
    method: "POST", headers, body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
  });
  if (!init.ok) throw new Error(`Image init failed: ${init.status} ${await init.text()}`);
  const { value } = await init.json();
  const up = await fetch(value.uploadUrl, {
    method: "PUT", headers: { Authorization: `Bearer ${token}` }, body: fs.readFileSync(imagePath),
  });
  if (!up.ok) throw new Error(`Image upload failed: ${up.status}`);
  const res = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST", headers,
    body: JSON.stringify({
      author,
      commentary: escapeCommentary(caption),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      content: { media: { id: value.image, altText: "Solar park connected to the power grid at golden hour" } },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
  });
  if (!res.ok) throw new Error(`Post failed: ${res.status} ${await res.text()}`);
  return res.headers.get("x-restli-id") || "";
}

app.get("/", (req, res) => {
  const items = load().reverse().map((r) => `
    <section class="item">
      ${r.image ? `<img src="/${r.image}" alt="Generated LinkedIn image">` : "<div></div>"}
      <div>
        <p class="status ${r.status}">${r.status[0].toUpperCase() + r.status.slice(1)}</p>
        ${["pending", "failed"].includes(r.status) && r.caption
          ? `<form method="post" action="/approve/${r.id}">
              <textarea name="caption" aria-label="Post text">${esc(r.caption)}</textarea>
              <div class="row"><button class="approve">Approve and post</button>
              <button class="reject" formaction="/reject/${r.id}">Reject</button></div></form>`
          : `<p style="white-space:pre-wrap">${esc(r.caption || "")}</p>`}
        ${r.error ? `<p class="err">${esc(r.error)}</p>` : ""}
      </div></section>`).join("");
  res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>LinkedIn approvals</title>
<style>
:root{--ink:#14202a;--muted:#5d6b76;--line:#d5dce1;--bg:#eef1f3;--amber:#d98a1f;--ok:#1f7a4d;--bad:#b3372c}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,"Segoe UI",sans-serif}
main{max-width:980px;margin:0 auto;padding:32px 20px 64px}
h1{font-size:1.6rem;margin:0 0 20px}
.gen{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:32px}
.gen input{flex:1 1 320px;padding:10px 12px;border:1px solid var(--line);border-radius:6px;font:inherit}
button{padding:10px 18px;border:0;border-radius:6px;font:inherit;font-weight:600;cursor:pointer;background:var(--ink);color:#fff}
button.approve{background:var(--amber);color:#1b1206}
button.reject{background:transparent;color:var(--muted);border:1px solid var(--line)}
button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid var(--amber);outline-offset:2px}
.item{display:grid;grid-template-columns:280px 1fr;gap:24px;padding:24px 0;border-top:1px solid var(--line)}
.item img{width:100%;border-radius:4px;display:block;aspect-ratio:4/5;object-fit:cover;background:#cfd6db}
textarea{width:100%;min-height:210px;padding:12px;border:1px solid var(--line);border-radius:6px;font:inherit;resize:vertical}
.row{display:flex;gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap}
.status{font-weight:600}.posted{color:var(--ok)}.failed{color:var(--bad)}.rejected{color:var(--muted)}.pending{color:var(--amber)}
.err{color:var(--bad);font-size:.9rem;word-break:break-word}
@media(max-width:700px){.item{grid-template-columns:1fr}}
</style></head><body><main>
<h1>Posts waiting for approval</h1>
<form class="gen" method="post" action="/generate">
<input name="headline" value="${esc(DEFAULT_HEADLINE)}" aria-label="Headline"><button>Generate post</button></form>
${items || "<p>No posts yet. Generate one to review it here.</p>"}
</main></body></html>`);
});

app.post("/generate", async (req, res) => {
  const headline = (req.body.headline || "").trim() || DEFAULT_HEADLINE;
  const rows = load();
  const post = { id: Date.now(), headline, caption: "", image: "", status: "pending", error: "" };
  try {
    post.caption = await makeCaption(headline);
    post.image = await makeImage(headline, post.id);
  } catch (e) {
    post.status = "failed";
    post.error = e.message;
  }
  rows.push(post);
  save(rows);
  res.redirect("/");
});

app.post("/approve/:id", async (req, res) => {
  const rows = load();
  const post = rows.find((r) => String(r.id) === req.params.id);
  if (post) {
    post.caption = req.body.caption;
    try {
      post.linkedinId = await postToLinkedIn(post.caption, post.image);
      post.status = "posted";
      post.error = "";
    } catch (e) {
      post.status = "failed";
      post.error = e.message;
    }
    save(rows);
  }
  res.redirect("/");
});

app.post("/reject/:id", (req, res) => {
  const rows = load();
  const post = rows.find((r) => String(r.id) === req.params.id);
  if (post) { post.status = "rejected"; save(rows); }
  res.redirect("/");
});

app.listen(5000, () => console.log("Dashboard running at http://localhost:5000"));
