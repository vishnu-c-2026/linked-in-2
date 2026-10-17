import { esc } from "../util.js";
import { snippet } from "./snippet.js";
import { previewButton, previewModal } from "./preview.js";

const fmtDate = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString() : "";
};

function renderPost(p) {
  const meta = [
    fmtDate(p.postedAt),
    p.reactions ? `${p.reactions} reactions` : "",
    p.comments ? `${p.comments} comments` : "",
  ].filter(Boolean).join(" \u00b7 ");
  return `<li>
    <p class="nl-meta">${esc(meta)}${p.url ? ` \u00b7 <a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Open post</a>` : ""}</p>
    <p class="nl-snip">${snippet(p.text)}</p>
  </li>`;
}

// Pure render of the Newsletter tab from the saved digest draft — no API calls.
export function renderNewsletterView({ draft = null, days = 6 } = {}) {
  const button = draft
    ? `<form class="gen" method="post" action="/newsletter/generate-digest" onsubmit="var b=this.querySelector('button');b.disabled=true;b.textContent='Rewriting... this can take 1-3 minutes'"><button>Rewrite newsletter</button></form>`
    : `<form class="gen" method="post" action="/newsletter/generate-digest" onsubmit="var b=this.querySelector('button');b.disabled=true;b.textContent='Scraping + writing... this can take 1-3 minutes'"><button>Generate newsletter (last ${esc(days)} days)</button></form>`;

  if (!draft) {
    return `<h1>Newsletter</h1>
${button}
<div class="notice"><p>No newsletter has been generated yet. Generate one to summarize the last ${esc(days)} days of posts.</p></div>`;
  }

  const nl = draft.newsletter || {};
  const posts = nl.posts || [];
  const status = draft.status || "pending";
  const meta = [
    nl.generatedAt ? `Generated ${esc(new Date(nl.generatedAt).toLocaleString())}` : "",
    `last ${esc(nl.windowDays ?? days)} days`,
    `${esc(posts.length)} post${posts.length === 1 ? "" : "s"}`,
    nl.trigger ? `via ${esc(nl.trigger)}` : "",
  ].filter(Boolean).join(" \u00b7 ");

  return `<h1>Newsletter</h1>
${button}
<p class="status ${esc(status)}">${esc(status[0].toUpperCase() + status.slice(1))}</p>
<p class="nl-meta">${meta}</p>
${draft.caption
  ? `<div class="nl-digest">${esc(draft.caption)}</div>`
  : `<div class="notice"><p>This digest has no text.</p></div>`}
<div class="row">${previewButton({ pvId: `pv-nl-${draft.id}` })}</div>
${previewModal({ pvId: `pv-nl-${draft.id}`, caption: draft.caption, editable: false })}
${draft.error ? `<p class="err">${esc(draft.error)}</p>` : ""}
${posts.length ? `<h2 class="nl-sub">Posts this week (${posts.length})</h2><ul class="nl-posts">${posts.map(renderPost).join("")}</ul>` : ""}
<p style="margin-top:20px"><a href="/">Open the dashboard to approve or reject</a></p>`;
}
