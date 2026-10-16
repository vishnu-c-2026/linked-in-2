import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Project root is one level above src/, resolved from this file so the app
// works no matter which directory it is started from.
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DATA_DIR = path.join(ROOT, "data");
export const IMAGES_DIR = path.join(ROOT, "images");
export const ASSETS_DIR = path.join(ROOT, "assets");
export const PROMPTS_DIR = path.join(ROOT, "prompts");

export const POSTS_FILE = path.join(DATA_DIR, "posts.json");
export const LEDGER_FILE = path.join(DATA_DIR, "processed-emails.json");
export const CAPTION_PROMPT_FILE = path.join(PROMPTS_DIR, "caption-prompt.txt");
export const REWRITE_PROMPT_FILE = path.join(PROMPTS_DIR, "email-rewrite-prompt.txt");
export const NEWSLETTER_PROMPT_FILE = path.join(PROMPTS_DIR, "newsletter-prompt.txt");

export const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";

// Which routine gives a post its image: "gemini" (AI infographic), "sharp"
// (base.png + headline overlay) or "none" (text-only post).
export const imageMode = () => (process.env.EMAIL_POST_IMAGE_MODE || "sharp").toLowerCase();
export const BASE_IMAGE = process.env.BASE_IMAGE || path.join(ASSETS_DIR, "base.png");
export const LINKEDIN_MAX_CHARS = 3000;
export const PORT = Number(process.env.PORT) || 5000;

// Generated images and runtime state are created on boot; both are gitignored.
fs.mkdirSync(IMAGES_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
