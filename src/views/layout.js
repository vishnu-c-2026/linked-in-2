import { esc } from "../util.js";

// Nav is shared so both pages stay in step; Newsletter is the exact label.
export const nav = (active) => `<nav>
  <a href="/"${active === "posts" ? ' aria-current="page"' : ""}>Posts</a>
  <a href="/newsletter"${active === "newsletter" ? ' aria-current="page"' : ""}>Newsletter</a>
</nav>`;

export const page = (title, active, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
:root{--ink:#14202a;--muted:#5d6b76;--line:#d5dce1;--bg:#eef1f3;--amber:#d98a1f;--ok:#1f7a4d;--bad:#b3372c}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,"Segoe UI",sans-serif}
main{max-width:980px;margin:0 auto;padding:32px 20px 64px}
h1{font-size:1.6rem;margin:0 0 20px}
nav{display:flex;gap:8px;margin:0 0 24px;border-bottom:1px solid var(--line);padding-bottom:12px}
nav a{padding:6px 14px;border-radius:6px;text-decoration:none;color:var(--muted);font-weight:600}
nav a:hover{background:#e2e7eb;color:var(--ink)}
nav a[aria-current]{background:var(--ink);color:#fff}
.gen{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:32px}
.gen input{flex:1 1 320px;padding:10px 12px;border:1px solid var(--line);border-radius:6px;font:inherit}
button{padding:10px 18px;border:0;border-radius:6px;font:inherit;font-weight:600;cursor:pointer;background:var(--ink);color:#fff}
button.approve{background:var(--amber);color:#1b1206}
button.reject{background:transparent;color:var(--muted);border:1px solid var(--line)}
button.regenerate{width:100%;background:#e2e7eb;color:var(--ink)}
button.regenerate:hover{background:var(--line)}
button.upload{width:100%;background:#fff;color:var(--ink);border:1px solid var(--line)}
button.upload:hover{background:#f4f6f8}
input[type=file]{width:100%;font:inherit}
button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid var(--amber);outline-offset:2px}
.item{display:grid;grid-template-columns:280px 1fr;gap:24px;padding:24px 0;border-top:1px solid var(--line)}
.item img{width:100%;border-radius:4px;display:block;aspect-ratio:4/5;object-fit:cover;background:#cfd6db}
textarea{width:100%;min-height:210px;padding:12px;border:1px solid var(--line);border-radius:6px;font:inherit;resize:vertical}
.row{display:flex;gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap}
.status{font-weight:600}.posted{color:var(--ok)}.failed{color:var(--bad)}.rejected{color:var(--muted)}.pending{color:var(--amber)}
.post-num{display:inline-block;margin:0 0 6px;padding:2px 10px;border-radius:999px;background:#e4e9ed;color:var(--muted);font-size:.8rem;font-weight:700;letter-spacing:.02em;text-transform:uppercase}
.cap-snip{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.cap-snip .nl-more,.cap-snip .nl-less{background:none;border:0;padding:0;margin:0;color:var(--ok);font:inherit;font-weight:600;cursor:pointer;text-decoration:underline}
.err{color:var(--bad);font-size:.9rem;word-break:break-word}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:6px}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}
th{background:#e4e9ed;font-size:.85rem;letter-spacing:.02em;text-transform:uppercase;color:var(--muted)}
tbody tr:last-child td{border-bottom:0}
td{max-width:360px;overflow-wrap:anywhere}
.filters{margin-bottom:16px;max-width:420px}
.pager{display:flex;gap:12px;align-items:center;margin:16px 0;flex-wrap:wrap}
.pager a{padding:8px 14px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink);font-weight:600;text-decoration:none}
.pager a:hover{border-color:var(--muted)}
.pager .cur{color:var(--muted)}
.notice{background:#fff;border:1px solid var(--line);border-left:4px solid var(--amber);border-radius:6px;padding:16px 18px}
.notice p{margin:0 0 12px}
.notice a{color:var(--amber);font-weight:600}
.email-src{margin-bottom:14px;padding:12px 14px;border:1px solid var(--line);border-left:4px solid var(--ok);border-radius:6px;background:#fff;font-size:.9rem}
.email-src .meta{margin:0 0 4px;color:var(--muted)}
.email-src .meta.subj{font-weight:600;color:var(--ink)}
.email-src a{color:var(--ok);font-weight:600}
.email-src summary{cursor:pointer;color:var(--muted);font-weight:600}
.email-src pre.raw{margin:8px 0 0;white-space:pre-wrap;word-break:break-word;font:inherit;max-height:220px;overflow:auto}
.nl-meta{margin:0 0 4px;color:var(--muted)}
.nl-digest{background:#fff;border:1px solid var(--line);border-radius:6px;padding:16px 18px;white-space:pre-wrap;overflow-wrap:anywhere}
.nl-sub{font-size:1.1rem;margin:24px 0 0}
.nl-posts{margin:8px 0 0;padding:0;list-style:none}
.nl-posts li{border-top:1px solid var(--line);padding:12px 0}
.nl-posts .nl-snip{margin:4px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}
.nl-snip .nl-more,.nl-snip .nl-less{background:none;border:0;padding:0;margin:0;color:var(--ok);font:inherit;font-weight:600;cursor:pointer;text-decoration:underline}
@media(max-width:700px){.item{grid-template-columns:1fr}}
</style></head><body><main>
${nav(active)}
${body}
</main></body></html>`;
