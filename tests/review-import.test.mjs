import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import {
  csvTemplate,
  excelTemplate,
  parseCsv,
  parseWorkbook,
  validateImportRows,
  templateHeaders,
  openImportPicker,
  importFailure,
} from "../src/lib/review-import.ts";
import { workbookWithoutNotes } from "../src/lib/review-workbook.ts";
test("file selection opens synchronously in the user click and clears the previous selection", () => {
  const calls = [];
  const input = {
    value: "previous.csv",
    disabled: false,
    showPicker() {
      calls.push(["picker", this.value]);
    },
    click() {
      calls.push(["click", this.value]);
    },
  };
  assert.equal(openImportPicker(input), undefined);
  assert.deepEqual(calls, [["picker", ""]]);
});
test("file selection falls back to native click when showPicker is absent or unavailable", () => {
  for (const showPicker of [
    undefined,
    () => {
      throw new DOMException("unsupported", "NotSupportedError");
    },
  ]) {
    let clicks = 0;
    const input = {
      value: "same.xlsx",
      disabled: false,
      showPicker,
      click() {
        clicks++;
        assert.equal(this.value, "");
      },
    };
    openImportPicker(input);
    assert.equal(clicks, 1);
  }
});
test("disabled selection is not opened or cleared; picker failures remain reportable", () => {
  const input = {
    value: "previous.csv",
    disabled: true,
    click() {
      assert.fail("disabled picker opened");
    },
  };
  assert.throws(() => openImportPicker(input), /file_input_disabled/);
  assert.equal(input.value, "previous.csv");
  assert.throws(
    () =>
      openImportPicker({
        value: "",
        disabled: false,
        click() {
          throw new Error("blocked");
        },
      }),
    /blocked/,
  );
});
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

test("openpyxl notes with absolute targets import without changing course values or the source", async () => {
  const bytes = await readFile(
    new URL("./fixtures/review-timetable-notes.xlsx", import.meta.url),
  );
  const original = Buffer.from(bytes);
  // This independent producer's fixture triggers ExcelJS's note filename bug.
  await assert.rejects(new ExcelJS.Workbook().xlsx.load(bytes), /comments/);
  const rows = await parseWorkbook(bytes);
  assert.deepEqual(
    rows.map((row) => row.values),
    [
      ["数学", "1", "09:00", "10:30", "1-16", "全部"],
      ["法语", "3", "14:00", "15:35", "2-16", "双周"],
    ],
  );
  assert.ok(rows.every((row) => row.course && !row.issues.length));
  assert.deepEqual(bytes, original);
  const source = await JSZip.loadAsync(bytes);
  const clean = await JSZip.loadAsync(await workbookWithoutNotes(bytes));
  for (const name of Object.keys(source.files).filter(
    (name) => !name.endsWith(".rels"),
  )) {
    assert.equal(
      await clean.file(name).async("string"),
      await source.file(name).async("string"),
      name,
    );
  }
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await workbookWithoutNotes(bytes));
  assert.equal(book.worksheets[1].getCell("A1").value, "第二个工作表保持不变");
  assert.deepEqual(book.worksheets[0].getCell("G2").value, {
    text: "课程资料",
    hyperlink: "https://example.com/?a=1&b=2",
  });
});

test("ExcelJS notes import too; files without notes are passed through unchanged", async () => {
  const plain = await excelTemplate();
  assert.equal(await workbookWithoutNotes(plain), plain);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(plain);
  book.worksheets[0].getCell("A2").note = "Teacher and classroom";
  const bytes = await book.xlsx.writeBuffer();
  assert.equal((await parseWorkbook(bytes))[0].course.subject, "数学");
});

const entryByteLimit = 4 * 1024 * 1024;
const totalByteLimit = 16 * 1024 * 1024;
async function compressedWorkbook(entries) {
  const zip = await JSZip.loadAsync(await excelTemplate());
  for (const [name, content] of entries)
    zip.file(name, content, { createFolders: false });
  const bytes = await zip.generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE",
  });
  assert.ok(bytes.byteLength < 2 * 1024 * 1024);
  return bytes;
}

test("small compressed workbooks reject oversized entries before note or workbook parsing", async () => {
  for (const name of [
    "xl/worksheets/_rels/sheet1.xml.rels",
    "xl/worksheets/sheet2.xml",
    "xl/sharedStrings.xml",
    "xl/media/image1.png",
    "unused.bin",
  ]) {
    const bytes = await compressedWorkbook([
      [name, " ".repeat(entryByteLimit + 1)],
    ]);
    await assert.rejects(workbookWithoutNotes(bytes), /^Error: workbook_too_large$/);
    await assert.rejects(parseWorkbook(bytes), /^Error: workbook_too_large$/);
  }
});

test("oversized archives never reach full-member reads or ExcelJS loading", async (t) => {
  const bytes = await compressedWorkbook([
    ["unused.bin", " ".repeat(entryByteLimit + 1)],
  ]);
  const load = JSZip.loadAsync;
  t.mock.method(JSZip, "loadAsync", async (...args) => {
    const zip = await load.apply(JSZip, args);
    for (const entry of Object.values(zip.files))
      t.mock.method(entry, "async", () => {
        assert.fail("a complete ZIP member was allocated before rejection");
      });
    return zip;
  });
  t.mock.method(Object.getPrototypeOf(new ExcelJS.Workbook().xlsx), "load", () => {
    assert.fail("ExcelJS loaded an archive before its expansion check");
  });
  await assert.rejects(parseWorkbook(bytes), /^Error: workbook_too_large$/);
});

test("expanded bytes are counted even when ZIP size metadata understates them", async () => {
  const bytes = await compressedWorkbook([
    ["unused.bin", " ".repeat(entryByteLimit + 1)],
  ]);
  const view = new DataView(bytes);
  let changed = false;
  for (let offset = 0; offset <= bytes.byteLength - 46; offset++) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(
      new Uint8Array(bytes, offset + 46, nameLength),
    );
    if (name === "unused.bin") {
      view.setUint32(offset + 24, 1, true);
      changed = true;
      break;
    }
  }
  assert.ok(changed, "patched the central directory's expanded size");
  await assert.rejects(parseWorkbook(bytes), /^Error: workbook_too_large$/);
});

test("individually bounded entries cannot exceed the whole-workbook expansion budget", async () => {
  const bytes = await compressedWorkbook(
    Array.from({ length: 5 }, (_, i) => [
      `padding-${i}.bin`,
      " ".repeat(entryByteLimit),
    ]),
  );
  await assert.rejects(parseWorkbook(bytes), /^Error: workbook_too_large$/);
});

test("workbooks with excessive ZIP entry counts are rejected", async () => {
  const bytes = await compressedWorkbook(
    Array.from({ length: 257 }, (_, i) => [`empty-${i}.bin`, ""]),
  );
  await assert.rejects(parseWorkbook(bytes), /^Error: workbook_too_large$/);
});

test("a normal workbook with exactly 256 ZIP entries still imports", async () => {
  const zip = await JSZip.loadAsync(await excelTemplate());
  const count = Object.keys(zip.files).length;
  for (let i = count; i < 256; i++)
    zip.file(`empty-${i}.bin`, "", { createFolders: false });
  const bytes = await zip.generateAsync({ type: "arraybuffer" });
  assert.equal((await parseWorkbook(bytes))[0].course.subject, "数学");
});

test("entry and aggregate expansion limits are inclusive", async () => {
  const zip = new JSZip();
  for (let i = 0; i < totalByteLimit / entryByteLimit; i++)
    zip.file(`padding-${i}.bin`, " ".repeat(entryByteLimit));
  const bytes = await zip.generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE",
  });
  assert.equal(await workbookWithoutNotes(bytes), bytes);

  const workbook = await compressedWorkbook([
    ["unused.bin", " ".repeat(entryByteLimit)],
  ]);
  assert.equal((await parseWorkbook(workbook))[0].course.subject, "数学");
});

test("a normal 500-course workbook still imports at the row limit", async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("课程表");
  sheet.addRow(templateHeaders);
  for (let i = 0; i < 500; i++)
    sheet.addRow([`课程 ${i + 1}`, 1, "09:00", "10:30", "1-16", "全部"]);
  const bytes = await book.xlsx.writeBuffer();
  const original = Buffer.from(bytes);
  const rows = await parseWorkbook(bytes);
  assert.equal(rows.length, 500);
  assert.ok(rows.every((row) => row.course && !row.issues.length));
  assert.deepEqual(bytes, original);
});

test("import failures distinguish invalid data from unreadable workbooks", async () => {
  await assert.rejects(
    parseWorkbook(new Uint8Array([1, 2, 3]).buffer),
    /^Error: invalid_xlsx$/,
  );
  const book = new ExcelJS.Workbook();
  book.addWorksheet("课程表").addRow(["错误表头"]);
  await assert.rejects(
    parseWorkbook(await book.xlsx.writeBuffer()),
    /^Error: template_headers$/,
  );
  await assert.rejects(
    parseWorkbook(await new ExcelJS.Workbook().xlsx.writeBuffer()),
    /^Error: empty_workbook$/,
  );
  assert.match(importFailure(new Error("template_headers")).zh, /首行列名/);
  assert.match(importFailure(new Error("too_many_rows")).zh, /500/);
  assert.match(importFailure(new Error("workbook_too_large")).en, /expanded/i);
  assert.match(importFailure(new Error("invalid_xlsx")).zh, /解析 Excel/);
  assert.match(
    importFailure(new Error("workbook_reader_unavailable")).zh,
    /网络/,
  );
  assert.match(importFailure(null).zh, /重新选择文件/);
});
