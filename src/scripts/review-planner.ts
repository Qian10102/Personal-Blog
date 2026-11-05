import {
  createClient,
  type SupabaseClient,
  type Session as AuthSession,
} from "@supabase/supabase-js";
import {
  addDays,
  blocksForDate,
  completedMinutes,
  defaultDocument,
  generatePlan,
  localDateTime,
  needsReplan,
  parseTaskDraft,
  today,
  validateDocument,
  weekday,
  type PlannerState,
  type PlannerDocument,
  type Plan,
  type Phase,
  type Task,
} from "../lib/review-planner";
import {
  csvTemplate,
  excelTemplate,
  parseCsv,
  parseWorkbook,
  templateHeaders,
  validateImportRows,
  type ImportRow,
} from "../lib/review-import";
import { rememberPlannerReturn } from "../lib/review-auth-return";

const root = document.querySelector<HTMLElement>("[data-planner-app]")!;
const status = document.querySelector<HTMLElement>("[data-planner-status]")!;
const login = document.querySelector<HTMLElement>("[data-planner-login]")!;
const allowedEmail = "qianzihanduo@gmail.com";
const tr = (zh: string, en: string) =>
  document.documentElement.dataset.uiLanguage === "en" ? en : zh;
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
let client: SupabaseClient | null = null;
let owner: string | null = null;
let epoch = 0;
let state: PlannerState = {
  revision: 0,
  document: defaultDocument(),
  plan: null,
  completions: [],
};
let tab = "plan";
let edit: { kind: string; id: string } | null = null;
let busy = false;
let loaded = false;
let preview: Plan | null = null;
let importRows: ImportRow[] | null = null;
let aiDraft: {
  examId: string;
  tasks: Omit<Task, "id" | "examId" | "confirmed">[];
  warnings: string[];
} | null = null;
let weekDate = today(state.document.settings.timezone);
type Pending = {
  requestId: string;
  revision: number;
  document: PlannerDocument;
  plan: Plan | null;
  completion: { sessionId: string; completed: boolean } | null;
};
let pending: Pending | null = null;
let message: [string, string] = ["", ""];
let messageError = false;
function say(zh: string, en: string, error = false) {
  message = [zh, en];
  messageError = error;
  status.textContent = tr(zh, en);
  status.dataset.error = String(error);
}
const phaseName = (p: Phase) =>
  ({
    learn: tr("知识梳理", "Understand"),
    practice: tr("练习", "Practice"),
    recap: tr("考前回顾", "Final recap"),
  })[p];
const dayName = (n: number) =>
  tr(
    ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][n - 1],
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][n - 1],
  );
const key = () => `review-planner-pending:${owner}`;
function persistPending() {
  try {
    if (pending) sessionStorage.setItem(key(), JSON.stringify(pending));
    else sessionStorage.removeItem(key());
  } catch {
    /* Saving remains retryable while this page stays open. */
  }
}
function download(data: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function input(
  name: string,
  label: string,
  value: unknown = "",
  type = "text",
  extra = "",
) {
  return `<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
}
function area(name: string, label: string, value = "", extra = "") {
  return `<label class="planner-wide">${esc(label)}<textarea name="${name}" ${extra}>${esc(value)}</textarea></label>`;
}
function select(
  name: string,
  label: string,
  value: unknown,
  options: [string | number, string][],
) {
  return `<label>${esc(label)}<select name="${name}" ${name === "courseId" ? "" : "required"}>${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
}
const days = () =>
  Array.from(
    { length: 7 },
    (_, i) => [i + 1, dayName(i + 1)] as [number, string],
  );
const submit = (label = tr("保存", "Save")) =>
  `<button class="planner-primary" type="submit">${label}</button>${edit ? ` <button type="button" data-action="cancel-edit">${tr("取消编辑", "Cancel edit")}</button>` : ""}`;
const action = (name: string, label: string, id = "", cls = "") =>
  `<button type="button" class="${cls}" data-action="${name}" data-id="${esc(id)}">${label}</button>`;
function empty(text = tr("还没有记录。", "Nothing here yet.")) {
  return `<p class="planner-empty">${esc(text)}</p>`;
}
function controls(kind: string, id: string) {
  return `<div class="planner-actions">${action(`edit-${kind}`, tr("编辑", "Edit"), id)}${action(`delete-${kind}`, tr("删除", "Delete"), id, "planner-danger")}</div>`;
}
function renderCourses(): string {
  const d = state.document;
  const c = d.courses.find((c) => edit?.kind === "course" && edit.id === c.id);
  const a = d.adjustments.find(
    (a) => edit?.kind === "adjustment" && edit.id === a.id,
  );
  return `<section class="planner-card"><h2>${tr("每周课程", "Weekly classes")}</h2><p class="planner-muted">${tr("周次按学期第一周计算。相同科目的多次课程可分别录入。", "Weeks count from the semester's first Monday. Add each lesson separately.")}</p>
    <form data-form="course"><div class="planner-fields">${input("subject", tr("科目", "Subject"), c?.subject, "text", 'required maxlength="120"')}${select("weekday", tr("星期", "Weekday"), c?.weekday ?? 1, days())}${input("start", tr("开始", "Start"), c?.start ?? "09:00", "time", "required")}${input("end", tr("结束", "End"), c?.end ?? "10:30", "time", "required")}${input("weeks", tr("适用周次，如 1-8,10-16", "Weeks, e.g. 1-8,10-16"), c?.weeks ?? "1-16", "text", "required")}${select(
      "parity",
      tr("单双周", "Week parity"),
      c?.parity ?? "all",
      [
        ["all", tr("全部", "All")],
        ["odd", tr("单周", "Odd")],
        ["even", tr("双周", "Even")],
      ],
    )}</div>${submit(c ? tr("更新课程", "Update class") : tr("添加课程", "Add class"))}</form>
    ${d.courses.length ? `<ul class="planner-list">${d.courses.map((c) => `<li><div class="planner-section-heading"><div><strong>${esc(c.subject)}</strong><p>${dayName(c.weekday)} ${c.start}–${c.end} · ${esc(c.weeks)} · ${{ all: tr("全部", "All"), odd: tr("单周", "Odd"), even: tr("双周", "Even") }[c.parity]}</p></div>${controls("course", c.id)}</div></li>`).join("")}</ul>` : empty()}
  </section><section class="planner-card"><h2>${tr("批量导入课程", "Import classes")}</h2><p class="planner-muted">${tr("使用专用模板，第一行保留中文列名；最多 500 行、文件不超过 2 MB。文件在当前浏览器解析。", "Use the template with its Chinese headers; up to 500 rows and 2 MB. Files are parsed in your browser.")}</p><div class="planner-actions planner-import-actions">${action("template-csv", tr("下载 CSV 模板", "CSV template"))}${action("template-xlsx", tr("下载 Excel 模板", "Excel template"))}<label class="planner-file">${tr("选择课表", "Choose timetable")}<input data-import-file type="file" accept=".csv,.xlsx"></label></div>${renderImport()}</section>
  <section class="planner-card"><h2>${tr("停课与补课", "Cancellations & makeup classes")}</h2><form data-form="adjustment"><div class="planner-fields">${select(
    "kind",
    tr("类型", "Type"),
    a?.kind ?? "cancel",
    [
      ["cancel", tr("停课", "Cancel")],
      ["makeup", tr("补课", "Makeup")],
    ],
  )}${input("date", tr("日期", "Date"), a?.date ?? today(d.settings.timezone), "date", "required")}${select("courseId", tr("原课程（停课时必选）", "Original class (for cancellation)"), a?.courseId ?? "", [["", "—"], ...d.courses.map((c) => [c.id, `${c.subject} · ${dayName(c.weekday)} ${c.start}`] as [string, string])])}${input("subject", tr("补课科目", "Makeup subject"), a?.subject)}${input("start", tr("补课开始", "Makeup start"), a?.start ?? "09:00", "time")}${input("end", tr("补课结束", "Makeup end"), a?.end ?? "10:30", "time")}</div>${submit()}</form><ul class="planner-list">${d.adjustments.map((a) => `<li><div class="planner-section-heading"><p>${esc(a.date)} · ${a.kind === "cancel" ? tr("停课", "Cancelled") : tr("补课", "Makeup")} · ${esc(a.kind === "cancel" ? d.courses.find((c) => c.id === a.courseId)?.subject : `${a.subject} ${a.start}–${a.end}`)}</p>${controls("adjustment", a.id)}</div></li>`).join("")}</ul></section>`;
}
function renderImport(): string {
  if (!importRows) return "";
  return `<form data-form="import"><div class="planner-table-scroll planner-import"><table><thead><tr><th>#</th>${templateHeaders.map((h) => `<th>${esc(h)}</th>`).join("")}<th>${tr("检查结果", "Validation")}</th></tr></thead><tbody>${importRows.map((r, i) => `<tr><td>${r.row}</td>${templateHeaders.map((h, j) => `<td><input aria-label="${esc(`${r.row} ${h}`)}" name="cell-${i}-${j}" value="${esc(r.values[j])}"></td>`).join("")}<td>${r.issues.length ? r.issues.map((e) => esc(tr(e.zh, e.en))).join("<br>") : tr("可导入", "Ready")}</td></tr>`).join("")}</tbody></table></div><p>${tr("确认后将追加这些课程；可直接在预览中修正。", "Confirm to append these lessons. You can correct values in this preview.")}</p><div class="planner-actions">${submit(tr("校验并确认导入", "Validate & confirm import"))}${action("cancel-import", tr("取消", "Cancel"))}</div></form>`;
}
function renderExams(): string {
  const d = state.document;
  const e = d.exams.find((e) => edit?.kind === "exam" && e.id === edit.id);
  const subjects = [...new Set(d.courses.map((c) => c.subject))].sort();
  const t = d.tasks.find((t) => edit?.kind === "task" && t.id === edit.id);
  return `<section class="planner-card"><h2>${tr("考试信息", "Exams")}</h2>${
    !subjects.length
      ? empty(
          tr(
            "先添加课程，再选择考试科目。",
            "Add a class before selecting an exam subject.",
          ),
        )
      : `<form data-form="exam"><div class="planner-fields">${select(
          "subject",
          tr("科目", "Subject"),
          e?.subject ?? subjects[0],
          subjects.map((s) => [s, s]),
        )}${input("title", tr("考试名称", "Exam name"), e?.title, "text", 'required maxlength="200"')}${input("start", tr("考试开始", "Exam starts"), e?.start, "datetime-local", "required")}${input("end", tr("考试结束", "Exam ends"), e?.end, "datetime-local", "required")}${select(
          "mastery",
          tr("掌握程度", "Current confidence"),
          e?.mastery ?? "normal",
          [
            ["weak", tr("薄弱", "Needs work")],
            ["normal", tr("一般", "Some confidence")],
            ["strong", tr("熟练", "Confident")],
          ],
        )}${area("scope", tr("考试范围：列出章节、知识点和练习要求", "Exam scope: chapters, topics, and practice requirements"), e?.scope, 'required maxlength="12000"')}</div>${submit(e ? tr("更新考试", "Update exam") : tr("添加考试", "Add exam"))}</form>`
  }
    <ul class="planner-list">${d.exams.map((e) => `<li><div class="planner-section-heading"><div><strong>${esc(e.title)} · ${esc(e.subject)}</strong><p>${esc(e.start.replace("T", " "))} → ${esc(e.end.replace("T", " "))}</p></div>${controls("exam", e.id)}</div><details><summary>${tr("查看考试范围", "View scope")}</summary><p>${esc(e.scope)}</p></details>${action("ai", tr("AI 拆分任务", "Suggest tasks with AI"), e.id)} <small>${tr("仅点击时调用模型；建议用时需自行确认。", "Calls the model only on click; check the suggested durations.")}</small></li>`).join("")}</ul>${renderAi()}</section>
    <section class="planner-card"><h2>${tr("复习任务", "Review tasks")}</h2><p class="planner-muted">${tr("先完成知识梳理，再做练习；考前一天回顾。阶段内按顺序执行。任务估时以 25 分钟为单位。", "Understand first, then practice; recap the day before the exam. Tasks follow their order within each phase. Estimate in 25-minute units.")}</p>${
      d.exams.length
        ? `<form data-form="task"><div class="planner-fields">${select(
            "examId",
            tr("所属考试", "Exam"),
            t?.examId ?? d.exams[0].id,
            d.exams.map((e) => [e.id, e.title]),
          )}${input("title", tr("任务名称", "Task title"), t?.title, "text", 'required maxlength="200"')}${select(
            "phase",
            tr("阶段", "Phase"),
            t?.phase ?? "learn",
            ["learn", "practice", "recap"].map((p) => [
              p,
              phaseName(p as Phase),
            ]),
          )}${input("order", tr("阶段内顺序", "Order within phase"), t?.order ?? d.tasks.length + 1, "number", 'required min="1" step="1"')}${input("minutes", tr("预计分钟数", "Estimated minutes"), t?.minutes ?? 50, "number", 'required min="25" max="6000" step="25"')}${area("content", tr("具体复习内容", "What to review"), t?.content, 'required maxlength="2000"')}<label class="planner-check planner-wide"><input name="confirmed" type="checkbox" ${t?.confirmed ? "checked" : ""}>${tr("我已核对内容和预计用时", "I have checked the content and estimated time")}</label></div>${submit()}</form>`
        : empty(
            tr(
              "添加考试后，可以手动添加任务或使用 AI 拆分。",
              "Add an exam, then create tasks manually or ask AI.",
            ),
          )
    }
    <ul class="planner-list">${[...d.tasks]
      .sort((a, b) => a.examId.localeCompare(b.examId) || a.order - b.order)
      .map(
        (t) =>
          `<li><div class="planner-section-heading"><div><span class="planner-pill">${phaseName(t.phase)}</span><strong>${esc(t.title)}</strong><p>${esc(d.exams.find((e) => e.id === t.examId)?.title)} · #${t.order} · ${completedMinutes(state.completions, t.id)}/${t.minutes} min · ${t.confirmed ? tr("已确认", "Confirmed") : tr("待确认", "Needs confirmation")}</p></div>${controls("task", t.id)}</div><p>${esc(t.content)}</p>${!t.confirmed ? action("confirm-task", tr("确认这项任务", "Confirm task"), t.id) : ""}</li>`,
      )
      .join("")}</ul></section>`;
}
function renderAi(): string {
  if (!aiDraft) return "";
  return `<section class="planner-card planner-preview"><h3>${tr("AI 任务草稿", "AI task draft")} · ${esc(state.document.exams.find((e) => e.id === aiDraft?.examId)?.title)}</h3>${aiDraft.warnings.map((w) => `<p class="planner-alert">${esc(w)}</p>`).join("")}<form data-form="ai-draft">${aiDraft.tasks
    .map(
      (t, i) =>
        `<div class="planner-card"><div class="planner-fields">${input(`title-${i}`, tr("任务", "Task"), t.title, "text", 'required maxlength="200"')}${select(
          `phase-${i}`,
          tr("阶段", "Phase"),
          t.phase,
          ["learn", "practice", "recap"].map((p) => [p, phaseName(p as Phase)]),
        )}${input(`minutes-${i}`, tr("分钟", "Minutes"), t.minutes, "number", 'required min="25" max="6000" step="25"')}${input(`order-${i}`, tr("顺序", "Order"), t.order, "number", 'required min="1" step="1"')}${area(`content-${i}`, tr("内容", "Content"), t.content, 'required maxlength="2000"')}<label class="planner-check"><input type="checkbox" name="remove-${i}">${tr("移除本项", "Remove task")}</label></div></div>`,
    )
    .join("")}${select(
    "mode",
    tr("已有任务的处理", "Existing tasks"),
    "replace",
    [
      [
        "replace",
        tr(
          "替换本考试尚未开始的任务，保留已有完成记录的任务",
          "Replace unstarted tasks; keep tasks with completed work",
        ),
      ],
      ["append", tr("追加到现有任务", "Append to existing tasks")],
    ],
  )}<p class="planner-muted">${tr("请核对是否有重复内容；确认后，这些任务会用于排程。", "Check for duplicate content. Confirmed tasks will be used for scheduling.")}</p><div class="planner-actions">${submit(tr("确认任务内容与用时", "Confirm tasks & estimates"))}${action("cancel-ai", tr("取消草稿", "Discard draft"))}</div></form></section>`;
}
function renderSettings(): string {
  const d = state.document,
    s = d.settings;
  const w = d.windows.find((w) => edit?.kind === "window" && w.id === edit.id);
  const e = d.exceptions.find(
    (e) => edit?.kind === "exception" && e.id === edit.id,
  );
  return `<section class="planner-card"><h2>${tr("学期与复习节奏", "Semester & study rhythm")}</h2><form data-form="settings"><div class="planner-fields">${input("timezone", tr("时区（IANA 名称）", "Time zone (IANA name)"), s.timezone, "text", 'required list="planner-timezones"')}<datalist id="planner-timezones"><option value="Asia/Shanghai"></option><option value="Europe/Paris"></option><option value="UTC"></option><option value="America/New_York"></option></datalist>${input("semesterStart", tr("学期第一周的星期一", "Monday of semester week one"), s.semesterStart, "date", "required")}${input("semesterEnd", tr("学期结束", "Semester ends"), s.semesterEnd, "date", "required")}${input("planStart", tr("复习计划开始日", "Review starts"), s.planStart, "date", "required")}${input("sessionMinutes", tr("单次最长复习分钟", "Maximum session minutes"), s.sessionMinutes, "number", 'required min="25" max="175" step="25"')}${input("breakMinutes", tr("复习间休息分钟", "Break minutes"), s.breakMinutes, "number", 'required min="0" max="120" step="1"')}</div>${submit()}</form></section>
    <section class="planner-card"><h2>${tr("每周可复习时段", "Weekly availability")}</h2><p class="planner-muted">${tr("只在这些时段内安排复习，再扣除课程、考试与临时占用。每天可添加多个时段。", "Review stays inside these windows, excluding classes, exams, and blocked time. Add multiple windows per day.")}</p><form data-form="window"><div class="planner-fields">${select("weekday", tr("星期", "Weekday"), w?.weekday ?? 1, days())}${input("start", tr("开始", "Start"), w?.start ?? "18:00", "time", "required")}${input("end", tr("结束", "End"), w?.end ?? "21:00", "time", "required")}</div>${submit(tr("保存时段", "Save window"))}</form><ul class="planner-list">${[
      ...d.windows,
    ]
      .sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start))
      .map(
        (w) =>
          `<li><div class="planner-section-heading"><span>${dayName(w.weekday)} ${w.start}–${w.end}</span>${controls("window", w.id)}</div></li>`,
      )
      .join(
        "",
      )}</ul><form data-form="limits"><h3>${tr("每日复习上限（分钟）", "Daily review limits (minutes)")}</h3><div class="planner-fields">${s.dailyLimits.map((n, i) => input(`limit-${i}`, dayName(i + 1), n, "number", 'required min="0" max="1440" step="1"')).join("")}</div><label class="planner-check"><input type="checkbox" name="confirmed" required ${s.availabilityConfirmed ? "checked" : ""}>${tr("我已确认可用时段与每日上限", "I have checked my availability and daily limits")}</label><p></p>${submit(tr("确认并保存", "Confirm & save"))}</form></section>
    <section class="planner-card"><h2>${tr("临时占用", "Blocked time")}</h2><form data-form="exception"><div class="planner-fields">${input("title", tr("活动名称", "Activity"), e?.title, "text", 'required maxlength="200"')}${input("date", tr("日期", "Date"), e?.date ?? today(s.timezone), "date", "required")}${input("start", tr("开始", "Start"), e?.start ?? "18:00", "time", "required")}${input("end", tr("结束", "End"), e?.end ?? "19:00", "time", "required")}</div>${submit()}</form><ul class="planner-list">${d.exceptions.map((e) => `<li><div class="planner-section-heading"><span>${esc(e.date)} ${e.start}–${e.end} · ${esc(e.title)}</span>${controls("exception", e.id)}</div></li>`).join("")}</ul></section>`;
}
function timeRange(start: string, end: string) {
  return `${localDateTime(start, state.document.settings.timezone).slice(11)}–${localDateTime(end, state.document.settings.timezone).slice(11)}`;
}
function renderPlan(): string {
  const p = preview ?? state.plan;
  const complete = new Set(state.completions.map((c) => c.session.id));
  const monday = addDays(weekDate, 1 - weekday(weekDate));
  const dates = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const docs = state.document;
  const sessions = p?.sessions ?? [];
  let week = "";
  try {
    week = dates
      .map((date) => {
        const blocks = blocksForDate(docs, date).map((b) => ({
          start: new Date(b.start).toISOString(),
          end: new Date(b.end).toISOString(),
          title: b.title,
          kind: b.kind,
          content: "",
        }));
        const events = [
          ...blocks,
          ...sessions
            .filter((s) =>
              localDateTime(s.start, docs.settings.timezone).startsWith(date),
            )
            .map((s) => ({
              ...s,
              kind: complete.has(s.id) ? "completed" : "review",
            })),
        ].sort((a, b) => a.start.localeCompare(b.start));
        return `<div class="planner-day"><h3>${dayName(weekday(date))}<br>${date}</h3>${events.length ? events.map((e) => `<div class="planner-event ${e.kind}"><time>${timeRange(e.start, e.end)}</time><strong>${esc(e.title)}</strong>${e.content ? `<p>${esc(e.content)}</p>` : ""}<small>${({ course: tr("课程", "Class"), exam: tr("考试", "Exam"), exception: tr("占用", "Busy"), completed: tr("已完成", "Done"), review: tr("复习", "Review") } as Record<string, string>)[e.kind]}</small></div>`).join("") : `<small>${tr("暂无安排", "No events")}</small>`}</div>`;
      })
      .join("");
  } catch {
    week = empty(
      tr(
        "时间设置尚有错误，请检查时区及课程时间。",
        "Check your time zone and lesson times to show this week.",
      ),
    );
  }
  const doneCount = sessions.filter((s) => complete.has(s.id)).length;
  return `<section class="planner-card ${preview ? "planner-preview" : ""}"><div class="planner-section-heading"><div><h2>${preview ? tr("新计划预览", "Preview new plan") : tr("你的复习计划", "Your review plan")}</h2><p class="planner-muted">${esc(docs.settings.timezone)} · ${tr("复习间休息", "Breaks")} ${docs.settings.breakMinutes} min</p></div><div class="planner-actions">${preview ? action("confirm-plan", tr("确认采用新计划", "Use this plan"), "", "planner-primary") + action("cancel-plan", tr("取消预览", "Cancel preview")) : action("generate", state.plan ? tr("重新安排剩余任务", "Replan remaining work") : tr("生成复习计划", "Generate plan"), "", "planner-primary")}</div></div>
    ${needsReplan(state) && !preview ? `<p class="planner-alert">${tr("输入已更新，当前计划需要重排。已有完成记录会保留。", "Your inputs changed. Replan to update the schedule; completed work is kept.")}</p>` : ""}
    ${!p ? empty(tr("先填写课程、考试和任务，再确认可用时间，即可生成计划。", "Add classes, exams and tasks, then confirm your availability to generate a plan.")) : `<div class="planner-stats"><div><strong>${sessions.length}</strong><span>${tr("复习时段", "Study sessions")}</span></div><div><strong>${doneCount}</strong><span>${tr("已完成", "Completed")}</span></div><div><strong>${p.gaps.reduce((n, g) => n + g.unscheduledMinutes, 0)}</strong><span>${tr("未排入分钟", "Unscheduled minutes")}</span></div></div>${p.gaps.length ? `<details open class="planner-alert"><summary>${tr("有内容未排入，请调整可用时间或任务用时", "Some work is unscheduled; adjust availability or estimates")}</summary><p>${tr("本次可用容量", "Available capacity at generation")}: ${p.availableMinutes} min</p><ul>${p.gaps.map((g) => `<li>${esc(p.document.exams.find((e) => e.id === g.examId)?.title)} · ${esc(g.title)}: ${tr("需安排", "Required")} ${g.requiredMinutes} min · ${tr("未排入", "Unscheduled")} ${g.unscheduledMinutes} min · ${tr("截止前剩余可用", "Capacity remaining before deadline")} ${g.availableMinutes} min</li>`).join("")}</ul></details>` : ""}`}
    <div class="planner-section-heading"><h3>${monday} — ${dates[6]}</h3><div class="planner-actions">${action("previous-week", tr("上一周", "Previous week"))}${action("today", tr("本周", "This week"))}${action("next-week", tr("下一周", "Next week"))}</div></div><div class="planner-table-scroll"><div class="planner-week">${week}</div></div></section>
    <section class="planner-card"><h2>${tr("每日任务清单", "Daily checklist")}</h2>${dates
      .map((date) => {
        const rows = sessions.filter((s) =>
          localDateTime(s.start, docs.settings.timezone).startsWith(date),
        );
        return `<h3>${date} · ${dayName(weekday(date))}</h3>${rows.length ? `<ul class="planner-list">${rows.map((s) => `<li class="${complete.has(s.id) ? "planner-completed" : ""}"><label class="planner-check"><input type="checkbox" data-complete="${esc(s.id)}" ${complete.has(s.id) ? "checked" : ""} ${preview ? "disabled" : ""}><strong>${esc(s.subject)} · ${esc(s.title)}</strong></label><p>${timeRange(s.start, s.end)} · ${s.minutes} min · ${phaseName(s.phase)}</p><p>${esc(s.content)}</p>${!preview && !complete.has(s.id) && Date.parse(s.end) < Date.now() ? `<small>${tr("已过期未完成，重排时会重新安排。", "Missed session; included when you replan.")}</small>` : ""}</li>`).join("")}</ul>` : empty(tr("这一天没有复习任务。", "No review tasks for this day."))}`;
      })
      .join("")}</section>`;
}
function render() {
  if (!owner) return;
  root.innerHTML = `<div class="planner-toolbar"><p>${esc(allowedEmail)}<br><small>${tr("已同步版本", "Synced revision")} ${state.revision}</small></p><div class="planner-actions">${pending ? action("retry", tr("重试保存", "Retry save"), "", "planner-primary") : ""}${action("backup", tr("下载输入备份", "Download input backup"))}${action("reload", tr("重新加载", "Reload"))}${action("signout", tr("退出登录", "Sign out"))}</div></div>${pending ? `<p class="planner-alert">${tr("有一次保存尚未确认。输入已保留，请重试保存；切换设备前确认同步成功。", "A save is unconfirmed. Your input is kept. Retry and confirm synchronization before switching devices.")}</p>` : ""}${
    loaded
      ? `<nav class="planner-tabs" aria-label="${tr("复习计划功能", "Planner views")}">${[
          ["plan", tr("计划", "Plan")],
          ["courses", tr("课程表", "Timetable")],
          ["exams", tr("考试与任务", "Exams & tasks")],
          ["settings", tr("时间设置", "Availability")],
        ]
          .map(
            ([name, label]) =>
              `<button type="button" data-tab="${name}" aria-current="${tab === name ? "page" : "false"}">${label}</button>`,
          )
          .join(
            "",
          )}</nav>${tab === "courses" ? renderCourses() : tab === "exams" ? renderExams() : tab === "settings" ? renderSettings() : renderPlan()}`
      : empty(
          tr(
            "正在加载，失败时可点击重新加载。",
            "Loading. Use Reload if loading fails.",
          ),
        )
  }`;
  root.setAttribute("aria-busy", String(busy));
  root
    .querySelectorAll<
      | HTMLInputElement
      | HTMLButtonElement
      | HTMLSelectElement
      | HTMLTextAreaElement
    >("input,button,select,textarea")
    .forEach((el) => {
      if (
        busy ||
        (pending &&
          !["retry", "reload", "backup", "signout"].includes(
            el.dataset.action ?? "",
          ) &&
          !el.dataset.tab)
      )
        el.disabled = true;
    });
}
async function load() {
  if (!client || !owner || busy) return;
  const ticket = epoch;
  busy = true;
  render();
  try {
    const { data, error } = await client.rpc("get_review_planner");
    if (ticket !== epoch) return;
    if (error) throw error;
    state = data ?? {
      revision: 0,
      document: defaultDocument(),
      plan: null,
      completions: [],
    };
    loaded = true;
    if (pending) state.document = pending.document;
    say(
      pending ? "已载入；请重试尚未确认的保存。" : "课表与进度已同步。",
      pending
        ? "Loaded. Retry the unconfirmed save."
        : "Your timetable and progress are synchronized.",
    );
  } catch {
    if (ticket === epoch)
      say(
        "加载失败，请检查数据库迁移与网络连接，然后重试。",
        "Loading failed. Check the database migration and connection, then retry.",
        true,
      );
  } finally {
    if (ticket === epoch) {
      busy = false;
      render();
    }
  }
}
async function sendPending() {
  if (!client || !owner || !pending || busy) return;
  const operation = pending,
    ticket = epoch;
  busy = true;
  render();
  say("正在保存…", "Saving…");
  try {
    const { data, error } = await client.rpc("save_review_planner", {
      p_request_id: operation.requestId,
      p_expected_revision: operation.revision,
      p_document: operation.document,
      p_plan: operation.plan,
      p_completion: operation.completion,
    });
    if (ticket !== epoch) return;
    if (error) {
      if (error.code === "40001")
        say(
          "其他设备已修改数据，未覆盖云端内容。本页输入已保留，可先下载备份，再重新加载。",
          "Another device changed the data; nothing was overwritten. Download a backup of your input before reloading.",
          true,
        );
      else
        say(
          "保存未确认，输入已保留。请点击重试保存。",
          "Save unconfirmed. Your input is kept; choose Retry save.",
          true,
        );
      return;
    }
    state = data as PlannerState;
    pending = null;
    persistPending();
    preview = null;
    edit = null;
    say("已保存到云端。", "Saved to the cloud.");
  } catch {
    if (ticket === epoch)
      say(
        "网络连接失败，输入已保留。请重试保存。",
        "Connection failed. Your input is kept; retry the save.",
        true,
      );
  } finally {
    if (ticket === epoch) {
      busy = false;
      render();
    }
  }
}
async function save(
  doc: PlannerDocument,
  plan: Plan | null = null,
  completion: Pending["completion"] = null,
) {
  if (pending || busy) return;
  const issues = validateDocument(doc);
  if (issues.length) {
    say(
      issues.map((e) => e.zh).join("\n"),
      issues.map((e) => e.en).join("\n"),
      true,
    );
    return;
  }
  pending = {
    requestId: crypto.randomUUID(),
    revision: state.revision,
    document: doc,
    plan,
    completion,
  };
  state.document = doc;
  preview = null;
  persistPending();
  await sendPending();
}
function selectedId(kind: string) {
  return edit?.kind === kind ? edit.id : crypto.randomUUID();
}
root.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target as HTMLFormElement;
  if (!form.dataset.form || pending || busy) return;
  const f = new FormData(form),
    val = (k: string) => String(f.get(k) ?? "").trim(),
    num = (k: string) => Number(val(k));
  const doc = structuredClone(state.document);
  const put = <T extends { id: string }>(rows: T[], item: T) => {
    const at = rows.findIndex((r) => r.id === item.id);
    if (at < 0) rows.push(item);
    else rows[at] = item;
  };
  const kind = form.dataset.form;
  if (kind === "settings")
    Object.assign(doc.settings, {
      timezone: val("timezone"),
      semesterStart: val("semesterStart"),
      semesterEnd: val("semesterEnd"),
      planStart: val("planStart"),
      sessionMinutes: num("sessionMinutes"),
      breakMinutes: num("breakMinutes"),
      semesterConfirmed: true,
    });
  if (kind === "limits")
    Object.assign(doc.settings, {
      dailyLimits: Array.from({ length: 7 }, (_, i) => num(`limit-${i}`)),
      availabilityConfirmed: f.has("confirmed"),
    });
  if (kind === "course")
    put(doc.courses, {
      id: selectedId(kind),
      subject: val("subject"),
      weekday: num("weekday"),
      start: val("start"),
      end: val("end"),
      weeks: val("weeks"),
      parity: val("parity") as "all",
    });
  if (kind === "adjustment")
    put(doc.adjustments, {
      id: selectedId(kind),
      kind: val("kind") as "cancel",
      date: val("date"),
      courseId: val("courseId"),
      subject: val("subject"),
      start: val("start"),
      end: val("end"),
    });
  if (kind === "exam") {
    const id = selectedId(kind),
      old = doc.exams.find((e) => e.id === id);
    if (old && (old.scope !== val("scope") || old.subject !== val("subject")))
      doc.tasks
        .filter((t) => t.examId === id)
        .forEach((t) => {
          t.confirmed = false;
        });
    put(doc.exams, {
      id,
      subject: val("subject"),
      title: val("title"),
      start: val("start"),
      end: val("end"),
      scope: val("scope"),
      mastery: val("mastery") as "normal",
    });
  }
  if (kind === "task") {
    const id = selectedId(kind);
    if (num("minutes") < completedMinutes(state.completions, id)) {
      say(
        "预计用时不能少于已完成用时。",
        "The estimate cannot be less than completed work.",
        true,
      );
      return;
    }
    put(doc.tasks, {
      id,
      examId: val("examId"),
      title: val("title"),
      content: val("content"),
      phase: val("phase") as Phase,
      order: num("order"),
      minutes: num("minutes"),
      confirmed: f.has("confirmed"),
    });
  }
  if (kind === "window") {
    put(doc.windows, {
      id: selectedId(kind),
      weekday: num("weekday"),
      start: val("start"),
      end: val("end"),
    });
    doc.settings.availabilityConfirmed = false;
  }
  if (kind === "exception")
    put(doc.exceptions, {
      id: selectedId(kind),
      title: val("title"),
      date: val("date"),
      start: val("start"),
      end: val("end"),
    });
  if (kind === "import" && importRows) {
    try {
      importRows = validateImportRows([
        templateHeaders,
        ...importRows.map((_, i) =>
          templateHeaders.map((_, j) => val(`cell-${i}-${j}`)),
        ),
      ]);
    } catch {
      say("模板格式无效。", "Invalid template format.", true);
      return;
    }
    if (importRows.some((r) => r.issues.length) || !importRows.length) {
      render();
      say(
        "请修正预览中所有错误后再确认导入。",
        "Correct all errors in the preview before confirming.",
        true,
      );
      return;
    }
    const signature = (c: (typeof doc.courses)[number]) =>
      JSON.stringify([c.subject, c.weekday, c.start, c.end, c.weeks, c.parity]);
    const existing = new Set(doc.courses.map(signature));
    for (const row of importRows)
      if (row.course && !existing.has(signature(row.course))) {
        doc.courses.push(row.course);
        existing.add(signature(row.course));
      }
    importRows = null;
  }
  if (kind === "ai-draft" && aiDraft) {
    const examId = aiDraft.examId;
    const tasks = aiDraft.tasks.flatMap((_, i) =>
      f.has(`remove-${i}`)
        ? []
        : [
            {
              id: crypto.randomUUID(),
              examId,
              title: val(`title-${i}`),
              content: val(`content-${i}`),
              phase: val(`phase-${i}`) as Phase,
              order: num(`order-${i}`),
              minutes: num(`minutes-${i}`),
              confirmed: true,
            },
          ],
    );
    if (!tasks.length) {
      say("请至少保留一项任务。", "Keep at least one task.", true);
      return;
    }
    if (val("mode") === "replace")
      doc.tasks = doc.tasks.filter(
        (t) =>
          t.examId !== examId || completedMinutes(state.completions, t.id) > 0,
      );
    doc.tasks.push(...tasks);
    if (validateDocument(doc).length) {
      say("请检查任务内容与用时。", "Check task content and duration.", true);
      return;
    }
    aiDraft = null;
  }
  void save(doc);
});

root.addEventListener("click", async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "button",
  );
  if (!button || busy) return;
  if (button.dataset.tab) {
    tab = button.dataset.tab;
    edit = null;
    render();
    return;
  }
  const name = button.dataset.action,
    id = button.dataset.id ?? "";
  if (!name) return;
  if (name === "signout") {
    await client?.auth.signOut();
    return;
  }
  if (name === "backup") {
    download(
      JSON.stringify(
        {
          document: state.document,
          completions: state.completions,
          pending,
          exportedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "review-planner-backup.json",
      "application/json",
    );
    return;
  }
  if (name === "retry") {
    await sendPending();
    return;
  }
  if (name === "reload") {
    if (
      (pending || preview || aiDraft || edit) &&
      !confirm(
        tr(
          "重新加载会丢弃尚未保存的本页输入。需要时请先下载输入备份。继续？",
          "Reload discards unsaved input on this page. Download a backup first if needed. Continue?",
        ),
      )
    )
      return;
    pending = null;
    persistPending();
    preview = null;
    aiDraft = null;
    edit = null;
    importRows = null;
    await load();
    return;
  }
  if (pending || !loaded) return;
  if (name === "cancel-edit") {
    edit = null;
    render();
    return;
  }
  if (name === "cancel-import") {
    importRows = null;
    render();
    return;
  }
  if (name === "cancel-ai") {
    aiDraft = null;
    render();
    return;
  }
  if (name === "cancel-plan") {
    preview = null;
    render();
    return;
  }
  if (name === "previous-week" || name === "next-week" || name === "today") {
    weekDate =
      name === "today"
        ? today(state.document.settings.timezone)
        : addDays(weekDate, name === "next-week" ? 7 : -7);
    render();
    return;
  }
  if (name === "template-csv") {
    download(csvTemplate(), "review-timetable.csv", "text/csv;charset=utf-8");
    return;
  }
  if (name === "template-xlsx") {
    try {
      download(
        await excelTemplate(),
        "review-timetable.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
    } catch {
      say("模板下载失败，请重试。", "Template download failed. Retry.", true);
    }
    return;
  }
  if (name.startsWith("edit-")) {
    edit = { kind: name.slice(5), id };
    render();
    root
      .querySelector(`form[data-form="${edit.kind}"]`)
      ?.scrollIntoView({ behavior: "instant", block: "center" });
    return;
  }
  if (name.startsWith("delete-")) {
    if (
      !confirm(
        tr(
          "删除这项记录？已完成的复习记录会保留。",
          "Delete this record? Completed study history will be kept.",
        ),
      )
    )
      return;
    const doc = structuredClone(state.document),
      kind = name.slice(7);
    const keys = {
      course: "courses",
      adjustment: "adjustments",
      exam: "exams",
      task: "tasks",
      window: "windows",
      exception: "exceptions",
    } as const;
    const k = keys[kind as keyof typeof keys];
    if (!k) return;
    if (kind === "course") {
      const subject = doc.courses.find((c) => c.id === id)?.subject;
      if (
        doc.exams.some((e) => e.subject === subject) &&
        !doc.courses.some((c) => c.id !== id && c.subject === subject)
      ) {
        say(
          "该科目仍有关联考试，请先修改或删除考试。",
          "This subject has exams. Update or remove them first.",
          true,
        );
        return;
      }
      doc.adjustments = doc.adjustments.filter((a) => a.courseId !== id);
    }
    if (kind === "exam") doc.tasks = doc.tasks.filter((t) => t.examId !== id);
    (doc[k] as { id: string }[]) = doc[k].filter((r) => r.id !== id);
    if (kind === "window") doc.settings.availabilityConfirmed = false;
    await save(doc);
    return;
  }
  if (name === "confirm-task") {
    const doc = structuredClone(state.document);
    doc.tasks.find((t) => t.id === id)!.confirmed = true;
    await save(doc);
    return;
  }
  if (name === "generate") {
    try {
      preview = generatePlan(state.document, state.completions);
      weekDate = [
        state.document.settings.planStart,
        today(state.document.settings.timezone),
      ]
        .sort()
        .at(-1)!;
      render();
      say(
        "新计划仅为预览，确认后才会替换当前计划。",
        "This is a preview. Confirm to replace the current plan.",
      );
    } catch (error) {
      const issues = validateDocument(state.document, true);
      say(
        issues.length
          ? issues.map((e) => e.zh).join("\n")
          : "生成失败，请检查课程时间是否落在夏令时切换等无效时刻。",
        issues.length
          ? issues.map((e) => e.en).join("\n")
          : "Generation failed. Check for ambiguous or nonexistent daylight-saving times.",
        true,
      );
    }
    return;
  }
  if (name === "confirm-plan" && preview) {
    await save(state.document, preview);
    return;
  }
  if (name === "ai" && client) {
    if (
      aiDraft &&
      !confirm(
        tr(
          "替换当前尚未确认的 AI 草稿？",
          "Replace the current unconfirmed AI draft?",
        ),
      )
    )
      return;
    const ticket = epoch;
    busy = true;
    render();
    say(
      "正在拆分考试范围，可能需要片刻…",
      "Suggesting tasks from the exam scope. This can take a moment…",
    );
    try {
      const { data, error } = await client.functions.invoke(
        "review-task-breakdown",
        {
          body: { examId: id, expectedRevision: state.revision },
          timeout: 100_000,
        },
      );
      if (ticket !== epoch) return;
      if (error || data?.error) {
        let code = data?.error;
        if (error && "context" in error && error.context instanceof Response) {
          try {
            code = (await error.context.json()).error;
          } catch {
            /* Generic error below. */
          }
        }
        const errors: Record<string, [string, string]> = {
          ai_not_configured: [
            "AI 服务尚未配置密钥，可先手动添加任务。",
            "AI credentials are not configured. You can add tasks manually.",
          ],
          ai_balance: [
            "AI 服务余额不足，可手动添加任务或充值后重试。",
            "AI service balance is insufficient. Add tasks manually or retry after topping up.",
          ],
          stale_revision: [
            "考试信息已在其他设备修改，请重新加载后再试。",
            "Exam information changed on another device. Reload before retrying.",
          ],
          ai_timeout: [
            "AI 调用超时，输入已保留，请主动重试。",
            "AI timed out. Your input is kept; retry when ready.",
          ],
        };
        const pair = errors[code] ?? [
          "AI 拆分失败，输入已保留，可重试或手动填写任务。",
          "AI suggestions failed. Your input is kept; retry or add tasks manually.",
        ];
        say(...pair, true);
        return;
      }
      aiDraft = { examId: id, ...parseTaskDraft(data) };
      say(
        "任务草稿已生成，请核对内容和用时后确认。",
        "Task draft ready. Check its content and estimated time before confirming.",
      );
    } catch {
      if (ticket === epoch)
        say(
          "AI 拆分失败，输入已保留，可重试或手动填写。",
          "AI suggestions failed. Your input is kept; retry or enter tasks manually.",
          true,
        );
    } finally {
      if (ticket === epoch) {
        busy = false;
        render();
      }
    }
  }
});
root.addEventListener("change", async (event) => {
  const field = event.target as HTMLInputElement;
  if (field.dataset.complete && !pending && !busy && state.plan) {
    await save(state.document, null, {
      sessionId: field.dataset.complete,
      completed: field.checked,
    });
    return;
  }
  if (
    !field.matches("[data-import-file]") ||
    !field.files?.length ||
    pending ||
    busy
  )
    return;
  const file = field.files[0],
    ticket = epoch;
  if (file.size > 2 * 1024 * 1024) {
    say(
      "课表文件不能超过 2 MB。",
      "Timetable files must be no larger than 2 MB.",
      true,
    );
    return;
  }
  busy = true;
  try {
    const rows = /\.csv$/i.test(file.name)
      ? parseCsv(await file.text())
      : /\.xlsx$/i.test(file.name)
        ? await parseWorkbook(await file.arrayBuffer())
        : null;
    if (ticket !== epoch) return;
    if (!rows?.length) throw new Error();
    importRows = rows;
    say(
      "请检查导入预览；确认后才会保存。",
      "Review the import preview. Nothing is saved until you confirm.",
    );
  } catch {
    if (ticket === epoch)
      say(
        "无法读取课表，请使用下载的 CSV 或 Excel 模板，保留首行列名且不超过 500 行。",
        "Cannot read the timetable. Use the downloaded CSV or Excel template with its headers and at most 500 rows.",
        true,
      );
  } finally {
    if (ticket === epoch) {
      busy = false;
      render();
    }
  }
});
document
  .querySelector<HTMLFormElement>("[data-planner-login-form]")!
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!client || busy) return;
    const form = event.target as HTMLFormElement;
    const email = String(new FormData(form).get("email")).trim().toLowerCase();
    if (email !== allowedEmail) {
      say("此邮箱没有使用权限。", "This email is not authorized.", true);
      return;
    }
    busy = true;
    const button = form.querySelector("button")!;
    button.disabled = true;
    try {
      rememberPlannerReturn(localStorage);
    } catch {
      /* The existing vocabulary callback still signs the user in. */
    }
    const { error } = await client.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${location.origin}/vocabulary/`,
      },
    });
    busy = false;
    button.disabled = false;
    if (error)
      say(
        "登录链接发送失败，请检查邮件服务后重试。",
        "Sign-in link could not be sent. Check email delivery and retry.",
        true,
      );
    else
      say(
        "登录链接已发送，请查收邮箱。",
        "Sign-in link sent. Check your inbox.",
      );
  });
async function showSession(session: AuthSession | null) {
  const next =
    session?.user.email?.toLowerCase() === allowedEmail
      ? session.user.id
      : null;
  if (next === owner && (loaded || busy)) return;
  epoch++;
  owner = next;
  pending = null;
  preview = null;
  aiDraft = null;
  importRows = null;
  edit = null;
  busy = false;
  loaded = false;
  root.replaceChildren();
  root.hidden = !owner;
  login.hidden = Boolean(owner);
  state = {
    revision: 0,
    document: defaultDocument(),
    plan: null,
    completions: [],
  };
  say("", "");
  if (!owner) {
    if (session) await client?.auth.signOut();
    return;
  }
  try {
    const saved = sessionStorage.getItem(key());
    if (saved) pending = JSON.parse(saved) as Pending;
  } catch {
    /* Optional recovery. */
  }
  await load();
}
document.addEventListener("ui-language-change", () => {
  const drafts = [
    ...root.querySelectorAll<HTMLFormElement>("form[data-form]"),
  ].map((form) => ({
    kind: form.dataset.form,
    fields: [
      ...form.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >("input[name],select[name],textarea[name]"),
    ]
      .filter((el) => !(el instanceof HTMLInputElement && el.type === "file"))
      .map((el) => ({
        name: el.name,
        value: el.value,
        checked: el instanceof HTMLInputElement ? el.checked : false,
      })),
  }));
  status.textContent = tr(...message);
  status.dataset.error = String(messageError);
  render();
  for (const draft of drafts) {
    const form = root.querySelector<HTMLFormElement>(
      `form[data-form="${draft.kind}"]`,
    );
    for (const field of draft.fields) {
      const element = form?.elements.namedItem(field.name);
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement
      ) {
        element.value = field.value;
        if (element instanceof HTMLInputElement)
          element.checked = field.checked;
      }
    }
  }
});
window.addEventListener("beforeunload", (event) => {
  if (pending || aiDraft || preview || edit) event.preventDefault();
});
const url = import.meta.env.PUBLIC_SUPABASE_URL,
  apiKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
if (!url || !apiKey)
  document.querySelector<HTMLElement>("[data-planner-config]")!.hidden = false;
else {
  client = createClient(url, apiKey);
  client.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => void showSession(session), 0);
  });
  void client.auth.getSession().then(({ data, error }) => {
    if (error)
      say(
        "登录状态加载失败，请刷新重试。",
        "Could not load sign-in status. Reload to retry.",
        true,
      );
    else void showSession(data.session);
  });
}
