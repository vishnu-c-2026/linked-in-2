import { test } from "node:test";
import assert from "node:assert/strict";
import { csvCell, toCsv } from "../src/csv.js";

test("csvCell leaves plain values untouched", () => {
  assert.equal(csvCell("Solar park milestone"), "Solar park milestone");
  assert.equal(csvCell(12), "12");
});

test("csvCell renders null and undefined as empty", () => {
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
});

test("csvCell quotes values containing commas, quotes or newlines", () => {
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
  assert.equal(csvCell("cr\rhere"), '"cr\rhere"');
});

test("csvCell defuses spreadsheet formula injection", () => {
  assert.equal(csvCell("=1+1"), "'=1+1");
  assert.equal(csvCell("+cmd"), "'+cmd");
  assert.equal(csvCell("-2"), "'-2");
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvCell("=1+1,2"), '"\'=1+1,2"');
});

test("toCsv writes a header, CRLF lines and a trailing newline", () => {
  const out = toCsv(
    [{ a: "1", b: "2" }, { a: "3", b: "4" }],
    [{ key: "a", label: "A" }, { key: "b", label: "B" }],
    { bom: false }
  );
  assert.equal(out, "A,B\r\n1,2\r\n3,4\r\n");
});

test("toCsv supports computed columns via value()", () => {
  const out = toCsv(
    [{ reactions: 2, comments: 3 }],
    [{ label: "Engagement", value: (r) => r.reactions + r.comments }],
    { bom: false }
  );
  assert.equal(out, "Engagement\r\n5\r\n");
});

test("toCsv prepends a UTF-8 BOM by default", () => {
  const out = toCsv([], [{ key: "a", label: "A" }]);
  assert.ok(out.startsWith("\uFEFF"), "BOM present so Excel opens UTF-8");
  assert.equal(out.slice(1), "A\r\n");
});
