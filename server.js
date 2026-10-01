import "dotenv/config";
import express from "express";
import fs from "fs";
import crypto from "crypto";
import sharp from "sharp";
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use("/images", express.static("images"));
fs.mkdirSync("images", { recursive: true });

const DB = "posts.json";
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
const BASE_IMAGE = process.env.BASE_IMAGE || "base.png";
const load = () => (fs.existsSync(DB) ? JSON.parse(fs.readFileSync(DB, "utf8")) : []);
const save = (rows) => fs.writeFileSync(DB, JSON.stringify(rows, null, 2));
const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- Caption (Claude) ---------- */

/* ---------- Auto mode: find today's topic from current news ---------- */

async function pickTopic(recentHeadlines = []) {
  const client = new Anthropic();
  const today = new Date().toDateString();
  const avoid = recentHeadlines.length ? `\nDo NOT repeat or closely resemble these recent headlines:\n- ${recentHeadlines.join("\n- ")}\n` : "";
  const task =
    `Today is ${today}. Use web search to find the most interesting RECENT news or data (ideally from the last 7 days) about India's solar and power sector ` +
    "that matters to solar-park developers: capacity additions, transmission and grid connectivity, storage, curtailment, financing, PPAs/tenders, policy or regulation, land, agrivoltaics.\n" +
    "Pick ONE strong, verifiable story. Do not pick rumours or unverified claims." + avoid +
    "\nReturn ONLY valid JSON, no markdown, in exactly this shape:\n" +
    '{"headline":"strong original LinkedIn headline in capital letters, max 15 words, not clickbait",' +
    '"news_summary":"4-6 sentences: what happened, key numbers with dates and geography, and the names of the sources you used"}';
  let msg;
  try {
    msg = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      messages: [{ role: "user", content: task }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
    });
  } catch (e) {
    throw new Error(`Could not search for news (web search may not be enabled on your Anthropic account): ${e.message}`);
  }
  let last = -1;
  msg.content.forEach((b, i) => { if (b.type === "web_search_tool_result") last = i; });
  const text = msg.content.slice(last + 1).filter((b) => b.type === "text").map((b) => b.text).join("");
  const json = text.match(/\{[\s\S]*\}/);
  if (!json) throw new Error("Could not pick a topic from today's news (no result returned)");
  const topic = JSON.parse(json[0]);
  if (!topic.headline || !topic.news_summary) throw new Error("Topic result was incomplete");
  return topic;
}

const CAPTION_PROMPT_FILE = "caption-prompt.txt";
const LINKEDIN_MAX_CHARS = 3000; // LinkedIn's limit for post text

async function makeCaption(headline, context = "") {
  if (!fs.existsSync(CAPTION_PROMPT_FILE)) {
    throw new Error(`"${CAPTION_PROMPT_FILE}" not found. Save your content prompt in this folder with that name.`);
  }
  const guide = fs.readFileSync(CAPTION_PROMPT_FILE, "utf8");
  const task =
    guide +
    "\n\n==================================================\nTODAY'S TASK\n==================================================\n" +
    `Topic / headline for today's post: ${headline}\n` +
    "Use this as the post's opening headline (you may tighten the wording slightly).\n" +
    (context ? `Background from today's news research (verify the numbers before using them):\n${context}\n` : "") +
    "TECHNICAL LIMIT THAT OVERRIDES THE WORD COUNT: LinkedIn rejects posts over 3,000 characters, so the final post must be " +
    "2,800 characters or fewer including spaces and hashtags (roughly 400-450 words). Follow the content priority list to decide what to keep.\n" +
    "Verify statistics with web search. If you cannot verify a number, leave it out.\n" +
    "Return ONLY the final post text, with no preface, notes or word count.";

  const client = new Anthropic();
  const params = { model: MODEL, max_tokens: 6000 };
  let msg;
  try {
    msg = await client.messages.create({
      ...params,
      messages: [{ role: "user", content: task }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
    });
  } catch (e) {
    console.log("Web search unavailable, writing the caption without it:", e.message);
    msg = await client.messages.create({
      ...params,
      messages: [{ role: "user", content: task + "\nWeb search is not available: do not include any statistic you are not certain about." }],
    });
  }
  // keep only the text written after the last web search result (drops "let me search..." chatter)
  let last = -1;
  msg.content.forEach((b, i) => { if (b.type === "web_search_tool_result") last = i; });
  const text = msg.content.slice(last + 1).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  if (!text) {
    console.log("Caption response:", msg.stop_reason, JSON.stringify(msg.content).slice(0, 500));
    throw new Error("Claude returned no text for the caption");
  }
  return text;
}

/* ---------- Image: Canva via Claude MCP connector, or local sharp fallback ---------- */

/* ---------- Infographic content + Canva brief ---------- */

// Claude writes the short texts that fill the infographic template.
async function makeInfographicContent(headline, caption = "") {
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [{
      role: "user",
      content:
        `Headline for a LinkedIn infographic aimed at an Indian energy-sector audience: ${headline}\n` +
        "Write the short texts for the infographic. Return ONLY valid JSON, no markdown, in exactly this shape:\n" +
        '{"supporting":"one short supporting sentence, max 14 words",' +
        '"columns":[{"heading":"2-3 words","text":"max 14 words"},{"heading":"...","text":"..."},{"heading":"...","text":"..."},{"heading":"...","text":"..."}],' +
        '"section_title":"short title, max 6 words",' +
        '"facts":["max 12 words","max 12 words","max 12 words"],' +
        '"closing":"one short closing message, max 14 words"}\n' +
        (caption ? `The LinkedIn post this infographic accompanies:\n${caption}\n\nBase the infographic only on facts and numbers that appear in that post. ` : "") +
        "Exactly 4 columns and 3 facts. Plain, correctly spelled words. Do not invent statistics or numbers.",
    }],
  });
  const raw = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim()
    .replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const c = JSON.parse(raw);
  if (!c.supporting || !Array.isArray(c.columns) || !c.columns.length || !c.section_title || !Array.isArray(c.facts) || !c.closing) {
    throw new Error("Infographic content from Claude was incomplete");
  }
  return c;
}

function buildBrief(headline, c) {
  const columns = c.columns
    .map((col, i) => `Column ${i + 1}: [simple vector icon] bold heading "${col.heading}" with text "${col.text}"`)
    .join("\n");
  const facts = c.facts.map((f) => `- ${f}`).join("\n");
  return `Create a premium corporate LinkedIn vertical infographic in a 4:5 portrait format, 1080 x 1350 px.

TOP SECTION - STRONG HEADLINE:
Place a large, bold, modern sans-serif headline at the top:
"${headline}"
Use dark navy/deep green typography with strong visual hierarchy. Keep the headline highly readable and professional. Add a short supporting statement below it:
"${c.supporting}"

HERO VISUAL:
Below the headline, create a large photorealistic hero image related to the topic: a large utility-scale solar park in India at golden hour from a slightly elevated perspective. Long, uniform rows of solar panels should lead from the foreground toward the horizon, curving naturally through the landscape. Include a high-voltage transmission tower, power lines, and a realistic electrical substation in the mid-ground to represent the connection between solar generation and the electricity grid. Use warm golden-hour sunlight, soft blue and amber sky gradients, atmospheric haze, realistic Indian landscape, rich but balanced colors, sharp professional photography, and realistic materials.

MIDDLE INFORMATION SECTION:
Under the hero image, create a clean white/cream information area divided into ${c.columns.length} evenly spaced columns. Each column contains a simple modern vector-style icon, a short bold heading, and 2-3 lines of concise explanatory text. Use consistent iconography, generous spacing, thin subtle dividers, and excellent alignment.
${columns}

KEY INSIGHT SECTION:
Create another structured section titled:
"${c.section_title}"
Use a combination of small icons, concise bullet-style facts, highlighted keywords, and one supporting circular or rounded-corner photorealistic image showing agrivoltaics - solar panels installed above or alongside crops.
Facts:
${facts}

BOTTOM SECTION - STRONG CLOSING MESSAGE:
Create a visually distinct dark green or deep navy footer banner that includes:
"${c.closing}"
Add a small supporting visual such as an India map or a solar icon.

DESIGN STYLE:
Premium corporate infographic, professional LinkedIn content, clean editorial layout, modern sustainability/energy branding, photorealistic photography combined with clean vector graphics. Palette: dark navy, deep green, warm yellow/gold, cream/white. Strong visual hierarchy, consistent typography, generous whitespace, clean alignment, subtle separators, minimal decorative elements. Sophisticated, credible business presentation, understood quickly while scrolling on LinkedIn.

IMPORTANT:
It should look like a professionally designed corporate communication piece, not a generic AI poster.
Avoid: clutter, excessive text, random icons, cartoonish illustrations, unrealistic solar panels, distorted infrastructure, excessive gradients, unnecessary decorative elements, watermarks, fake company logos, branding on equipment.
All text must be short, readable, correctly spelled, and professionally arranged. Use only the exact texts given above.`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const parseTool = (res) => {
  const text = (res.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  try { return JSON.parse(text); } catch { return { raw: text }; }
};

// Calls Canva's MCP server directly (no Claude in the loop), so we can wait properly while the design is generated.
async function makeImageWithCanva(headline, id, caption = "") {
  const transport = new StreamableHTTPClientTransport(new URL("https://mcp.canva.com/mcp"), {
    requestInit: { headers: { Authorization: `Bearer ${process.env.CANVA_ACCESS_TOKEN}` } },
  });
  const client = new Client({ name: "linkedin-poster", version: "1.0.0" });
  await client.connect(transport);
  try {
    // 1) Create the design
    let state = parseTool(await client.callTool({
      name: "create-design",
      arguments: {
        brief: buildBrief(headline, await makeInfographicContent(headline, caption)),
        format: "Instagram Post (Portrait 4:5, 1080x1350)",
        user_intent: "Create a 1080x1350 corporate LinkedIn infographic about India solar energy",
      },
    }));
    const jobId = state.job_id;
    if (!jobId) throw new Error(`Canva did not start a design job: ${JSON.stringify(state).slice(0, 300)}`);

    // 2) Poll, waiting as long as Canva asks (up to 5 minutes)
    const deadline = Date.now() + 5 * 60 * 1000;
    while (["pending", "in_progress", "polled_too_early"].includes(state.status)) {
      if (Date.now() > deadline) throw new Error("Canva design took too long (over 5 minutes)");
      await sleep(((state.polling_policy && state.polling_policy.wait_seconds) || 10) * 1000 + 1000);
      state = parseTool(await client.callTool({
        name: "get-create-design-async-job",
        arguments: { job_id: jobId, continuation_token: state.continuation_token, user_intent: "Poll design generation job" },
      }));
    }
    const designId = state.design && state.design.id;
    if (state.status !== "completed" || !designId) {
      throw new Error(`Canva design failed: ${JSON.stringify(state).slice(0, 300)}`);
    }

    // 3) Export the design as a 1080x1350 PNG
    const exp = parseTool(await client.callTool({
      name: "export-design",
      arguments: {
        design_id: designId,
        format: { type: "png", width: 1080, height: 1350, pages: [1] },
        user_intent: "Export the LinkedIn image as PNG",
      },
    }));
    fs.writeFileSync("canva-export.json", JSON.stringify(exp, null, 2)); // handy for debugging

    const found = [...JSON.stringify(exp).replace(/\\+\//g, "/").replace(/\\+u0026/g, "&").matchAll(/https?:\/\/[^"\s\\]+/g)].map((m) => m[0]);
    const url = found[0];
    if (!url) throw new Error("Canva export returned no download URL (see canva-export.json)");

    // 4) Download into images/
    const img = await fetch(url);
    if (!img.ok) throw new Error(`Canva image download failed: ${img.status}`);
    const out = `images/${id}.png`;
    await sharp(Buffer.from(await img.arrayBuffer())).resize(1080, 1350, { fit: "cover" }).png().toFile(out);
    return out;
  } finally {
    await client.close().catch(() => {});
  }
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

async function makeImageWithSharp(headline, id) {
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

// Tries Canva first; if Canva fails (for example quota exceeded), falls back to base.png + headline text.
async function makeImage(headline, id, caption = "") {
  if (process.env.CANVA_ACCESS_TOKEN) {
    try {
      return await makeImageWithCanva(headline, id, caption);
    } catch (e) {
      console.log("Canva failed, using fallback image:", e.message);
    }
  }
  return makeImageWithSharp(headline, id);
}

/* ---------- LinkedIn ---------- */

const escapeCommentary = (t) => t.replace(/([\\|{}@\[\]()<>*_~])/g, "\\$1"); // LinkedIn markup characters

async function postToLinkedIn(caption, imagePath) {
  const token = process.env.LINKEDIN_TOKEN;
  const author = (process.env.LINKEDIN_AUTHOR_URN || "").trim();
  if (!token || !author) throw new Error("LINKEDIN_TOKEN or LINKEDIN_AUTHOR_URN is missing in .env");
  if (!imagePath || !fs.existsSync(imagePath)) throw new Error("No generated image to post");

  const commentary = escapeCommentary(caption);
  if (commentary.length > LINKEDIN_MAX_CHARS) {
    throw new Error(`Post is ${commentary.length} characters; LinkedIn's limit is ${LINKEDIN_MAX_CHARS}. Shorten the text in the box and approve again.`);
  }

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
      commentary,
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

/* ---------- Canva OAuth (one-time: open /login, token is printed in the terminal) ---------- */

let verifier = "";
const b64url = (b) => b.toString("base64url");

app.get("/login", (req, res) => {
  verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const q = new URLSearchParams({
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "design:content:read design:content:write asset:read asset:write",
    response_type: "code",
    client_id: process.env.CANVA_CLIENT_ID,
    redirect_uri: process.env.CANVA_REDIRECT_URI,
  });
  res.redirect(`https://www.canva.com/api/oauth/authorize?${q}`);
});

app.get("/callback", async (req, res) => {
  try {
    const basic = Buffer.from(`${process.env.CANVA_CLIENT_ID}:${process.env.CANVA_CLIENT_SECRET}`).toString("base64");
    const r = await fetch("https://api.canva.com/rest/v1/oauth/token", {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: String(req.query.code || ""),
        code_verifier: verifier,
        redirect_uri: process.env.CANVA_REDIRECT_URI,
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(400).send(`Canva token request failed: ${esc(JSON.stringify(data))}`);
    console.log("Canva tokens (copy into .env, then delete this log):", data);
    res.send("Canva token printed in your terminal. You can close this tab.");
  } catch (e) {
    res.status(500).send(esc(e.message));
  }
});

/* ---------- Dashboard ---------- */

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
<form class="gen" method="post" action="/generate" onsubmit="var b=this.querySelector('button');b.disabled=true;b.textContent='Generating... this can take 2-3 minutes'">
<input name="headline" placeholder="Type a headline to use, or leave empty to pick today's solar news automatically" aria-label="Headline (optional)"><button>Generate post</button></form>
${items || "<p>No posts yet. Generate one to review it here.</p>"}
</main></body></html>`);
});

app.post("/generate", async (req, res) => {
  let headline = ((req.body && req.body.headline) || "").trim();
  const rows = load();
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
    post.image = await makeImage(headline, post.id, post.caption);
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