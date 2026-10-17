import { test, before } from "node:test";
import assert from "node:assert/strict";

let renderPostItem;

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.ANTHROPIC_API_KEY = "sk-test-secret-key-never-show-me";
  process.env.GOOGLE_GMAIL_REFRESH_TOKEN = "gmail-refresh-secret-never-show-me";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret-never-show-me";
  process.env.EMAIL_POST_IMAGE_MODE = "sharp";
  ({ renderPostItem } = await import("../src/views/post-item.js"));
});

function emailRow() {
  return {
    id: 1,
    mode: "email",
    headline: "Shared content",
    caption: "Rewritten post text",
    status: "pending",
    error: "",
    email: {
      gmailMessageId: "m9",
      sender: "Team <team@decirclesolar.com>",
      subject: "<script>alert('xss')</script>",
      receivedAt: new Date("2026-10-01T05:00:00Z").toISOString(),
      sourceLinkedInUrl: "https://www.linkedin.com/posts/company-1_activity-9",
      originalBody: "<script>alert('xss')</script>\n\nIndia's solar capacity keeps growing.",
    },
  };
}

test("renderPostItem renders the email source panel", () => {
  const html = renderPostItem(emailRow());
  assert.match(html, /Team &lt;team@decirclesolar.com&gt;/);
  assert.match(html, /Source LinkedIn post/);
  assert.match(html, /https:\/\/www\.linkedin\.com\/posts\/company-1_activity-9/);
});

test("email HTML/script content is escaped, never executed", () => {
  const html = renderPostItem(emailRow());
  assert.equal(html.includes("<script>"), false, "no raw script tag may be emitted");
  assert.equal(html.includes("alert('"), false, "no raw JS may be emitted");
  assert.ok(html.includes("&lt;script&gt;"));
});

test("secrets are never rendered into the frontend HTML", () => {
  const html = renderPostItem(emailRow());
  assert.doesNotMatch(html, /sk-test-secret-key-never-show-me/);
  assert.doesNotMatch(html, /gmail-refresh-secret-never-show-me/);
  assert.doesNotMatch(html, /client-secret-never-show-me/);
});

test("pending posts show a regenerate-image button", () => {
  const html = renderPostItem(emailRow());
  assert.match(html, /action="\/regenerate-image\/1"/);
  assert.match(html, /Regenerate image/);
});

test("image src is cache-busted when imageAt is set", () => {
  const row = emailRow();
  row.image = "images/1.png";
  row.imageAt = 12345;
  const html = renderPostItem(row);
  assert.match(html, /src="\/images\/1\.png\?v=12345"/);
});

test("posted and rejected posts hide the regenerate button", () => {
  for (const status of ["posted", "rejected"]) {
    const row = emailRow();
    row.status = status;
    assert.doesNotMatch(renderPostItem(row), /Regenerate image/);
  }
});

test("pending posts show an image upload form", () => {
  const html = renderPostItem(emailRow());
  assert.match(html, /action="\/upload-image\/1"/);
  assert.match(html, /enctype="multipart\/form-data"/);
  assert.match(html, /<input type="file" name="image"/);
  assert.match(html, /accept="image\/png,image\/jpeg,image\/webp"/);
});

test("posted and rejected posts hide the upload form", () => {
  for (const status of ["posted", "rejected"]) {
    const row = emailRow();
    row.status = status;
    const html = renderPostItem(row);
    assert.doesNotMatch(html, /upload-image/);
    assert.doesNotMatch(html, /type="file"/);
  }
});

test("image generation off hides the regenerate button but keeps manual upload", () => {
  const saved = process.env.EMAIL_POST_IMAGE_MODE;
  try {
    process.env.EMAIL_POST_IMAGE_MODE = "none";
    const html = renderPostItem(emailRow());
    assert.doesNotMatch(html, /regenerate-image/);
    assert.doesNotMatch(html, /Regenerate image/);
    assert.match(html, /action="\/upload-image\/1"/, "uploading your own image still works");
  } finally {
    process.env.EMAIL_POST_IMAGE_MODE = saved;
  }
});

test("posts are numbered by position when passed a number", () => {
  const html = renderPostItem(emailRow(), 3);
  assert.match(html, /class="post-num">Post #3</);
});

test("newsletter items are numbered as News", () => {
  const row = emailRow();
  row.mode = "newsletter";
  row.email = null;
  const html = renderPostItem(row, 2);
  assert.match(html, /class="post-num">News #2</);
});

test("no number is rendered when none is passed", () => {
  assert.doesNotMatch(renderPostItem(emailRow()), /class="post-num"/);
});

test("long read-only captions collapse behind an expand button", () => {
  const row = emailRow();
  row.status = "posted";
  row.caption = "Solar milestone announcement. ".repeat(30);
  const html = renderPostItem(row);
  assert.match(html, /class="nl-clip"/);
  assert.match(html, /class="nl-full"[^>]*hidden/);
  assert.ok(html.includes(row.caption.slice(-30)), "the full text stays on the page");
});

test("every post renders a Preview button and a hidden Bootstrap-style modal", () => {
  for (const status of ["pending", "posted", "rejected", "failed"]) {
    const row = emailRow();
    row.status = status;
    const html = renderPostItem(row);
    assert.match(html, /class="preview-btn"/, `${status} shows a Preview button`);
    assert.match(html, /class="modal-backdrop" id="pv-1" hidden/, `${status} shows the modal`);
    assert.match(html, /role="dialog"/);
    assert.match(html, /DeCircle Solar/);
  }
});

test("the Preview button is type=button and opens the modal", () => {
  const html = renderPostItem(emailRow(), 1, "all");
  assert.match(html, /<button type="button" class="preview-btn" data-pv="pv-1"/);
  assert.match(html, /document\.getElementById\(this\.dataset\.pv\)/);
});

test("editable posts get an editable modal textarea that syncs to the caption field", () => {
  const html = renderPostItem(emailRow(), 1, "all");
  assert.match(html, /<textarea id="cap-1" name="caption"/);
  assert.match(html, /class="li-edit"[^>]*data-sync="cap-1"/);
  assert.match(html, /oninput="var t=document\.getElementById\(this\.dataset\.sync\);if\(t\)t\.value=this\.value"/);
});

test("read-only posts get a static preview, not an editable one", () => {
  const row = emailRow();
  row.status = "posted";
  const html = renderPostItem(row);
  assert.match(html, /class="li-text"/);
  assert.doesNotMatch(html, /class="li-edit"/);
});

test("the modal can be dismissed by backdrop, the × and the Close button", () => {
  const html = renderPostItem(emailRow());
  assert.match(html, /onclick="if\(event\.target===this\)this\.hidden=true"/);
  assert.match(html, /class="modal-close"[^>]*aria-label="Close"/);
  assert.match(html, /class="modal-footer"><button type="button" onclick="document\.getElementById\('pv-1'\)\.hidden=true">Close<\/button>/);
});

test("the Preview caption is escaped, never executed", () => {
  const row = emailRow();
  row.status = "posted";
  row.caption = "<script>alert('x')</script>";
  const html = renderPostItem(row);
  assert.equal(html.includes("<script>"), false);
  assert.ok(html.includes("&lt;script&gt;"));
});

test("the Preview modal includes the post image when one exists", () => {
  const row = emailRow();
  row.image = "images/1.png";
  row.imageAt = 12345;
  assert.match(renderPostItem(row), /class="li-image" src="\/images\/1\.png\?v=12345"/);
});

test("newsletter drafts also render a Preview button", () => {
  const row = emailRow();
  row.mode = "newsletter";
  row.email = null;
  assert.match(renderPostItem(row), /class="preview-btn"/);
});

test("newsletter items render a Download CSV link scoped to their id", () => {
  const row = emailRow();
  row.mode = "newsletter";
  row.email = null;
  row.newsletter = { windowDays: 6, postsScraped: 1, posts: [], generatedAt: "2026-10-16T09:00:00Z" };
  const html = renderPostItem(row);
  assert.match(html, /class="csv-btn" href="\/newsletter\/download\.csv\?id=1"/);
  assert.match(html, />Download CSV</);
});

test("non-newsletter items have no Download CSV link", () => {
  assert.doesNotMatch(renderPostItem(emailRow()), /download\.csv/);
});

test("an active filter is carried through the action forms", () => {
  const html = renderPostItem(emailRow(), 1, "posts");
  assert.match(html, /<input type="hidden" name="filter" value="posts">/);
});

test("no hidden filter field is added on the default view", () => {
  assert.doesNotMatch(renderPostItem(emailRow(), 1, "all"), /name="filter"/);
});