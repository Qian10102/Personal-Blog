import test from "node:test";
import assert from "node:assert/strict";
import { PracticeRound } from "../src/lib/practice-round.ts";
const round = () => {
  let id = 0;
  return new PracticeRound(
    (v) => v,
    () => String(++id),
  );
};

test("wrong answers retry at the tail until correct without a timer", () => {
  const r = round();
  r.start(["a", "b"]);
  assert.equal(r.previous(), false);
  r.settle(r.current.id, false);
  r.next();
  assert.deepEqual(
    r.entries.map((e) => e.value),
    ["a", "b", "a"],
  );
  r.settle(r.current.id, true);
  r.next();
  r.settle(r.current.id, false);
  r.next();
  assert.equal(r.current.value, "a");
  r.settle(r.current.id, true);
  r.next();
  assert.equal(r.remaining, 0);
  assert.equal(r.completed, 4);
  assert.equal(r.current, undefined);
});

test("regrading replaces a result and reconciles only unanswered retries", () => {
  const r = round();
  r.start(["a", "b"]);
  const a = r.current.id;
  r.settle(a, false);
  r.next();
  assert.equal(r.previous(), true);
  r.settle(a, true, 1);
  assert.deepEqual(
    r.entries.map((e) => e.value),
    ["a", "b"],
  );
  assert.equal(r.completed, 1);
  assert.equal(r.correct, 1);
  r.settle(a, false, 2);
  r.settle(a, false, 2);
  assert.equal(r.entries.length, 3); // delivery retry does not add a second slot
});

test("a later answer for the same item controls its outstanding retry", () => {
  const r = round();
  r.start(["a"]);
  const a = r.current.id;
  r.settle(a, false);
  r.next();
  const retry = r.current.id;
  r.settle(retry, true);
  r.next();
  r.settle(a, false, 1);
  assert.equal(r.entries.length, 2);
  r.settle(retry, false, 1);
  assert.equal(r.entries.length, 3);
  r.settle(a, true, 2);
  assert.equal(r.entries.length, 3); // later failed occurrence still needs practice
});

test("deleting a card removes its history and retry without skipping next card", () => {
  const r = round();
  r.start(["a", "b"]);
  r.settle(r.current.id, false);
  r.next();
  r.remove((v) => v === "a");
  assert.equal(r.current.value, "b");
  assert.equal(r.cursor, 0);
});
