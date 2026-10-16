import fs from "fs";
import path from "path";
import sharp from "sharp";
import { IMAGES_DIR, BASE_IMAGE, imageMode } from "../config.js";
import { esc, withBusyRetry } from "../util.js";
import { makeInfographicContent } from "./claude.js";

// Public URL path stored on the post; the file itself lives at IMAGES_DIR.
const imagePath = (id) => `images/${id}.png`;

// Image models tried in order: if one fails, the next is used before giving up.
const MODELS = [
  "gemini-3.8-flash",              // best quality
  "gemini-3-flash-preview",        // similar quality, different load
  "gemini-3.1-flash-lite-preview", // last resort, lower quality
];

// GEMINI_IMAGE_MODEL overrides the chain; comma-separated for multiple models.
const resolveModels = () => {
  const raw = process.env.GEMINI_IMAGE_MODEL;
  if (!raw) return MODELS;
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : MODELS;
};

export function buildBrief(headline, c) {
  const columns = c.columns
    .map((col, i) => `Column ${i + 1}: [simple vector icon] bold heading "${col.heading}" with text "${col.text}"`)
    .join("\n");
  const facts = c.facts.map((f) => `- ${f}`).join("\n");
  return `Create a premium corporate LinkedIn vertical infographic in a 4:5 portrait format, 1080 x 1350 px.

TOP SECTION - STRONG HEADLINE:
Place a large, bold, modern sans-serif headline at the top:
"${headline}"
Use Energy Navy (#0A1F44) typography with strong visual hierarchy. Keep the headline highly readable and professional. Add a short supporting statement below it:
"${c.supporting}"

HERO VISUAL:
Below the headline, create a large photorealistic hero image related to the topic: a large utility-scale solar park in India at golden hour from a slightly elevated perspective. Long, uniform rows of solar panels should lead from the foreground toward the horizon, curving naturally through the landscape. Include a high-voltage transmission tower, power lines, and a realistic electrical substation in the mid-ground to represent the connection between solar generation and the electricity grid. Use warm golden-hour sunlight, soft blue and amber sky gradients, atmospheric haze, realistic Indian landscape, rich but balanced colors, sharp professional photography, and realistic materials.

MIDDLE INFORMATION SECTION:
Under the hero image, create a clean Solar Grey (#F5F7FA) information area divided into ${c.columns.length} evenly spaced columns. Each column contains a simple modern vector-style icon in Energy Navy (#0A1F44) with a small Solar Gold (#FFC107) accent, a short bold heading, and 2-3 lines of concise explanatory text. Use consistent iconography, generous spacing, thin subtle dividers, and excellent alignment.
${columns}

KEY INSIGHT SECTION:
Create another structured section titled:
"${c.section_title}"
Use a combination of small icons, concise bullet-style facts, key numbers and keywords highlighted in Solar Gold (#FFC107) on an Energy Navy (#0A1F44) panel so they stay readable, and one supporting circular or rounded-corner photorealistic image showing agrivoltaics - solar panels installed above or alongside crops.
Facts:
${facts}

BOTTOM SECTION - STRONG CLOSING MESSAGE:
Create a visually distinct Energy Navy (#0A1F44) footer banner with white text and a Solar Gold (#FFC107) highlight that includes:
"${c.closing}"
Add a small supporting visual such as an India map or a sun icon in Solar Gold (#FFC107).

DESIGN STYLE:
Premium corporate infographic, professional LinkedIn content, clean editorial layout, modern sustainability/energy branding, photorealistic photography combined with clean vector graphics. BRAND PALETTE (DeCircle Solar), used in this proportion: Energy Navy #0A1F44 about 60% (headlines, text, panels, footer), Solar Grey #F5F7FA / white about 25% (backgrounds, sections), Solar Gold #FFC107 about 10% (sun icon, highlights, key numbers), Solar Orange #FF7A00 about 5% (small emphasis only). Use clean modern Montserrat or Poppins typography. Strong visual hierarchy, consistent typography, generous whitespace, clean alignment, subtle separators, minimal decorative elements. Sophisticated, credible business presentation, understood quickly while scrolling on LinkedIn.

IMPORTANT:
It should look like a professionally designed corporate communication piece, not a generic AI poster.
Avoid: green-dominant graphics, bright blue, red, purple, multiple gradients, clutter, excessive text, random icons, cartoonish illustrations, unrealistic solar panels, distorted infrastructure, excessive gradients, unnecessary decorative elements, watermarks, fake company logos, branding on equipment.
All text must be short, readable, correctly spelled, and professionally arranged. Use only the exact texts given above. If the company name DeCircle Solar appears anywhere, write it exactly as DeCircle Solar, with capital D and capital C and no space between De and Circle.`;
}

// Runs a single image model. Retries 429/503 within the model; throws on any
// other failure (HTTP error, or a response with no image) so the caller can
// fall back to the next model.
async function generateWithModel(model, prompt, id, key) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const init = {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "4:5" } },
    }),
  };
  const data = await withBusyRetry(async () => {
    const res = await fetch(url, init);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`Gemini image request failed (${model}): ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return body;
  });

  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  const img = parts.map((p) => p.inlineData || p.inline_data).find((d) => d && d.data);
  if (!img) throw new Error(`Gemini returned no image (${model}): ${JSON.stringify(data).slice(0, 300)}`);

  await sharp(Buffer.from(img.data, "base64"))
    .resize(1080, 1350, { fit: "cover" })
    .png()
    .toFile(path.join(IMAGES_DIR, `${id}.png`));
  return imagePath(id);
}

// Generates the infographic with Gemini (Google AI Studio) image generation.
// Uses Claude only to write the infographic copy, then hands that brief to
// Gemini. If a model fails, the next model in the chain is tried.
export async function makeImageWithGemini(headline, id, caption = "") {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const prompt = buildBrief(headline, await makeInfographicContent(headline, caption));

  const models = resolveModels();
  let lastErr;
  for (const model of models) {
    try {
      return await generateWithModel(model, prompt, id, key);
    } catch (e) {
      lastErr = e;
      console.log(`Gemini model ${model} failed, trying next:`, e.message);
    }
  }
  throw lastErr;
}

export function wrap(text, width = 24) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if ((line + " " + word).trim().length > width) { lines.push(line); line = word; }
    else line = (line + " " + word).trim();
  }
  if (line) lines.push(line);
  return lines;
}

export async function makeImageWithSharp(headline, id) {
  if (!fs.existsSync(BASE_IMAGE)) {
    throw new Error(`Base image "${BASE_IMAGE}" not found. Save your solar image at assets/base.png.`);
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
  const out = path.join(IMAGES_DIR, `${id}.png`);
  await sharp(BASE_IMAGE).resize(1080, 1350, { fit: "cover" })
    .composite([{ input: Buffer.from(svg) }]).png().toFile(out);
  return imagePath(id);
}

// Tries Gemini first; if it fails (for example quota exceeded), falls back to base.png + headline text.
export async function makeImage(headline, id, caption = "") {
  if (process.env.GEMINI_API_KEY) {
    try {
      return await makeImageWithGemini(headline, id, caption);
    } catch (e) {
      console.log("Gemini image failed, using fallback image:", e.message);
    }
  }
  return makeImageWithSharp(headline, id);
}

// Single entry point for every route that wants an image for a post, so
// EMAIL_POST_IMAGE_MODE is honoured everywhere (create, approve, regenerate,
// gmail). mode=none returns "" — text-only posts keep working and a manually
// uploaded image is never overwritten.
export async function generateImageForPost(headline, id, caption = "") {
  const mode = imageMode();
  if (mode === "none") return "";
  if (mode === "gemini") return makeImage(headline, id, caption);
  return makeImageWithSharp(headline, id);
}

// Replaces the post's image with a user-uploaded file. Re-encoded to the same
// 1080x1350 (4:5) frame as generated images so every post is LinkedIn-ready.
export async function replaceImageFromBuffer(id, buffer) {
  if (!buffer || !buffer.length) throw new Error("No image data received");
  await sharp(buffer).resize(1080, 1350, { fit: "cover" }).png()
    .toFile(path.join(IMAGES_DIR, `${id}.png`));
  return imagePath(id);
}
