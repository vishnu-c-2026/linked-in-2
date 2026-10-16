import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { IMAGES_DIR } from "../src/config.js";
import { makeImageWithGemini } from "../src/services/image.js";

const ID = 9876543210999;
const OUT = path.join(IMAGES_DIR, `${ID}.png`);
const realFetch = globalThis.fetch;

const INFOGRAPHIC = {
  supporting: "India adds record solar capacity this year",
  columns: [
    { heading: "Capacity", text: "Record additions in 2025" },
    { heading: "Grid", text: "Transmission expands quickly" },
    { heading: "Storage", text: "Batteries scale with solar" },
    { heading: "Policy", text: "Supportive regulation continues" },
  ],
  section_title: "Key Insight",
  facts: ["Solar leads new capacity", "Costs keep falling", "Grid is the bottleneck"],
  closing: "India's solar future is bright",
};

// 1x1 PNG that sharp can read back.
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function anthropicResponse() {
  return new Response(
    JSON.stringify({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude",
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify(INFOGRAPHIC) }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function geminiImageResponse() {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: PNG_B64 } }] } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function geminiErrorResponse(status = 500) {
  return new Response(JSON.stringify({ error: { message: "boom" } }), { status, headers: { "content-type": "application/json" } });
}

after(() => {
  globalThis.fetch = realFetch;
  delete process.env.GEMINI_IMAGE_MODEL;
  fs.rmSync(OUT, { force: true });
});

test("makeImageWithGemini falls back to the next model when one fails", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.GEMINI_IMAGE_MODEL;
  process.env.GEMINI_API_KEY = "test-key";

  const geminiCalls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("api.anthropic.com")) return anthropicResponse();
    geminiCalls.push(u);
    if (u.includes("gemini-3.8-flash")) return geminiErrorResponse(500);
    if (u.includes("gemini-3-flash-preview")) return geminiImageResponse();
    return geminiErrorResponse(500);
  };

  const out = await makeImageWithGemini("Headline", ID, "caption");
  assert.equal(out, `images/${ID}.png`);
  assert.equal(fs.existsSync(OUT), true, "image file is written by the working model");
  assert.equal(geminiCalls.length, 2, "stops after the second model succeeds");
  assert.match(geminiCalls[1], /gemini-3-flash-preview/);
});

test("makeImageWithGemini throws after every model fails", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.GEMINI_IMAGE_MODEL;
  process.env.GEMINI_API_KEY = "test-key";

  const geminiCalls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("api.anthropic.com")) return anthropicResponse();
    geminiCalls.push(u);
    return geminiErrorResponse(500);
  };

  await assert.rejects(() => makeImageWithGemini("Headline", ID, "caption"), /gemini-3.1-flash-lite-preview/);
  assert.equal(geminiCalls.length, 3, "all three default models were tried");
});

test("GEMINI_IMAGE_MODEL overrides the model chain", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.GEMINI_API_KEY = "test-key";
  process.env.GEMINI_IMAGE_MODEL = "custom-a, custom-b";

  const geminiCalls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("api.anthropic.com")) return anthropicResponse();
    geminiCalls.push(u);
    if (u.includes("custom-b")) return geminiImageResponse();
    return geminiErrorResponse(500);
  };

  const out = await makeImageWithGemini("Headline", ID, "caption");
  assert.equal(out, `images/${ID}.png`);
  assert.equal(geminiCalls.length, 2);
  assert.match(geminiCalls[0], /custom-a/);
  assert.match(geminiCalls[1], /custom-b/);
});
