const key = "review-planner-auth-return";
const maxAge = 30 * 60_000;
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function rememberPlannerReturn(
  storage: StorageLike,
  now = Date.now(),
): void {
  storage.setItem(key, String(now));
}

export function consumePlannerReturn(
  storage: StorageLike,
  now = Date.now(),
): boolean {
  const raw = storage.getItem(key);
  if (raw === null) return false;
  storage.removeItem(key);
  const stamp = Number(raw);
  return (
    raw.trim() !== "" &&
    Number.isFinite(stamp) &&
    stamp <= now &&
    now - stamp <= maxAge
  );
}
