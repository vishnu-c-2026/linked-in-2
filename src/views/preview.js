import { esc } from "../util.js";

// A Preview toggle that opens the Bootstrap-style modal with id #pv-<id>. If the
// modal has an editable textarea it is first seeded from the post's textarea, so
// unsaved edits are what you preview. Pure inline onclick — no <script> tag.
export function previewButton({ pvId } = {}) {
  return `<button type="button" class="preview-btn" data-pv="${esc(pvId)}" onclick="var m=document.getElementById(this.dataset.pv);if(m){var e=m.querySelector('.li-edit');if(e&&e.dataset.sync){var s=document.getElementById(e.dataset.sync);if(s)e.value=s.value}m.hidden=false}">Preview</button>`;
}

// A Bootstrap-style modal (backdrop + centered dialog). Editable posts get a
// textarea that live-syncs to the post's caption field (data-sync), so Approve
// publishes the edited text; read-only posts render the caption as static text.
// The caption is server-rendered escaped; no <script> tag is used.
export function previewModal({ pvId, caption = "", image = "", imageAt = "", editable = false, syncId = "" } = {}) {
  const id = esc(pvId);
  const body = editable
    ? `<textarea class="li-edit" aria-label="Post text (editable preview)" data-sync="${esc(syncId)}" oninput="var t=document.getElementById(this.dataset.sync);if(t)t.value=this.value">${esc(caption)}</textarea>`
    : `<p class="li-text">${esc(caption)}</p>`;
  const img = image ? `<img class="li-image" src="/${esc(image)}${imageAt ? `?v=${esc(imageAt)}` : ""}" alt="">` : "";
  const close = `document.getElementById('${id}').hidden=true`;
  return `<div class="modal-backdrop" id="${id}" hidden onclick="if(event.target===this)this.hidden=true">
  <div class="modal-dialog" role="dialog" aria-modal="true" aria-label="Post preview">
    <div class="modal-header"><span class="li-avatar" aria-hidden="true">DS</span><span class="li-author">DeCircle Solar<span class="li-when">&middot; now</span></span><button type="button" class="modal-close" aria-label="Close" onclick="${close}">&times;</button></div>
    <div class="modal-body">${body}${img}</div>
    <div class="modal-footer"><button type="button" onclick="${close}">Close</button></div>
  </div>
</div>`;
}
