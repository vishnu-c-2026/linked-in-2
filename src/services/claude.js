import fs from "fs";
import Anthropic from "@anthropic-ai/sdk";
import { MODEL, CAPTION_PROMPT_FILE } from "../config.js";

/* ---------- Auto mode: find today's topic from current news ---------- */

export async function pickTopic(recentHeadlines = []) {
  const client = new Anthropic();
  const today = new Date().toDateString();
  const avoid = recentHeadlines.length ? `\nDo NOT repeat or closely resemble these recent headlines:\n- ${recentHeadlines.join("\n- ")}\n` : "";
  const task =
    `Today is ${today}. Use web search to find the most interesting RECENT news or data (ideally from the last 7 days) about India's solar and power sector ` +
    "that matters to solar-park developers: capacity additions, transmission and grid connectivity, storage, curtailment, financing, PPAs/tenders, policy or regulation, land, agrivoltaics.\n" +
    "Pick ONE strong, verifiable story. Do not pick rumours or unverified claims." + avoid +
    "\nReturn ONLY valid JSON, no markdown, in exactly this shape:\n" +
    '{"headline":"strong original LinkedIn headline in capital letters, max 15 words, not clickbait",' +
    '"news_summary":"4-6 sentences: what happened, key numbers with dates and geography, and the names of the sources you used"}';
  let msg;
  try {
    msg = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      messages: [{ role: "user", content: task }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
    });
  } catch (e) {
    throw new Error(`Could not search for news (web search may not be enabled on your Anthropic account): ${e.message}`);
  }
  let last = -1;
  msg.content.forEach((b, i) => { if (b.type === "web_search_tool_result") last = i; });
  const text = msg.content.slice(last + 1).filter((b) => b.type === "text").map((b) => b.text).join("");
  const json = text.match(/\{[\s\S]*\}/);
  if (!json) throw new Error("Could not pick a topic from today's news (no result returned)");
  const topic = JSON.parse(json[0]);
  if (!topic.headline || !topic.news_summary) throw new Error("Topic result was incomplete");
  return topic;
}

export async function makeCaption(headline, context = "") {
  if (!fs.existsSync(CAPTION_PROMPT_FILE)) {
    throw new Error(`"${CAPTION_PROMPT_FILE}" not found. Save your content prompt in the prompts folder with that name.`);
  }
  const guide = fs.readFileSync(CAPTION_PROMPT_FILE, "utf8");
  const task =
    guide +
    "\n\n==================================================\nTODAY'S TASK\n==================================================\n" +
    `Topic / headline for today's post: ${headline}\n` +
    "Use this as the post's opening headline (you may tighten the wording slightly).\n" +
    (context ? `Background from today's news research (verify the numbers before using them):\n${context}\n` : "") +
    "TECHNICAL LIMIT THAT OVERRIDES THE WORD COUNT: LinkedIn rejects posts over 3,000 characters, so the final post must be " +
    "2,800 characters or fewer including spaces and hashtags (roughly 400-450 words). Follow the content priority list to decide what to keep.\n" +
    "Verify statistics with web search. If you cannot verify a number, leave it out.\n" +
    "Always write the company name exactly as DeCircle Solar: capital D, capital C, and no space between De and Circle.\n" +
    "Return ONLY the final post text, with no preface, notes or word count.";

  const client = new Anthropic();
  const params = { model: MODEL, max_tokens: 6000 };
  let msg;
  try {
    msg = await client.messages.create({
      ...params,
      messages: [{ role: "user", content: task }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
    });
  } catch (e) {
    console.log("Web search unavailable, writing the caption without it:", e.message);
    msg = await client.messages.create({
      ...params,
      messages: [{ role: "user", content: task + "\nWeb search is not available: do not include any statistic you are not certain about." }],
    });
  }
  // keep only the text written after the last web search result (drops "let me search..." chatter)
  let last = -1;
  msg.content.forEach((b, i) => { if (b.type === "web_search_tool_result") last = i; });
  const text = msg.content.slice(last + 1).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  if (!text) {
    console.log("Caption response:", msg.stop_reason, JSON.stringify(msg.content).slice(0, 500));
    throw new Error("Claude returned no text for the caption");
  }
  return text;
}

// Claude writes the short texts that fill the infographic template.
export async function makeInfographicContent(headline, caption = "") {
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [{
      role: "user",
      content:
        `Headline for a LinkedIn infographic aimed at an Indian energy-sector audience: ${headline}\n` +
        "Write the short texts for the infographic. Return ONLY valid JSON, no markdown, in exactly this shape:\n" +
        '{"supporting":"one short supporting sentence, max 14 words",' +
        '"columns":[{"heading":"2-3 words","text":"max 14 words"},{"heading":"...","text":"..."},{"heading":"...","text":"..."},{"heading":"...","text":"..."}],' +
        '"section_title":"short title, max 6 words",' +
        '"facts":["max 12 words","max 12 words","max 12 words"],' +
        '"closing":"one short closing message, max 14 words"}\n' +
        (caption ? `The LinkedIn post this infographic accompanies:\n${caption}\n\nBase the infographic only on facts and numbers that appear in that post. ` : "") +
        "Exactly 4 columns and 3 facts. Plain, correctly spelled words. Do not invent statistics or numbers. If the company name appears, write it exactly as DeCircle Solar. Name only DeCircle Solar: do not name or hashtag any other company, brand or organisation.",
    }],
  });
  const raw = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim()
    .replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const c = JSON.parse(raw);
  if (!c.supporting || !Array.isArray(c.columns) || !c.columns.length || !c.section_title || !Array.isArray(c.facts) || !c.closing) {
    throw new Error("Infographic content from Claude was incomplete");
  }
  return c;
}
