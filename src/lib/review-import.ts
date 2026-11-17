import Papa from "papaparse";
import {
  parseWeeks,
  validTime,
  type Course,
  type Issue,
} from "./review-planner.ts";

export const templateHeaders = [
  "科目",
  "星期",
  "开始时间",
  "结束时间",
  "周次",
  "单双周",
];
export const templateRows = [
  templateHeaders,
  ["数学", "1", "09:00", "10:30", "1-16", "全部"],
];
export type ImportRow = {
  row: number;
  values: string[];
  course: Course | null;
  issues: Issue[];
};

type FilePicker = Pick<HTMLInputElement, "value" | "disabled" | "click"> &
  Partial<Pick<HTMLInputElement, "showPicker">>;

// Keep this synchronous: Safari requires the picker to open in the click event.
export function openImportPicker(input: FilePicker): void {
  if (input.disabled) throw new Error("file_input_disabled");
  input.value = "";
  if (typeof input.showPicker === "function") {
    try {
      input.showPicker();
      return;
    } catch {
      // Older browsers and embedded pages may only support native click().
    }
  }
  input.click();
}

const weekdays: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  天: 7,
};
function clock(value: unknown): string {
  if (value instanceof Date)
    return `${String(value.getUTCHours()).padStart(2, "0")}:${String(value.getUTCMinutes()).padStart(2, "0")}`;
  if (typeof value === "number" && value >= 0 && value < 1) {
    const n = Math.round(value * 1440);
    return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
  }
  return String(value ?? "").trim();
}
export function validateImportRows(rows: unknown[][]): ImportRow[] {
  if (
    !rows.length ||
    !templateHeaders.every(
      (v, i) =>
        String(rows[0][i] ?? "")
          .replace(/^\uFEFF/, "")
          .trim() === v,
    )
  )
    throw new Error("template_headers");
  if (rows.length > 501) throw new Error("too_many_rows");
  const seen = new Set<string>();
  return rows
    .slice(1)
    .map((cells, i) => {
      const values = cells.map((v, index) =>
        index === 2 || index === 3 ? clock(v) : String(v ?? "").trim(),
      );
      const [
        subject = "",
        day = "",
        start = "",
        end = "",
        weeks = "",
        rawParity = "",
      ] = values;
      const weekday = Number(day) || weekdays[day.replace(/^星期|^周/, "")];
      const parity = (
        {
          全部: "all",
          单周: "odd",
          双周: "even",
          all: "all",
          odd: "odd",
          even: "even",
        } as const
      )[rawParity as "全部"];
      const issues: Issue[] = [];
      const add = (zh: string, en: string) => issues.push({ zh, en });
      if (!subject || subject.length > 120)
        add(
          "科目须为 1–120 个字符。",
          "Subject must contain 1–120 characters.",
        );
      if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7)
        add(
          "星期填写 1–7（周一至周日）。",
          "Weekday must be 1–7 (Monday to Sunday).",
        );
      if (!validTime(start) || !validTime(end) || end <= start)
        add(
          "时间须为 HH:mm，结束须晚于开始。",
          "Use HH:mm; end must be after start.",
        );
      try {
        parseWeeks(weeks);
      } catch {
        add(
          "周次示例：1-8,10-16，范围 1–53。",
          "Weeks: e.g. 1-8,10-16, within 1–53.",
        );
      }
      if (!parity)
        add(
          "单双周填写：全部、单周或双周。",
          "Parity must be 全部/all, 单周/odd, or 双周/even.",
        );
      const fingerprint = JSON.stringify([
        subject,
        weekday,
        start,
        end,
        weeks,
        parity,
      ]);
      if (seen.has(fingerprint))
        add("该课程与文件内另一行重复。", "Duplicate lesson in this file.");
      seen.add(fingerprint);
      return {
        row: i + 2,
        values,
        issues,
        course: issues.length
          ? null
          : {
              id: crypto.randomUUID(),
              subject,
              weekday,
              start,
              end,
              weeks,
              parity,
            },
      };
    })
    .filter((r) => r.values.some(Boolean));
}
export function parseCsv(text: string): ImportRow[] {
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), {
    skipEmptyLines: "greedy",
  });
  if (parsed.errors.length) throw new Error("invalid_csv");
  return validateImportRows(parsed.data);
}
export async function parseWorkbook(buffer: ArrayBuffer): Promise<ImportRow[]> {
  const [{ default: ExcelJS }, { workbookWithoutNotes }] = await Promise.all([
    import("exceljs"),
    import("./review-workbook.ts"),
  ]).catch((cause) => {
    throw new Error("workbook_reader_unavailable", { cause });
  });
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(await workbookWithoutNotes(buffer));
  } catch (cause) {
    if (cause instanceof Error && cause.message === "workbook_too_large")
      throw cause;
    throw new Error("invalid_xlsx", { cause });
  }
  const sheet = book.worksheets[0];
  if (!sheet) throw new Error("empty_workbook");
  if (sheet.rowCount > 501) throw new Error("too_many_rows");
  const rows: unknown[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) =>
    rows.push(Array.from({ length: 6 }, (_, i) => row.getCell(i + 1).value)),
  );
  return validateImportRows(rows);
}
export function importFailure(error: unknown): Issue {
  const messages: Record<string, Issue> = {
    template_headers: {
      zh: "首行列名不匹配，请依次填写：科目、星期、开始时间、结束时间、周次、单双周。",
      en: "The first row must contain these headers in order: 科目, 星期, 开始时间, 结束时间, 周次, 单双周.",
    },
    too_many_rows: {
      zh: "课表超过 500 行，请拆分文件后导入。",
      en: "The timetable exceeds 500 rows. Split the file before importing.",
    },
    workbook_too_large: {
      zh: "Excel 文件解压后的数据过多，请删除不需要的工作表或图片，或导出为 CSV 后重试。",
      en: "The Excel workbook contains too much expanded data or too many files. Remove unused sheets or images, or export it as CSV and retry.",
    },
    empty_workbook: {
      zh: "Excel 文件没有工作表，请使用下载的模板。",
      en: "The Excel file has no worksheets. Use the downloaded template.",
    },
    no_courses: {
      zh: "文件中没有课程，请在表头下填写课程后再导入。",
      en: "No lessons found. Add lessons below the header before importing.",
    },
    unsupported_file: {
      zh: "不支持此文件类型，请选择 .xlsx 或 UTF-8 编码的 .csv 文件。",
      en: "Choose an .xlsx or UTF-8 .csv file.",
    },
    invalid_csv: {
      zh: "CSV 结构不完整，请检查引号和分隔符，或重新另存为 UTF-8 CSV。",
      en: "The CSV structure is invalid. Check quotes and delimiters, or save it as UTF-8 CSV again.",
    },
    invalid_xlsx: {
      zh: "无法解析 Excel 文件，可能已损坏或包含不兼容内容。请用 Excel 另存为 .xlsx，或导出为 UTF-8 CSV 后重试。",
      en: "The Excel file could not be parsed. It may be damaged or contain unsupported content. Save it as .xlsx or export it as UTF-8 CSV and retry.",
    },
    workbook_reader_unavailable: {
      zh: "Excel 读取组件加载失败，请检查网络并刷新页面后重试。",
      en: "The Excel reader could not load. Check your connection, refresh the page, and retry.",
    },
  };
  return (
    messages[error instanceof Error ? error.message : ""] ?? {
      zh: "课表读取失败，请重新选择文件后重试。",
      en: "The timetable could not be read. Select the file again and retry.",
    }
  );
}
export function csvTemplate(): string {
  return "\uFEFF" + Papa.unparse(templateRows);
}
export async function excelTemplate(): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("课程表");
  sheet.addRows(templateRows);
  sheet.columns.forEach((c) => {
    c.width = 20;
  });
  sheet.getRow(1).font = { bold: true };
  return (await book.xlsx.writeBuffer()) as ArrayBuffer;
}
