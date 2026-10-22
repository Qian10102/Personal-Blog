export const reviewIntervals = [
  10 * 60_000,
  86400_000,
  3 * 86400_000,
  7 * 86400_000,
  14 * 86400_000,
  30 * 86400_000,
] as const;
export type PracticeKind = "word" | "conjugation" | "meaning";
export type Mistake = {
  kind: PracticeKind;
  item_key: string;
  card_id: string | null;
  verb: string | null;
  tense: string | null;
  person: number | null;
  stage: number;
  wrong_count: number;
  next_review_at: string | null;
  mastered_at: string | null;
  last_correct: boolean;
  last_practiced_at: string;
};

export function reviewOutcome(
  previous: Pick<
    Mistake,
    "stage" | "wrong_count" | "next_review_at" | "mastered_at"
  > | null,
  correct: boolean,
  now: number,
) {
  if (!correct)
    return {
      stage: 0,
      wrong_count: (previous?.wrong_count ?? 0) + 1,
      next_review_at: new Date(now + reviewIntervals[0]).toISOString(),
      mastered_at: null,
    };
  if (
    !previous ||
    previous.mastered_at ||
    !previous.next_review_at ||
    Date.parse(previous.next_review_at) > now
  )
    return previous;
  if (previous.stage === reviewIntervals.length - 1)
    return {
      ...previous,
      next_review_at: null,
      mastered_at: new Date(now).toISOString(),
    };
  const stage = previous.stage + 1;
  return {
    ...previous,
    stage,
    next_review_at: new Date(now + reviewIntervals[stage]).toISOString(),
  };
}

export function dueMistakes(
  mistakes: readonly Mistake[],
  kind: PracticeKind,
  now: number,
  tense = "mixed",
) {
  return mistakes
    .filter(
      (m) =>
        m.kind === kind &&
        !m.mastered_at &&
        m.next_review_at &&
        Date.parse(m.next_review_at) <= now &&
        (kind !== "conjugation" || tense === "mixed" || m.tense === tense),
    )
    .sort(
      (a, b) => Date.parse(a.next_review_at!) - Date.parse(b.next_review_at!),
    );
}

export function prioritizeQuestions<T>(
  priority: readonly T[],
  pool: readonly T[],
  count: number,
  key: (question: T) => string,
) {
  return [
    ...new Map([...priority, ...pool].map((q) => [key(q), q])).values(),
  ].slice(0, count);
}
