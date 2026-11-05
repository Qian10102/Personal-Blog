export type DraftTask = {
  title: string;
  content: string;
  phase: "learn" | "practice" | "recap";
  minutes: number;
  order: number;
};
export function parseTaskDraft(value: unknown): {
  tasks: DraftTask[];
  warnings: string[];
} {
  const data = value as { tasks?: unknown[]; warnings?: unknown[] };
  if (
    !data ||
    !Array.isArray(data.tasks) ||
    !data.tasks.length ||
    data.tasks.length > 80 ||
    !Array.isArray(data.warnings) ||
    data.warnings.length > 20 ||
    data.warnings.some((w) => typeof w !== "string" || w.length > 1000)
  )
    throw new Error("invalid_ai_response");
  const phases = ["learn", "practice", "recap"];
  const tasks = data.tasks.map((raw, i): DraftTask => {
    const t = raw as Record<string, unknown>;
    if (
      !t ||
      typeof t.title !== "string" ||
      !t.title.trim() ||
      t.title.length > 200 ||
      typeof t.content !== "string" ||
      !t.content.trim() ||
      t.content.length > 2000 ||
      !phases.includes(t.phase as string) ||
      typeof t.minutes !== "number" ||
      !Number.isInteger(t.minutes) ||
      t.minutes < 25 ||
      t.minutes > 6000 ||
      t.minutes % 25 !== 0
    )
      throw new Error("invalid_ai_response");
    return {
      title: t.title.trim(),
      content: t.content.trim(),
      phase: t.phase as DraftTask["phase"],
      minutes: t.minutes,
      order: i + 1,
    };
  });
  if (!phases.every((p) => tasks.some((t) => t.phase === p)))
    throw new Error("invalid_ai_response");
  return { tasks, warnings: data.warnings as string[] };
}
