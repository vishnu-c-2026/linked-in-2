import { esc } from "../util.js";
import { imageMode } from "../config.js";
import { snippet } from "./snippet.js";
import { previewButton, previewModal } from "./preview.js";

export function renderPostItem(r, n, filter = "all") {
  const num = Number.isInteger(n) && n > 0
    ? `<p class="post-num">${r.mode === "newsletter" ? "News" : "Post"} #${n}</p>`
    : "";
  // Carry the active dashboard filter through approve/reject/regenerate/upload.
  const filterField = filter !== "all" ? `<input type="hidden" name="filter" value="${esc(filter)}">` : "";
  const emailPanel = r.email ? `
    <div class="email-src">
      <p class="meta">${esc(r.email.sender || "Unknown sender")}${r.email.receivedAt ? " &middot; " + esc(new Date(r.email.receivedAt).toLocaleString()) : ""}</p>
      ${r.email.subject ? `<p class="meta subj">${esc(r.email.subject)}</p>` : ""}
      ${r.email.sourceLinkedInUrl ? `<p class="meta"><a href="${esc(r.email.sourceLinkedInUrl)}" target="_blank" rel="noopener noreferrer">Source LinkedIn post</a></p>` : ""}
      ${r.email.originalBody ? `<details><summary>Original email</summary><pre class="raw">${esc(r.email.originalBody)}</pre></details>` : ""}
    </div>` : "";
  const nl = r.newsletter;
  const nlPanel = nl ? `
    <div class="email-src">
      <p class="meta">Newsletter digest &middot; last ${esc(nl.windowDays)} days &middot; ${esc(nl.postsScraped)} post${nl.postsScraped === 1 ? "" : "s"}${nl.trigger ? ` &middot; ${esc(nl.trigger)}` : ""}</p>
      ${nl.generatedAt ? `<p class="meta">Generated ${esc(new Date(nl.generatedAt).toLocaleString())}</p>` : ""}
      ${(nl.posts || []).map((p) => p && p.url).filter(Boolean).slice(0, 10).map((u) => `<p class="meta"><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">Source post</a></p>`).join("")}
    </div>` : "";
  const imgVer = r.imageAt ? `?v=${r.imageAt}` : "";
  const replaceable = !["posted", "rejected"].includes(r.status) && r.mode !== "newsletter";
  const pvId = `pv-${r.id}`;
  const taId = `cap-${r.id}`;
  const editable = ["pending", "failed"].includes(r.status) && r.caption;
  return `
    <section class="item">
      <div>
        ${r.image ? `<img src="/${r.image}${imgVer}" alt="Generated LinkedIn image">` : "<div></div>"}
        ${replaceable ? `${imageMode() !== "none" ? `<form method="post" action="/regenerate-image/${r.id}" style="margin-top:12px" onsubmit="var b=this.querySelector('button');b.disabled=true;b.textContent='Generating... this can take 2-3 minutes'">${filterField}<button type="submit" class="regenerate">Regenerate image</button></form>` : ""}
        <form method="post" action="/upload-image/${r.id}" enctype="multipart/form-data" style="margin-top:6px" onsubmit="var b=this.querySelector('button');b.disabled=true;b.textContent='Uploading...'">
          <input type="file" name="image" accept="image/png,image/jpeg,image/webp" required style="width:100%;margin-bottom:6px">
          ${filterField}<button type="submit" class="upload">Replace with your image</button>
        </form>` : ""}
      </div>
      <div>
        ${emailPanel}${nlPanel}
        ${num}
        <p class="status ${r.status}">${r.status[0].toUpperCase() + r.status.slice(1)}</p>
        ${editable
          ? `<form method="post" action="/approve/${r.id}">
              ${filterField}
              <textarea id="${taId}" name="caption" aria-label="Post text">${esc(r.caption)}</textarea>
              <div class="row"><button class="approve">Approve and post</button>
              <button class="reject" formaction="/reject/${r.id}">Reject</button>${previewButton({ pvId })}</div></form>`
          : `<p class="cap-snip">${snippet(r.caption || "")}</p><div class="row">${previewButton({ pvId })}</div>`}
        ${previewModal({ pvId, caption: r.caption, image: r.image, imageAt: r.imageAt, editable: !!editable, syncId: taId })}
        ${r.error ? `<p class="err">${esc(r.error)}</p>` : ""}
      </div></section>`;
}
