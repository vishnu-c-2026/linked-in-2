import "dotenv/config";
import fs from "fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const HEADLINE = "INDIA DOESN'T JUST NEED MORE SOLAR CAPACITY. IT NEEDS MORE USABLE SOLAR ENERGY";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const parse = (res) => {
  const text = (res.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  try { return JSON.parse(text); } catch { return { raw: text }; }
};

const transport = new StreamableHTTPClientTransport(new URL("https://mcp.canva.com/mcp"), {
  requestInit: { headers: { Authorization: `Bearer ${process.env.CANVA_ACCESS_TOKEN}` } },
});
const client = new Client({ name: "linkedin-poster", version: "1.0.0" });
await client.connect(transport);

// 1) Save the list of Canva tools (names, descriptions, inputs) so we can see the export tool
const tools = await client.listTools();
fs.writeFileSync("canva-tools.json", JSON.stringify(tools.tools, null, 2));
console.log("Tools saved to canva-tools.json:", tools.tools.map((t) => t.name).join(", "));

// 2) Start the design job
const start = parse(await client.callTool({
  name: "create-design",
  arguments: {
    brief:
      "A vertical 4:5 (1080x1350 px) LinkedIn image. Full-bleed photo-realistic image of a utility-scale solar park in India at golden hour, " +
      "rows of solar panels stretching to the horizon, warm low sunlight, with clear open sky space at the top of the image. " +
      `Overlay this exact headline in bold white text in the clear sky area at the top, uppercase, no changes to wording: "${HEADLINE}". No other text, logos or elements.`,
    format: "Instagram Post (Portrait 4:5, 1080x1350)",
    user_intent: "Create 1080x1350 LinkedIn image of Indian solar park at golden hour with white bold headline overlay",
  },
}));
console.log("Started:", start.status, start.job_id);

// 3) Poll, waiting as long as Canva asks
let state = start;
const deadline = Date.now() + 5 * 60 * 1000;
while (["pending", "in_progress", "polled_too_early"].includes(state.status) && Date.now() < deadline) {
  const wait = (state.polling_policy?.wait_seconds ?? 10) + 1;
  console.log(`Status ${state.status}, waiting ${wait}s...`);
  await sleep(wait * 1000);
  state = parse(await client.callTool({
    name: "get-create-design-async-job",
    arguments: {
      job_id: start.job_id,
      continuation_token: state.continuation_token,
      user_intent: "Poll design generation job",
    },
  }));
}

fs.writeFileSync("canva-result.json", JSON.stringify(state, null, 2));
console.log("Final status:", state.status, "-> saved to canva-result.json");
await client.close();
