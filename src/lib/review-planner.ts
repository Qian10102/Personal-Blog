import { Temporal } from "@js-temporal/polyfill";

export type Phase = "learn" | "practice" | "recap";
export type Course = {
  id: string;
  subject: string;
  weekday: number;
  start: string;
  end: string;
  weeks: string;
  parity: "all" | "odd" | "even";
};
export type Adjustment = {
  id: string;
  kind: "cancel" | "makeup";
  date: string;
  courseId: string;
  subject: string;
  start: string;
  end: string;
};
export type Exam = {
  id: string;
  subject: string;
  title: string;
  start: string;
  end: string;
  scope: string;
  mastery: "weak" | "normal" | "strong";
};
export type Task = {
  id: string;
  examId: string;
  title: string;
  content: string;
  phase: Phase;
  order: number;
  minutes: number;
  confirmed: boolean;
};
export type Window = {
  id: string;
  weekday: number;
  start: string;
  end: string;
};
export type Exception = {
  id: string;
  date: string;
  start: string;
  end: string;
  title: string;
};
export type Settings = {
  timezone: string;
  semesterStart: string;
  semesterEnd: string;
  planStart: string;
  sessionMinutes: number;
  breakMinutes: number;
  dailyLimits: number[];
  availabilityConfirmed: boolean;
  semesterConfirmed: boolean;
};
export type PlannerDocument = {
  settings: Settings;
  courses: Course[];
  adjustments: Adjustment[];
  exams: Exam[];
  tasks: Task[];
  windows: Window[];
  exceptions: Exception[];
};
export type Session = {
  id: string;
  taskId: string;
  examId: string;
  subject: string;
  title: string;
  content: string;
  phase: Phase;
  start: string;
  end: string;
  minutes: number;
};
export type Completion = { session: Session; completedAt: string };
export type Gap = {
  taskId: string;
  examId: string;
  title: string;
  requiredMinutes: number;
  unscheduledMinutes: number;
  availableMinutes: number;
};
export type Plan = {
  id: string;
  generatedAt: string;
  document: PlannerDocument;
  sessions: Session[];
  gaps: Gap[];
  availableMinutes: number;
};
export type PlannerState = {
  revision: number;
  document: PlannerDocument;
  plan: Plan | null;
  completions: Completion[];
};
export type Issue = { zh: string; en: string };
export type Block = {
  start: number;
  end: number;
  kind: "course" | "exam" | "exception" | "completed";
  title: string;
  id: string;
};
const minute = 60_000;
export const phases: Phase[] = ["learn", "practice", "recap"];

export function today(timezone: string, now = Date.now()): string {
  return Temporal.Instant.fromEpochMilliseconds(now)
    .toZonedDateTimeISO(timezone)
    .toPlainDate()
    .toString();
}
export function addDays(date: string, count: number): string {
  return Temporal.PlainDate.from(date).add({ days: count }).toString();
}
export function weekday(date: string): number {
  return Temporal.PlainDate.from(date).dayOfWeek;
}
export function localInstant(local: string, timezone: string): number {
  // Reject ambiguous/nonexistent clock readings rather than silently moving a lesson.
  return Temporal.PlainDateTime.from(local).toZonedDateTime(timezone, {
    disambiguation: "reject",
  }).epochMilliseconds;
}
export function localDateTime(iso: string, timezone: string): string {
  return Temporal.Instant.from(iso)
    .toZonedDateTimeISO(timezone)
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" });
}
export function defaultDocument(
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "Asia/Shanghai",
  now = Date.now(),
): PlannerDocument {
  const date = today(timezone, now);
  const monday = addDays(date, 1 - weekday(date));
  return {
    settings: {
      timezone,
      semesterStart: monday,
      semesterEnd: addDays(monday, 125),
      planStart: date,
      sessionMinutes: 50,
      breakMinutes: 10,
      dailyLimits: [180, 180, 180, 180, 180, 180, 180],
      availabilityConfirmed: false,
      semesterConfirmed: false,
    },
    courses: [],
    adjustments: [],
    exams: [],
    tasks: [],
    windows: [],
    exceptions: [],
  };
}
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function needsReplan(state: PlannerState): boolean {
  return Boolean(
    state.plan &&
    stableStringify(state.document) !== stableStringify(state.plan.document),
  );
}
export function parseWeeks(expression: string): Set<number> {
  const result = new Set<number>();
  if (!/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(expression))
    throw new Error("weeks");
  for (const part of expression.split(",")) {
    const [a, b = a] = part.split("-").map(Number);
    if (a < 1 || b > 53 || b < a) throw new Error("weeks");
    for (let week = a; week <= b; week++) result.add(week);
  }
  return result;
}
export function validTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}
export function validDate(value: string): boolean {
  try {
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Temporal.PlainDate.from(value).toString() === value
    );
  } catch {
    return false;
  }
}
export function validateDocument(
  doc: PlannerDocument,
  forGeneration = false,
): Issue[] {
  const issues: Issue[] = [];
  const issue = (zh: string, en: string) => issues.push({ zh, en });
  const s = doc.settings;
  try {
    today(s.timezone);
  } catch {
    issue("时区无效，请填写 IANA 时区名称。", "Enter a valid IANA time zone.");
  }
  if (![s.semesterStart, s.semesterEnd, s.planStart].every(validDate))
    issue(
      "请填写有效的学期与计划日期。",
      "Enter valid semester and plan dates.",
    );
  else if (
    weekday(s.semesterStart) !== 1 ||
    s.semesterEnd < s.semesterStart ||
    Temporal.PlainDate.from(s.semesterStart).until(
      Temporal.PlainDate.from(s.semesterEnd),
    ).days > 365
  )
    issue(
      "学期第一周须从星期一开始，学期长度不超过一年。",
      "Week one must start on Monday; the semester may span at most one year.",
    );
  if (
    !Number.isInteger(s.sessionMinutes) ||
    s.sessionMinutes < 25 ||
    s.sessionMinutes > 180 ||
    s.sessionMinutes % 25 !== 0 ||
    !Number.isInteger(s.breakMinutes) ||
    s.breakMinutes < 0 ||
    s.breakMinutes > 120
  )
    issue(
      "复习时长须为 25 的倍数（25–175 分钟），休息须为 0–120 分钟。",
      "Sessions must be a multiple of 25 (25–175 minutes); breaks must be 0–120 minutes.",
    );
  if (
    s.dailyLimits.length !== 7 ||
    s.dailyLimits.some((v) => !Number.isInteger(v) || v < 0 || v > 1440)
  )
    issue(
      "请为每周七天填写每日上限（0–1440 分钟）。",
      "Set seven daily limits between 0 and 1440 minutes.",
    );
  const ids = [
    ...doc.courses,
    ...doc.adjustments,
    ...doc.exams,
    ...doc.tasks,
    ...doc.windows,
    ...doc.exceptions,
  ].map((v) => v.id);
  if (new Set(ids).size !== ids.length)
    issue(
      "存在重复记录，请重新载入后重试。",
      "Duplicate record identifiers. Reload and try again.",
    );
  for (const c of doc.courses) {
    try {
      parseWeeks(c.weeks);
    } catch {
      issue(
        `「${c.subject}」周次无效，示例：1-8,10-16。`,
        `Invalid weeks for “${c.subject}”. Example: 1-8,10-16.`,
      );
    }
    if (
      !c.subject.trim() ||
      c.subject.length > 120 ||
      !Number.isInteger(c.weekday) ||
      c.weekday < 1 ||
      c.weekday > 7 ||
      !validTime(c.start) ||
      !validTime(c.end) ||
      c.end <= c.start ||
      !["all", "odd", "even"].includes(c.parity)
    )
      issue(
        `「${c.subject}」课程信息无效。`,
        `Invalid course: “${c.subject}”.`,
      );
  }
  for (const a of doc.adjustments) {
    if (
      !validDate(a.date) ||
      a.date < s.semesterStart ||
      a.date > s.semesterEnd ||
      (a.kind === "cancel"
        ? !doc.courses.some((c) => c.id === a.courseId)
        : a.kind !== "makeup" ||
          !a.subject.trim() ||
          !validTime(a.start) ||
          !validTime(a.end) ||
          a.end <= a.start)
    )
      issue(
        "调课日期或课程信息无效。",
        "Invalid cancellation or makeup lesson.",
      );
  }
  const subjects = new Set(doc.courses.map((c) => c.subject));
  for (const exam of doc.exams) {
    try {
      if (
        !subjects.has(exam.subject) ||
        !exam.title.trim() ||
        !exam.scope.trim() ||
        exam.scope.length > 12000 ||
        !["weak", "normal", "strong"].includes(exam.mastery) ||
        localInstant(exam.end, s.timezone) <=
          localInstant(exam.start, s.timezone)
      )
        throw new Error();
      const date = exam.start.slice(0, 10);
      if (
        forGeneration &&
        Temporal.PlainDate.from(s.planStart).until(
          Temporal.PlainDate.from(date),
        ).days > 365
      )
        issue(
          `「${exam.title}」不能晚于计划开始日一年以上。`,
          `“${exam.title}” must be no later than one year after the plan start.`,
        );
    } catch {
      issue(
        `「${exam.title}」考试科目、时间或范围无效；夏令时切换时刻请选用无歧义的时间。`,
        `Invalid subject, scope, or time for “${exam.title}”; choose an unambiguous daylight-saving time.`,
      );
    }
  }
  for (const task of doc.tasks)
    if (
      !doc.exams.some((e) => e.id === task.examId) ||
      !task.title.trim() ||
      !task.content.trim() ||
      !phases.includes(task.phase) ||
      !Number.isInteger(task.order) ||
      task.order < 1 ||
      !Number.isInteger(task.minutes) ||
      task.minutes < 25 ||
      task.minutes > 6000 ||
      task.minutes % 25 !== 0
    )
      issue(
        "任务须关联考试、填写内容，并按 25 分钟单位估算用时。",
        "Tasks need an exam, title, content, order, and a duration in 25-minute units (up to 6000).",
      );
  for (const w of doc.windows)
    if (
      !Number.isInteger(w.weekday) ||
      w.weekday < 1 ||
      w.weekday > 7 ||
      !validTime(w.start) ||
      !validTime(w.end) ||
      w.end <= w.start
    )
      issue("每周可用时段无效。", "Invalid weekly availability window.");
  for (const e of doc.exceptions)
    if (
      !validDate(e.date) ||
      !validTime(e.start) ||
      !validTime(e.end) ||
      e.end <= e.start
    )
      issue(
        "临时占用的日期或时间无效。",
        "Invalid date or time for a blocked period.",
      );
  if (forGeneration) {
    if (!s.semesterConfirmed)
      issue(
        "请先保存并确认学期、时区和计划开始日。",
        "Save and confirm your semester, time zone, and plan start first.",
      );
    if (!s.availabilityConfirmed || !doc.windows.length)
      issue(
        "请先确认可用时段及每日上限。",
        "Confirm your availability and daily limits first.",
      );
    if (
      !doc.exams.length ||
      !doc.tasks.length ||
      doc.exams.some((e) => !doc.tasks.some((t) => t.examId === e.id))
    )
      issue(
        "每场考试至少需要一项复习任务。",
        "Add at least one task for each exam.",
      );
    if (doc.tasks.some((t) => !t.confirmed))
      issue(
        "请确认全部复习任务后再生成计划。",
        "Confirm all tasks before generating a plan.",
      );
  }
  return issues;
}

export function blocksForDate(
  doc: PlannerDocument,
  date: string,
  completions: Completion[] = [],
): Block[] {
  const { timezone, semesterStart, semesterEnd } = doc.settings;
  const start = localInstant(`${date}T00:00`, timezone),
    end = localInstant(`${addDays(date, 1)}T00:00`, timezone);
  const blocks: Block[] = [];
  const add = (
    a: number,
    b: number,
    kind: Block["kind"],
    title: string,
    id: string,
  ) => {
    if (b > start && a < end)
      blocks.push({
        start: Math.max(start, a),
        end: Math.min(end, b),
        kind,
        title,
        id,
      });
  };
  if (date >= semesterStart && date <= semesterEnd) {
    const week =
      Math.floor(
        Temporal.PlainDate.from(semesterStart).until(
          Temporal.PlainDate.from(date),
        ).days / 7,
      ) + 1;
    for (const c of doc.courses) {
      if (
        c.weekday !== weekday(date) ||
        !parseWeeks(c.weeks).has(week) ||
        (c.parity === "odd" && week % 2 === 0) ||
        (c.parity === "even" && week % 2 !== 0) ||
        doc.adjustments.some(
          (a) => a.kind === "cancel" && a.courseId === c.id && a.date === date,
        )
      )
        continue;
      add(
        localInstant(`${date}T${c.start}`, timezone),
        localInstant(`${date}T${c.end}`, timezone),
        "course",
        c.subject,
        c.id,
      );
    }
    for (const a of doc.adjustments.filter(
      (a) => a.date === date && a.kind === "makeup",
    ))
      add(
        localInstant(`${date}T${a.start}`, timezone),
        localInstant(`${date}T${a.end}`, timezone),
        "course",
        a.subject,
        a.id,
      );
  }
  for (const e of doc.exams)
    add(
      localInstant(e.start, timezone),
      localInstant(e.end, timezone),
      "exam",
      e.title,
      e.id,
    );
  for (const e of doc.exceptions.filter((e) => e.date === date))
    add(
      localInstant(`${date}T${e.start}`, timezone),
      localInstant(`${date}T${e.end}`, timezone),
      "exception",
      e.title,
      e.id,
    );
  for (const c of completions)
    add(
      Date.parse(c.session.start),
      Date.parse(c.session.end),
      "completed",
      c.session.title,
      c.session.id,
    );
  return blocks.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}
export function mergeIntervals(
  intervals: [number, number][],
): [number, number][] {
  const result: [number, number][] = [];
  for (const [a, b] of [...intervals].sort((a, b) => a[0] - b[0])) {
    if (a >= b) continue;
    const last = result.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else result.push([a, b]);
  }
  return result;
}
export function freeIntervals(
  doc: PlannerDocument,
  date: string,
  completions: Completion[],
  now: number,
): [number, number][] {
  const tz = doc.settings.timezone;
  const blocked = blocksForDate(doc, date, completions).map(
    (b) => [b.start, b.end] as [number, number],
  );
  // Completed future sessions also reserve their following rest period.
  for (const c of completions)
    blocked.push([
      Date.parse(c.session.start),
      Date.parse(c.session.end) + doc.settings.breakMinutes * minute,
    ]);
  let free = mergeIntervals(
    doc.windows
      .filter((w) => w.weekday === weekday(date))
      .map((w) => [
        Math.max(now, localInstant(`${date}T${w.start}`, tz)),
        localInstant(`${date}T${w.end}`, tz),
      ]),
  );
  for (const [a, b] of mergeIntervals(blocked))
    free = free.flatMap(([x, y]) =>
      b <= x || a >= y
        ? [[x, y] as [number, number]]
        : ([
            [x, Math.min(a, y)],
            [Math.max(b, x), y],
          ].filter(([p, q]) => p < q) as [number, number][]),
    );
  return free;
}
export function completedMinutes(
  completions: Completion[],
  taskId: string,
): number {
  return completions
    .filter((c) => c.session.taskId === taskId)
    .reduce((n, c) => n + c.session.minutes, 0);
}
export function generatePlan(
  doc: PlannerDocument,
  completions: Completion[] = [],
  now = Date.now(),
): Plan {
  const errors = validateDocument(doc, true);
  if (errors.length) throw new Error(errors.map((e) => e.zh).join("\n"));
  const tz = doc.settings.timezone;
  const firstDate = [doc.settings.planStart, today(tz, now)].sort().at(-1)!;
  const lastDate = doc.exams
    .map((e) => e.start.slice(0, 10))
    .sort()
    .at(-1)!;
  const tasks = [...doc.tasks].sort(
    (a, b) =>
      a.order - b.order ||
      phases.indexOf(a.phase) - phases.indexOf(b.phase) ||
      a.id.localeCompare(b.id),
  );
  const remaining = new Map(
    tasks.map((t) => [
      t.id,
      Math.max(0, t.minutes - completedMinutes(completions, t.id)),
    ]),
  );
  const exams = new Map(doc.exams.map((e) => [e.id, e]));
  const cutoff = (t: Task) =>
    localInstant(
      `${addDays(exams.get(t.examId)!.start.slice(0, 10), t.phase === "recap" ? 0 : -1)}T00:00`,
      tz,
    );
  const release = (t: Task) =>
    t.phase === "recap"
      ? localInstant(
          `${addDays(exams.get(t.examId)!.start.slice(0, 10), -1)}T00:00`,
          tz,
        )
      : -Infinity;
  const days: { date: string; free: [number, number][]; cap: number }[] = [];
  for (let date = firstDate; date <= lastDate; date = addDays(date, 1)) {
    const spent = completions
      .filter((c) => localDateTime(c.session.start, tz).startsWith(date))
      .reduce((n, c) => n + c.session.minutes, 0);
    days.push({
      date,
      free: freeIntervals(doc, date, completions, now),
      cap: Math.max(0, doc.settings.dailyLimits[weekday(date) - 1] - spent),
    });
  }
  const capacity = (task: Task, from: number, currentDay: number) =>
    days.slice(currentDay).reduce(
      (sum, d) =>
        sum +
        Math.min(
          d.cap,
          d.free.reduce(
            (n, [a, b]) =>
              n +
              Math.floor(
                Math.max(
                  0,
                  Math.min(b, cutoff(task)) - Math.max(a, from, release(task)),
                ) /
                  minute /
                  25,
              ) *
                25,
            0,
          ),
        ),
      0,
    );
  const availableMinutes = days.reduce(
    (n, d) =>
      n +
      Math.min(
        d.cap,
        d.free.reduce(
          (sum, [a, b]) => sum + Math.floor((b - a) / minute / 25) * 25,
          0,
        ),
      ),
    0,
  );
  const sessions: Session[] = completions.map((c) =>
    structuredClone(c.session),
  );
  let nextStart = -Infinity;
  for (let di = 0; di < days.length; di++) {
    const day = days[di];
    for (const [a, b] of day.free) {
      let cursor = Math.max(a, nextStart);
      cursor = Math.ceil(cursor / minute) * minute;
      while (cursor + 25 * minute <= b && day.cap >= 25) {
        const eligible = tasks.filter(
          (t) =>
            (remaining.get(t.id) ?? 0) >= 25 &&
            release(t) <= cursor &&
            cutoff(t) >= cursor + 25 * minute &&
            !tasks.some(
              (p) =>
                p.examId === t.examId &&
                ((t.phase === "recap" && p.phase !== "recap") ||
                  (p.phase === t.phase &&
                    (p.order < t.order ||
                      (p.order === t.order && p.id < t.id))) ||
                  (t.phase === "practice" && p.phase === "learn")) &&
                (remaining.get(p.id) ?? 0) > 0,
            ),
        );
        if (!eligible.length) break;
        const score = (t: Task) => {
          const pending = tasks
            .filter(
              (p) =>
                p.examId === t.examId &&
                (p.phase === "recap") === (t.phase === "recap"),
            )
            .reduce((n, p) => n + (remaining.get(p.id) ?? 0), 0);
          return (
            (pending *
              { weak: 1.5, normal: 1, strong: 0.75 }[
                exams.get(t.examId)!.mastery
              ]) /
            Math.max(25, capacity(t, cursor, di))
          );
        };
        eligible.sort(
          (x, y) =>
            score(y) - score(x) ||
            cutoff(x) - cutoff(y) ||
            x.id.localeCompare(y.id),
        );
        const task = eligible[0];
        const minutes = Math.min(
          doc.settings.sessionMinutes,
          remaining.get(task.id)!,
          day.cap,
          Math.floor((Math.min(b, cutoff(task)) - cursor) / minute / 25) * 25,
        );
        const start = new Date(cursor).toISOString(),
          end = new Date(cursor + minutes * minute).toISOString();
        sessions.push({
          id: `${task.id}:${start}`,
          taskId: task.id,
          examId: task.examId,
          subject: exams.get(task.examId)!.subject,
          title: task.title,
          content: task.content,
          phase: task.phase,
          start,
          end,
          minutes,
        });
        remaining.set(task.id, remaining.get(task.id)! - minutes);
        day.cap -= minutes;
        cursor += (minutes + doc.settings.breakMinutes) * minute;
        nextStart = cursor;
      }
    }
  }
  // Report genuinely unused clock time, excluding the newly allocated sessions.
  const allocated = sessions.map((session) => ({
    session,
    completedAt: session.end,
  }));
  for (const day of days)
    day.free = freeIntervals(doc, day.date, allocated, now);
  const gaps = tasks
    .filter((t) => (remaining.get(t.id) ?? 0) > 0)
    .map((t) => ({
      taskId: t.id,
      examId: t.examId,
      title: t.title,
      requiredMinutes: Math.max(
        0,
        t.minutes - completedMinutes(completions, t.id),
      ),
      unscheduledMinutes: remaining.get(t.id)!,
      availableMinutes: capacity(t, now, 0),
    }));
  return {
    id: crypto.randomUUID(),
    generatedAt: new Date(now).toISOString(),
    document: structuredClone(doc),
    sessions: sessions.sort(
      (a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id),
    ),
    gaps,
    availableMinutes,
  };
}

export { parseTaskDraft } from "../../supabase/functions/_shared/review-task-draft.ts";
