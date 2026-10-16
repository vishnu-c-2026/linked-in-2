import express from "express";
import crypto from "crypto";
import { esc, b64url } from "../util.js";
import { GOOGLE_AUTH_URL, GOOGLE_TOKEN_URL, GMAIL_SCOPE } from "../gmail/service.js";

export const authRouter = express.Router();

/* ---------- Gmail reader: OAuth flow, gmail.readonly scope ---------- */

let gmailVerifier = "";

authRouter.get("/gmail/login", (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(500).send(esc("GOOGLE_CLIENT_ID is not set in .env"));
  gmailVerifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash("sha256").update(gmailVerifier).digest());
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: process.env.GMAIL_REDIRECT_URI,
    response_type: "code",
    scope: GMAIL_SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline", // yields a refresh token, needed after the first hour
    prompt: "consent",
  });
  res.redirect(`${GOOGLE_AUTH_URL}?${q}`);
});

authRouter.get("/gmail/callback", async (req, res) => {
  try {
    const code = String(req.query.code || "");
    if (!code) return res.status(400).send("No authorisation code came back from Google.");
    const r = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code,
        code_verifier: gmailVerifier,
        grant_type: "authorization_code",
        redirect_uri: process.env.GMAIL_REDIRECT_URI,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.refresh_token) {
      return res.status(400).send(esc(`Google did not return a refresh token: ${JSON.stringify({ error: data.error, error_description: data.error_description })}`));
    }
    // Printed once, on purpose: the refresh token is long-lived, so it goes straight into .env
    // by hand rather than into a log file or the browser.
    console.log("\nAdd this line to your .env, then reload the server:");
    console.log(`GOOGLE_GMAIL_REFRESH_TOKEN=${data.refresh_token}\n`);
    res.send("Gmail is connected. The refresh token is printed in your terminal: copy it into .env as GOOGLE_GMAIL_REFRESH_TOKEN, restart the server, then open /check-gmail. You can close this tab.");
  } catch (e) {
    res.status(500).send(esc(e.message));
  }
});
