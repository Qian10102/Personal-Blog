import test from "node:test";
import assert from "node:assert/strict";
import { createRound } from "../src/lib/conjugation.ts";
import { createMeaningRound } from "../src/lib/verb-meaning.ts";
import {
  validSessionSize,
  createWordSession,
} from "../src/lib/study-session.ts";

test("session sizes reject zero, fractions, nonfinite and unsafe values", () => {
  for (const value of ["", null, 0, -1, 1.2, "NaN", Infinity, 2 ** 53])
    assert.equal(validSessionSize(value), null);
  for (const value of [1, "7", 10, 20, 30, 50, Number.MAX_SAFE_INTEGER])
    assert.equal(validSessionSize(value), Number(value));
});
test("variable verb rounds clamp to their pools and contain distinct question units", () => {
  for (const count of [1, 7, 10, 20, 30, 50, 101, Number.MAX_SAFE_INTEGER]) {
    const meaning = createMeaningRound(() => 0.999999, count);
    assert.equal(meaning.length, Math.min(count, 100));
    assert.equal(
      new Set(meaning.map((q) => q.verb.infinitive)).size,
      meaning.length,
    );
    for (const mode of ["present", "mixed"]) {
      const round = createRound(mode, () => 0.5, count);
      assert.equal(
        round.length,
        Math.min(count, mode === "mixed" ? 3600 : 600),
      );
      assert.equal(
        new Set(round.map((q) => `${q.verb.infinitive}:${q.tense}:${q.person}`))
          .size,
        round.length,
      );
    }
  }
  assert.deepEqual(createMeaningRound(Math.random, 0), []);
});
test("word queue prioritizes due cards, caps new words daily, and never repeats IDs", () => {
  const today = "2026-10-23";
  const now = Date.parse(`${today}T12:00:00Z`);
  const card = (id, extra = {}) => ({
    id,
    created_at: "2026-01-01T00:00:00Z",
    first_studied_at: null,
    introduced_on: null,
    due_at: null,
    ...extra,
  });
  const learned = Array.from({ length: 28 }, (_, i) =>
    card(`learned${i}`, {
      introduced_on: today,
      first_studied_at: "2026-10-23T01:00:00Z",
      due_at: "2026-11-01T00:00:00Z",
    }),
  );
  const due = card("due", {
    first_studied_at: "2026-10-01T00:00:00Z",
    due_at: "2026-10-22T00:00:00Z",
  });
  const fresh = Array.from({ length: 10 }, (_, i) => card(`new${i}`));
  const queue = createWordSession(
    [...fresh, ...learned, due, due],
    50,
    now,
    today,
  );
  assert.deepEqual(
    queue.map((c) => c.id),
    ["due", "new0", "new1"],
  );
  assert.equal(
    createWordSession(
      [
        ...learned,
        ...fresh,
        ...[0, 1].map((i) =>
          card(`today${i}`, {
            introduced_on: today,
            first_studied_at: "2026-10-23T01:00:00Z",
          }),
        ),
      ],
      10,
      now,
      today,
    ).length,
    0,
  );
  assert.deepEqual(createWordSession([], 10, now, today), []);
  assert.deepEqual(
    createWordSession([due, ...fresh], 1, now, today).map((c) => c.id),
    ["due"],
  );
});
