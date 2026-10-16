import "dotenv/config";
import fs from "fs";
import Anthropic from "@anthropic-ai/sdk";
import { MODEL, REWRITE_PROMPT_FILE } from "../config.js";

const LINKEDIN_MAX_CHARS = 2800;

export async function rewriteLinkedInContent(email, opts = {}) {
  const client = opts.client || new Anthropic();
  const guide = fs.existsSync(REWRITE_PROMPT_FILE) ? fs.readFileSync(REWRITE_PROMPT_FILE, "utf8") : "";

  const task =
    guide +
    "\n\n==================================================\nTHIS EMAIL\n==================================================\n" +
    (email.subject ? `Subject: ${email.subject}\n` : "") +
    (email.sender ? `From: ${email.sender}\n` : "") +
    (email.linkedInUrl ? `Source LinkedIn URL (reference only; do not claim it as our post): ${email.linkedInUrl}\n` : "") +
    "\nEmail content to rewrite:\n\n" +
    (email.bodyText || "").slice(0, 8000) +
    "\n\nReturn ONLY the final rewritten LinkedIn post text, with no preface, notes or word count.";

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    messages: [{ role: "user", content: task }],
  });

  const text = msg.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text) throw new Error("Claude returned no text for the rewrite");

  if (text.length > LINKEDIN_MAX_CHARS) {
    throw new Error(`Rewrite is ${text.length} characters; LinkedIn's limit is ${LINKEDIN_MAX_CHARS}.`);
  }
  return text;
}
