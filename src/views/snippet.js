import { esc } from "../util.js";

// Display cap for a post snippet; the full text stays on the page so the
// reader can expand it with the "…more" button.
export const CLIP = 500;

// Cuts a preview at a word boundary: back off the partial word at the cut,
// then drop dangling punctuation/bullets (e.g. a trailing "• ") so the
// preview never ends on a broken fragment.
export function clip(text) {
  if (text.length <= CLIP) return text;
  const cut = text.slice(0, CLIP);
  let end = cut.length;
  while (end > 0 && !/\s/.test(cut[end - 1])) end--;
  if (!end) return cut;
  return cut.slice(0, end).replace(/[\s\p{P}\p{S}\p{M}]+$/u, "") || cut;
}

// Long text renders two side-by-side copies; the buttons just swap the hidden
// attribute, so the full text is always present (and escaped) for expansion.
export function snippet(text) {
  const raw = text || "";
  if (raw.length <= CLIP) return esc(raw);
  const short = esc(clip(raw));
  const full = esc(raw);
  return `<span class="nl-clip">${short}… <button type="button" class="nl-more" onclick="this.parentNode.hidden=true;this.parentNode.nextElementSibling.hidden=false">…more</button></span><span class="nl-full" hidden>${full} <button type="button" class="nl-less" onclick="this.parentNode.hidden=true;this.parentNode.previousElementSibling.hidden=false">…less</button></span>`;
}
