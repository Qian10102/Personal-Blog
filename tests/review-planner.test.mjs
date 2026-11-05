import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultDocument,
  parseWeeks,
  blocksForDate,
  generatePlan,
  localInstant,
  localDateTime,
  validateDocument,
  needsReplan,
  stableStringify,
} from "../src/lib/review-planner.ts";
const now = Date.parse("2026-11-02T00:00:00Z");
function fixture() {
  const doc = defaultDocument("UTC", now);
  Object.assign(doc.settings, {
    semesterStart: "2026-11-02",
    semesterEnd: "2027-02-28",
    planStart: "2026-11-02",
    availabilityConfirmed: true,
    semesterConfirmed: true,
  });
  doc.courses = [
    {
      id: "c1",
      subject: "数学",
      weekday: 1,
      start: "09:00",
      end: "10:00",
      weeks: "1-16",
      parity: "all",
    },
  ];
  doc.exams = [
    {
      id: "e1",
      subject: "数学",
      title: "数学期末",
      start: "2026-11-06T09:00",
      end: "2026-11-06T11:00",
      scope: "第一至三章",
      mastery: "normal",
    },
  ];
  doc.tasks = [
    {
      id: "t1",
      examId: "e1",
      title: "梳理",
      content: "梳理第一至三章",
      phase: "learn",
      order: 1,
      minutes: 100,
      confirmed: true,
    },
    {
      id: "t2",
      examId: "e1",
      title: "练习",
      content: "做练习",
      phase: "practice",
      order: 2,
      minutes: 50,
      confirmed: true,
    },
    {
      id: "t3",
      examId: "e1",
      title: "回顾",
      content: "回顾错题",
      phase: "recap",
      order: 3,
      minutes: 25,
      confirmed: true,
    },
  ];
  doc.windows = Array.from({ length: 7 }, (_, i) => ({
    id: `w${i}`,
    weekday: i + 1,
    start: "08:00",
    end: "12:00",
  }));
  return doc;
}
test("week parsing rejects malformed, reversed and out-of-range weeks", () => {
  assert.deepEqual([...parseWeeks("1-3,5,7-8")], [1, 2, 3, 5, 7, 8]);
  for (const v of ["", "0", "54", "3-1", "1-1000000", "1,", "1.5", "1 2"])
    assert.throws(() => parseWeeks(v));
});
test("semester weeks, odd/even classes, cancellations, makeup and semester boundaries", () => {
  const d = fixture();
  d.courses[0].parity = "odd";
  assert.equal(
    blocksForDate(d, "2026-11-02").filter((b) => b.kind === "course").length,
    1,
  );
  assert.equal(blocksForDate(d, "2026-11-09").length, 0);
  d.adjustments.push({
    id: "a1",
    kind: "cancel",
    date: "2026-11-02",
    courseId: "c1",
    subject: "",
    start: "",
    end: "",
  });
  assert.equal(blocksForDate(d, "2026-11-02").length, 0);
  d.adjustments.push({
    id: "a2",
    kind: "makeup",
    date: "2026-11-03",
    subject: "数学",
    courseId: "",
    start: "14:00",
    end: "16:00",
  });
  assert.equal(blocksForDate(d, "2026-11-03")[0].title, "数学");
  assert.equal(blocksForDate(d, "2026-10-26").length, 0);
  assert.equal(blocksForDate(d, "2027-03-01").length, 0);
});
test("schedule honors lessons, blockers, overlaps, daily limits and 50+10 rhythm", () => {
  const d = fixture();
  d.settings.dailyLimits = [75, 100, 100, 100, 100, 100, 100];
  d.exceptions = [
    {
      id: "x",
      date: "2026-11-02",
      start: "10:00",
      end: "11:00",
      title: "出行",
    },
  ];
  d.courses.push({ ...d.courses[0], id: "c2", start: "09:30", end: "10:30" });
  d.windows.push({ id: "overlap", weekday: 1, start: "08:30", end: "11:30" });
  const p = generatePlan(d, [], now);
  assert.equal(p.gaps.length, 0);
  for (const session of p.sessions) {
    assert.ok(
      session.minutes >= 25 &&
        session.minutes <= 50 &&
        session.minutes % 25 === 0,
    );
    for (const b of blocksForDate(d, session.start.slice(0, 10)))
      assert.ok(
        Date.parse(session.end) <= b.start ||
          Date.parse(session.start) >= b.end,
      );
  }
  for (let i = 1; i < p.sessions.length; i++)
    assert.ok(
      Date.parse(p.sessions[i].start) - Date.parse(p.sessions[i - 1].end) >=
        10 * 60000,
    );
  assert.ok(
    p.sessions
      .filter((s) => s.start.startsWith("2026-11-02"))
      .reduce((n, s) => n + s.minutes, 0) <= 75,
  );
  assert.ok(
    p.sessions.filter((s) => s.phase === "learn").at(-1).end <=
      p.sessions.find((s) => s.phase === "practice").start,
  );
  assert.ok(
    p.sessions
      .filter((s) => s.phase !== "recap")
      .every((s) => s.end <= "2026-11-05T00:00:00.000Z"),
  );
  assert.ok(
    p.sessions
      .filter((s) => s.phase === "recap")
      .every((s) => s.start.startsWith("2026-11-05")),
  );
});
test("past times are excluded and gaps expose every unallocated task without changing estimates", () => {
  const d = fixture();
  const snapshot = structuredClone(d);
  const p = generatePlan(d, [], Date.parse("2026-11-05T11:40:00Z"));
  assert.equal(p.sessions.length, 0);
  assert.equal(p.gaps.length, 3);
  assert.equal(
    p.gaps.reduce((n, g) => n + g.unscheduledMinutes, 0),
    175,
  );
  assert.deepEqual(d, snapshot);
});
test("replan keeps completed snapshots, deducts their minutes, and reschedules missed work", () => {
  const d = fixture(),
    first = generatePlan(d, [], now),
    session = first.sessions[0];
  const completions = [{ session, completedAt: session.end }];
  const second = generatePlan(
    d,
    completions,
    Date.parse("2026-11-03T08:00:00Z"),
  );
  assert.deepEqual(
    second.sessions.find((s) => s.id === session.id),
    session,
  );
  assert.equal(
    second.sessions
      .filter((s) => s.taskId === "t1")
      .reduce((n, s) => n + s.minutes, 0),
    100,
  );
  assert.ok(
    second.sessions
      .filter((s) => s.id !== session.id)
      .every((s) => s.start >= "2026-11-03T08:00:00.000Z"),
  );
  assert.equal(second.gaps.length, 0);
});
test("completed future sessions reserve their minutes and rest without being scheduled twice", () => {
  const d = fixture(),
    first = generatePlan(d, [], now),
    session = first.sessions[0];
  d.settings.dailyLimits[0] = 50;
  const p = generatePlan(
    d,
    [{ session, completedAt: new Date(now).toISOString() }],
    now,
  );
  assert.equal(
    p.sessions.filter((s) => s.start.startsWith("2026-11-02")).length,
    1,
  );
  assert.equal(p.sessions.filter((s) => s.id === session.id).length, 1);
});
test("multiple exams of one subject receive time and leave their own recap days", () => {
  const d = fixture();
  d.exams.push({
    ...d.exams[0],
    id: "e2",
    title: "第二次考试",
    start: "2026-11-09T09:00",
    end: "2026-11-09T10:00",
    mastery: "weak",
  });
  d.tasks.push(
    ...d.tasks
      .slice(0, 3)
      .map((t) => ({ ...t, id: `second-${t.id}`, examId: "e2" })),
  );
  const p = generatePlan(d, [], now);
  assert.equal(p.gaps.length, 0);
  assert.ok(p.sessions.some((s) => s.examId === "e2"));
  assert.ok(
    p.sessions
      .filter((s) => s.examId === "e2" && s.phase === "recap")
      .every((s) => s.start.startsWith("2026-11-08")),
  );
});
test("same inputs and clock yield stable sessions and gaps without mutating completion data", () => {
  const d = fixture(),
    first = generatePlan(d, [], now),
    second = generatePlan(d, [], now);
  assert.deepEqual(first.sessions, second.sessions);
  assert.deepEqual(first.gaps, second.gaps);
  assert.equal(
    stableStringify({ b: 1, a: [2, 3] }),
    stableStringify({ a: [2, 3], b: 1 }),
  );
  assert.equal(needsReplan({ document: d, plan: first }), false);
  d.tasks[0].minutes += 25;
  assert.equal(needsReplan({ document: d, plan: first }), true);
});
test("DST and time zones use local dates and reject ambiguous or nonexistent clock readings", () => {
  assert.equal(
    localInstant("2026-03-29T09:00", "Europe/Paris"),
    Date.parse("2026-03-29T07:00:00Z"),
  );
  assert.equal(
    localDateTime("2026-11-02T00:00:00Z", "Asia/Shanghai"),
    "2026-11-02T08:00",
  );
  assert.throws(() => localInstant("2026-03-29T02:30", "Europe/Paris"));
  assert.throws(() => localInstant("2026-10-25T02:30", "Europe/Paris"));
});
test("generation requires confirmed availability, confirmed tasks and a task for every exam", () => {
  const d = fixture();
  d.settings.availabilityConfirmed = false;
  assert.throws(() => generatePlan(d, [], now));
  d.settings.availabilityConfirmed = true;
  d.tasks[0].confirmed = false;
  assert.throws(() => generatePlan(d, [], now));
  d.tasks[0].confirmed = true;
  d.tasks[0].minutes = 12;
  assert.ok(validateDocument(d).length);
  d.tasks = [];
  assert.throws(() => generatePlan(d, [], now));
});
test("a later start keeps past exams as reported gaps rather than preventing future planning", () => {
  const d = fixture();
  d.settings.planStart = "2026-11-07";
  const p = generatePlan(d, [], Date.parse("2026-11-07T00:00:00Z"));
  assert.equal(p.sessions.length, 0);
  assert.equal(p.gaps.length, 3);
});
test("rest is enforced across midnight and reported capacity excludes allocated sessions", () => {
  const d = fixture();
  d.courses = [{ ...d.courses[0], start: "09:00", end: "10:00" }];
  d.windows = [
    { id: "late", weekday: 1, start: "23:00", end: "23:59" },
    { id: "early", weekday: 2, start: "00:00", end: "01:00" },
  ];
  d.settings.breakMinutes = 30;
  const p = generatePlan(d, [], now);
  assert.equal(p.sessions[0].end, "2026-11-02T23:50:00.000Z");
  assert.equal(p.sessions[1].start, "2026-11-03T00:20:00.000Z");
  assert.ok(p.gaps.every((g) => g.availableMinutes === 0));
});
