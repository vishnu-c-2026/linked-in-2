import "dotenv/config";
import express from "express";
import { IMAGES_DIR, PORT } from "./config.js";
import { postsRouter } from "./routes/posts.js";
import { newsletterRouter } from "./routes/newsletter.js";
import { authRouter } from "./routes/auth.js";
import { gmailRouter } from "./routes/gmail.js";
import { startGmailPoller, startNewsletterScheduler } from "./scheduler.js";

export const app = express();
app.use(express.urlencoded({ extended: true }));
app.use("/images", express.static(IMAGES_DIR));

app.use(postsRouter);
app.use("/newsletter", newsletterRouter);
app.use(authRouter);
app.use(gmailRouter);

if (process.env.NODE_ENV !== "test") {
  startGmailPoller();
  startNewsletterScheduler();
  app.listen(PORT, () => console.log(`Dashboard running at http://localhost:${PORT}`));
}
