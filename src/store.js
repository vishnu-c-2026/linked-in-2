import fs from "fs";
import { POSTS_FILE, LEDGER_FILE } from "./config.js";

// Mutable so tests (and advanced setups) can point at temporary files.
const defaults = {
  ledgerFile: LEDGER_FILE,
  postsFile: POSTS_FILE,
};

export function configure(opts = {}) {
  Object.assign(defaults, opts);
}

const readJson = (file, fallback) => {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8")) ?? fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

export function loadPosts() {
  return readJson(defaults.postsFile, []);
}

export function savePosts(rows) {
  writeJson(defaults.postsFile, rows);
}

export function loadLedger() {
  return readJson(defaults.ledgerFile, {});
}

export function saveLedger(ledger) {
  writeJson(defaults.ledgerFile, ledger);
}

export function markMessage(id, status, extra = {}) {
  const ledger = loadLedger();
  ledger[id] = { ...(ledger[id] || {}), id, status, at: new Date().toISOString(), ...extra };
  saveLedger(ledger);
  return ledger[id];
}

export function ledgerOf(id) {
  return loadLedger()[String(id)];
}

export function isProcessed(id) {
  return ledgerOf(id)?.status === "PROCESSED";
}

export function appendDraft({ email, caption }) {
  const rows = loadPosts();
  const id = Date.now();
  const post = {
    id,
    mode: "email",
    headline: (email.subject || "Shared LinkedIn content").slice(0, 120),
    caption,
    image: "",
    status: "pending",
    error: "",
    email: {
      gmailMessageId: email.gmailMessageId,
      sender: email.sender,
      subject: email.subject,
      receivedAt: email.receivedAt,
      sourceLinkedInUrl: email.linkedInUrl,
      originalBody: email.bodyText,
    },
  };
  rows.push(post);
  savePosts(rows);
  return id;
}
