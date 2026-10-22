import test from "node:test";
import assert from "node:assert/strict";
import {
  reviewIntervals,
  reviewOutcome,
  dueMistakes,
  prioritizeQuestions,
} from "../src/lib/mistake-review.ts";
const now = Date.parse("2026-10-23T00:00:00Z");
const active = (extra = {}) => ({
  kind: "conjugation",
  item_key: "aller:present:0",
  card_id: null,
  verb: "aller",
  tense: "present",
  person: 0,
  stage: 0,
  wrong_count: 1,
  next_review_at: new Date(now).toISOString(),
  mastered_at: null,
  last_correct: false,
  last_practiced_at: new Date(now - 10000).toISOString(),
  ...extra,
});

test("only mistakes create a schedule; wrong answers reset it and accumulate", () => {
  assert.equal(reviewOutcome(null, true, now), null);
  const first = reviewOutcome(null, false, now);
  assert.deepEqual(first, {
    stage: 0,
    wrong_count: 1,
    next_review_at: new Date(now + 600000).toISOString(),
    mastered_at: null,
  });
  const reset = reviewOutcome({ ...first, stage: 4 }, false, now + 500);
  assert.equal(reset.stage, 0);
  assert.equal(reset.wrong_count, 2);
  assert.equal(Date.parse(reset.next_review_at), now + 500 + 600000);
});
test("early correct keeps the schedule; exactly due and overdue advance one stage from answer time", () => {
  const early = active({ next_review_at: new Date(now + 1).toISOString() });
  assert.equal(reviewOutcome(early, true, now), early);
  for (const delay of [0, 1000, 100 * 86400000]) {
    const result = reviewOutcome(active(), true, now + delay);
    assert.equal(result.stage, 1);
    assert.equal(Date.parse(result.next_review_at), now + delay + 86400000);
    assert.equal(result.wrong_count, 1);
  }
});
test("all six intervals lead to mastery, preserve counts, and reactivate on a new error", () => {
  let state = reviewOutcome(null, false, now);
  for (let stage = 1; stage < 6; stage++) {
    const answered = Date.parse(state.next_review_at);
    state = reviewOutcome(state, true, answered);
    assert.equal(state.stage, stage);
    assert.equal(
      Date.parse(state.next_review_at) - answered,
      reviewIntervals[stage],
    );
  }
  const finalTime = Date.parse(state.next_review_at);
  const mastered = reviewOutcome(state, true, finalTime);
  assert.equal(mastered.next_review_at, null);
  assert.equal(Date.parse(mastered.mastered_at), finalTime);
  assert.equal(reviewOutcome(mastered, true, finalTime + 1), mastered);
  const reactivated = reviewOutcome(mastered, false, finalTime + 100);
  assert.equal(reactivated.stage, 0);
  assert.equal(reactivated.wrong_count, 2);
  assert.equal(reactivated.mastered_at, null);
});
test("due selection respects kind and tense; priority is unique and obeys round limit", () => {
  const rows = [
    active(),
    active({
      item_key: "aller:futur:0",
      tense: "futur",
      next_review_at: new Date(now - 1).toISOString(),
    }),
    active({ kind: "meaning", item_key: "aller", tense: null, person: null }),
    active({
      item_key: "later",
      next_review_at: new Date(now + 1).toISOString(),
    }),
    active({
      item_key: "mastered",
      next_review_at: null,
      mastered_at: new Date(now).toISOString(),
    }),
  ];
  assert.deepEqual(
    dueMistakes(rows, "conjugation", now, "present").map((m) => m.item_key),
    ["aller:present:0"],
  );
  assert.equal(dueMistakes(rows, "conjugation", now).length, 2);
  const due = dueMistakes(rows, "meaning", now);
  assert.deepEqual(
    prioritizeQuestions(
      due,
      [...due, active({ item_key: "new" })],
      2,
      (q) => q.item_key,
    ).map((q) => q.item_key),
    ["aller", "new"],
  );
  assert.deepEqual(
    prioritizeQuestions([], [], 20, (q) => q.item_key),
    [],
  );
  assert.equal(prioritizeQuestions(rows, [], 2, (q) => q.item_key).length, 2);
});
