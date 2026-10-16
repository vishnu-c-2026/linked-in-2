import fs from "fs";
import { LINKEDIN_MAX_CHARS } from "../config.js";

// Characters LinkedIn treats as markup inside post commentary.
const escapeCommentary = (t) => t.replace(/([\\|{}@\[\]()<>*_~])/g, "\\$1");

export async function postToLinkedIn(caption, imagePath) {
  const token = process.env.LINKEDIN_TOKEN;
  const author = (process.env.LINKEDIN_AUTHOR_URN || "").trim();
  if (!token || !author) throw new Error("LINKEDIN_TOKEN or LINKEDIN_AUTHOR_URN is missing in .env");

  const commentary = escapeCommentary(caption);
  if (commentary.length > LINKEDIN_MAX_CHARS) {
    throw new Error(`Post is ${commentary.length} characters; LinkedIn's limit is ${LINKEDIN_MAX_CHARS}. Shorten the text in the box and approve again.`);
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    "LinkedIn-Version": process.env.LINKEDIN_VERSION || "202609",
    "X-Restli-Protocol-Version": "2.0.0",
    "Content-Type": "application/json",
  };
  const body = {
    author,
    commentary,
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  if (imagePath && fs.existsSync(imagePath)) {
    const init = await fetch("https://api.linkedin.com/rest/images?action=initializeUpload", {
      method: "POST", headers, body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
    });
    if (!init.ok) throw new Error(`Image init failed: ${init.status} ${await init.text()}`);
    const { value } = await init.json();
    const up = await fetch(value.uploadUrl, {
      method: "PUT", headers: { Authorization: `Bearer ${token}` }, body: fs.readFileSync(imagePath),
    });
    if (!up.ok) throw new Error(`Image upload failed: ${up.status}`);
    body.content = { media: { id: value.image, altText: "Solar park connected to the power grid at golden hour" } };
  }
  const res = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST", headers, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Post failed: ${res.status} ${await res.text()}`);
  return res.headers.get("x-restli-id") || "";
}
