import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { imageMode, IMAGES_DIR } from "../src/config.js";
import { generateImageForPost } from "../src/services/image.js";

const saved = process.env.EMAIL_POST_IMAGE_MODE;
const ID = 9876543210123;

after(() => {
  if (saved === undefined) delete process.env.EMAIL_POST_IMAGE_MODE;
  else process.env.EMAIL_POST_IMAGE_MODE = saved;
  fs.rmSync(path.join(IMAGES_DIR, `${ID}.png`), { force: true });
});

test("imageMode reads EMAIL_POST_IMAGE_MODE, defaulting to sharp", () => {
  delete process.env.EMAIL_POST_IMAGE_MODE;
  assert.equal(imageMode(), "sharp");
  process.env.EMAIL_POST_IMAGE_MODE = "NONE";
  assert.equal(imageMode(), "none");
  process.env.EMAIL_POST_IMAGE_MODE = "Gemini";
  assert.equal(imageMode(), "gemini");
});

test("generateImageForPost writes nothing when image generation is off", async () => {
  process.env.EMAIL_POST_IMAGE_MODE = "none";
  const out = await generateImageForPost("Headline under test", ID, "caption");
  assert.equal(out, "", "mode=none means a text-only post");
  assert.equal(fs.existsSync(path.join(IMAGES_DIR, `${ID}.png`)), false, "no image file is created");
});
