// Minimal RFC 4180 CSV writer used to export a newsletter digest's source posts.
// Pure and dependency-free so it can be unit-tested in isolation.

// A cell that begins with one of these is treated by Excel/Sheets as a formula,
// so we defuse it with a leading apostrophe (the OWASP CSV-injection guidance).
const RISKY = /^[=+\-@\t\r]/;

// Render a single CSV field: RFC 4180 quoting when the value contains a comma,
// quote or newline, plus a formula-injection guard for spreadsheet apps.
export function csvCell(value) {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (RISKY.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Build a whole CSV document. `columns` is [{ key, label }]; rows are objects.
// Lines are CRLF-terminated per RFC 4180; `bom` prepends a UTF-8 byte-order mark
// so Excel opens non-ASCII text correctly.
export function toCsv(rows, columns, { bom = true } = {}) {
  const header = columns.map((c) => csvCell(c.label ?? c.key)).join(",");
  const body = (rows || []).map((row) =>
    columns.map((c) => csvCell(typeof c.value === "function" ? c.value(row) : row[c.key])).join(",")
  );
  return (bom ? "\uFEFF" : "") + [header, ...body].join("\r\n") + "\r\n";
}
