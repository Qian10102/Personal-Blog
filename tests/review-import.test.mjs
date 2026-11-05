import test from "node:test";
import assert from "node:assert/strict";
import {
  csvTemplate,
  excelTemplate,
  parseCsv,
  parseWorkbook,
  validateImportRows,
  templateHeaders,
} from "../src/lib/review-import.ts";
test("CSV template round trips Chinese names, BOM, commas, quotes and newlines", () => {
  assert.equal(parseCsv(csvTemplate())[0].course.subject, "数学");
  const rows = parseCsv(
    '\uFEFF科目,星期,开始时间,结束时间,周次,单双周\r\n"数学,\"\"专题\"\"",周一,09:00,10:00,"1-8,10-16",单周\r\n',
  );
  assert.equal(rows[0].course.subject, '数学,"专题"');
  assert.equal(rows[0].course.parity, "odd");
});
test("import validation identifies per-row errors and duplicates without accepting invalid rows", () => {
  const rows = validateImportRows([
    templateHeaders,
    ["数学", 1, "09:00", "10:00", "1-16", "全部"],
    ["数学", 1, "09:00", "10:00", "1-16", "全部"],
    ["", 8, "25:00", "09:00", "3-1", "other"],
  ]);
  assert.ok(rows[0].course);
  assert.equal(rows[1].course, null);
  assert.equal(rows[2].course, null);
  assert.ok(rows[2].issues.length >= 5);
  assert.throws(() => parseCsv("subject,day\nMath,1"));
  assert.throws(() =>
    validateImportRows([
      templateHeaders,
      ...Array.from({ length: 501 }, () => []),
    ]),
  );
});
test("Excel template round trips and native Excel numeric time cells are normalized", async () => {
  const rows = await parseWorkbook(await excelTemplate());
  assert.equal(rows[0].course.subject, "数学");
  assert.equal(rows[0].course.start, "09:00");
  const normalized = validateImportRows([
    templateHeaders,
    ["数学", 2, 9 / 24, 10.5 / 24, "1-4", "双周"],
  ]);
  assert.equal(normalized[0].course.end, "10:30");
});
