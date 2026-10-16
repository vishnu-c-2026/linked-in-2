import "dotenv/config";
import { pathToFileURL } from "url";
import { listMessages, getMessage } from "./service.js";
import { normalizeEmail } from "./parser.js";
import { rewriteLinkedInContent } from "../services/claude-rewrite.js";
import {
  configure as configureStore,
  loadLedger,
  saveLedger,
  loadPosts,
  savePosts,
  markMessage,
  ledgerOf,
  isProcessed,
  appendDraft,
} from "../store.js";

export { loadLedger, saveLedger, loadPosts, savePosts, markMessage, ledgerOf, isProcessed, appendDraft };

export const STATUS = {
  RECEIVED: "RECEIVED",
  PROCESSING: "PROCESSING",
  PROCESSED: "PROCESSED",
  FAILED: "FAILED",
};

// maxAttempts is processor-specific, so it stays here; file paths live in the store.
const settings = { maxAttempts: 3 };

export function configure(opts = {}) {
  const files = {};
  if (opts.ledgerFile !== undefined) files.ledgerFile = opts.ledgerFile;
  if (opts.postsFile !== undefined) files.postsFile = opts.postsFile;
  if (Object.keys(files).length) configureStore(files);
  if (opts.maxAttempts != null) state.maxAttempts = opts.maxAttempts;
}

const state = { maxAttempts: 3 };

export async function processOne(messageId, deps = {}) {
  const {
    get = getMessage,
    parse = normalizeEmail,
    rewrite = rewriteLinkedInContent,
  } = deps;
  const id = String(messageId);
  const rec = ledgerOf(id) || { attempts: 0 };

  if (rec.status === STATUS.PROCESSED) return { id, status: STATUS.PROCESSED, skipped: true };
  if (rec.status === STATUS.PROCESSING) return { id, status: STATUS.PROCESSING, skipped: true, error: "Already processing" };
  if (rec.status === STATUS.FAILED && rec.attempts >= state.maxAttempts) {
    return { id, status: STATUS.FAILED, skipped: true, error: "Max attempts reached" };
  }

  markMessage(id, STATUS.PROCESSING);
  try {
    const msg = await get(id);
    const email = await parse(msg);

    if (!email.bodyText && !email.linkedInUrl) {
      markMessage(id, STATUS.FAILED, { attempts: (ledgerOf(id)?.attempts || 0) + 1, error: "No usable LinkedIn content in email" });
      return { id, status: STATUS.FAILED, error: "No usable LinkedIn content in email" };
    }

    const caption = await rewrite(email);
    appendDraft({ email, caption });

    markMessage(id, STATUS.PROCESSED, { subject: email.subject, sender: email.sender });
    return { id, status: STATUS.PROCESSED, draftCaption: caption };
  } catch (e) {
    markMessage(id, STATUS.FAILED, { attempts: (ledgerOf(id)?.attempts || 0) + 1, error: String((e && e.message) || e) });
    return { id, status: STATUS.FAILED, error: String((e && e.message) || e) };
  }
}

export async function checkInbox({ query, maxResults = 10, deps = {} } = {}) {
  const { list = listMessages } = deps;
  const messages = await list({ query, maxResults });
  const results = [];
  for (const m of messages) {
    const rec = ledgerOf(m.id);
    if (rec && [STATUS.PROCESSED, STATUS.RECEIVED, STATUS.PROCESSING].includes(rec.status)) {
      results.push({ id: m.id, status: rec.status, skipped: true });
      continue;
    }
    if (rec && rec.status === STATUS.FAILED && (rec.attempts || 0) >= state.maxAttempts) {
      results.push({ id: m.id, status: STATUS.FAILED, skipped: true, error: "Max attempts reached" });
      continue;
    }
    markMessage(m.id, STATUS.RECEIVED);
    results.push(await processOne(m.id, deps));
  }
  return results;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const isOnce = process.argv.includes("--once");
  if (!isOnce) {
    console.log("Usage: node src/gmail/processor.js --once");
    process.exit(1);
  }
  checkInbox()
    .then((results) => {
      console.log(
        results.map((r) => `${r.status}${r.skipped ? " (skipped)" : ""} ${r.id}${r.error ? ` - ${r.error}` : ""}`).join("\n") ||
          "No new unprocessed messages.",
      );
    })
    .catch((e) => {
      console.log("Gmail check failed:", e.code || "", e.message);
      process.exit(1);
    });
}
