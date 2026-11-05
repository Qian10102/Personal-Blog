import test from "node:test";
import assert from "node:assert/strict";
import {
  rememberPlannerReturn,
  consumePlannerReturn,
} from "../src/lib/review-auth-return.ts";
function storage() {
  const map = new Map();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}
test("ordinary vocabulary login has no planner redirect; a requested return is consumed once", () => {
  const s = storage();
  assert.equal(consumePlannerReturn(s, 1000), false);
  rememberPlannerReturn(s, 1000);
  assert.equal(consumePlannerReturn(s, 2000), true);
  assert.equal(consumePlannerReturn(s, 2001), false);
});
test("expired, future or malformed return markers cannot redirect an unrelated login", () => {
  for (const value of [
    "",
    "NaN",
    "Infinity",
    "https://other.example",
    "99999999",
    "1",
  ]) {
    const s = storage();
    s.setItem("review-planner-auth-return", value);
    assert.equal(consumePlannerReturn(s, 2_000_000), false);
  }
});
