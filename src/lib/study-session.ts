export function validSessionSize(value: unknown): number | null {
  const count = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(count) && count > 0 ? count : null;
}

export function drawQuestions<T>(
  pool: readonly T[],
  requested: number,
  random = Math.random,
): T[] {
  const count = Math.min(validSessionSize(requested) ?? 0, pool.length);
  const result = [...pool];
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(random() * (result.length - i));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result.slice(0, count);
}

export type StudyCard = {
  id: string;
  created_at: string;
  first_studied_at: string | null;
  introduced_on: string | null;
  due_at: string | null;
};

export function createWordSession<T extends StudyCard>(
  cards: readonly T[],
  requested: number,
  now: number,
  today: string,
) {
  const allowance = Math.max(
    0,
    30 - cards.filter((card) => card.introduced_on === today).length,
  );
  const due = cards
    .filter(
      (card) =>
        card.first_studied_at && card.due_at && Date.parse(card.due_at) <= now,
    )
    .sort((a, b) => Date.parse(a.due_at!) - Date.parse(b.due_at!));
  const fresh = cards
    .filter((card) => !card.first_studied_at)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .slice(0, allowance);
  return [
    ...new Map([...due, ...fresh].map((card) => [card.id, card])).values(),
  ].slice(0, validSessionSize(requested) ?? 0);
}
