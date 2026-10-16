import { simpleParser } from "mailparser";

const LINKEDIN_HOST_RE = /linkedin\.com\//i;
const URL_RE = /https?:\/\/[^\s<>"'\u2028\u2029]+/gi;

export function extractLinkedInUrl(text) {
  if (!text) return "";
  const urlSafe = "A-Za-z0-9._~%+\\/?&=:#-";
  const collapsed = String(text)
    .replace(/[\u200b\u2060]/g, "")
    .replace(new RegExp(`([${urlSafe}])[ \\t]*\\r?\\n[ \\t]*([${urlSafe}])`, "g"), "$1$2")
    .replace(/[()[\]]+/g, " ");
  const found = collapsed.match(URL_RE) || [];
  for (const raw of found) {
    const url = raw.replace(/[.,;:!?]+$/, "");
    if (LINKEDIN_HOST_RE.test(url)) return url;
  }
  return "";
}

export function stripQuoteChain(text) {
  if (!text) return "";
  let t = String(text).replace(/\r\n/g, "\n");

  const sig = t.search(/\n-- ?\n/);
  if (sig >= 0) t = t.slice(0, sig);
  const dash = t.search(/\n-{3,}\s*\n?$/);
  if (dash >= 0) t = t.slice(0, dash);

  const cutPoints = [
    /\nOn .+ wrote:\s*(?:\n|$)/i,
    /\nFrom: .+\nSent: .+\nTo: .+\n/i,
    /\nFrom: .+\nDate: .+/i,
    /\n_{3,}\s*\n?/,
  ];
  for (const re of cutPoints) {
    const m = t.search(re);
    if (m >= 0) {
      t = t.slice(0, m);
      break;
    }
  }

  t = t.split("\n").filter((line) => !/^\s*>/.test(line) && !/^\s*(on .+ wrote:)/i.test(line)).join("\n");
  return t.trim();
}

function htmlToText(html) {
  if (!html) return "";
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|td|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function normalizeEmail({ id, rfc822 }) {
  const parsed = await simpleParser(rfc822);
  const bodyText = stripQuoteChain(parsed.text || htmlToText(parsed.html)) || "";
  const from = parsed.from && parsed.from.value && parsed.from.value[0];
  const sender = from ? (from.name ? `${from.name} <${from.address}>` : from.address || "") : "";
  const linkedInUrl = extractLinkedInUrl(
    (parsed.text || "") + "\n" + htmlToText(parsed.html || ""),
  );
  return {
    gmailMessageId: String(id),
    sender,
    subject: parsed.subject || "",
    receivedAt: parsed.date ? parsed.date.toISOString() : "",
    bodyText,
    bodyHtml: parsed.html || "",
    linkedInUrl,
  };
}