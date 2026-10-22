import test from "node:test";
import assert from "node:assert/strict";
import { verbs } from "../src/data/french-verbs.ts";
import { verbMeanings } from "../src/data/french-verb-meanings.ts";
import {
  createMeaningRound,
  revealMeaning,
  rateMeaning,
} from "../src/lib/verb-meaning.ts";

test("Chinese meanings cover exactly the existing 100 verbs", () => {
  assert.deepEqual(
    Object.keys(verbMeanings).sort(),
    verbs.map((v) => v.infinitive).sort(),
  );
  for (const meanings of Object.values(verbMeanings)) {
    assert.ok(meanings.length > 0);
    assert.equal(new Set(meanings).size, meanings.length);
    for (const meaning of meanings) assert.match(meaning, /\p{Script=Han}/u);
  }
});

test("meaning rounds contain ten distinct infinitives and no tense or person", () => {
  for (const random of [() => 0, () => 0.999999, Math.random]) {
    const round = createMeaningRound(random);
    assert.equal(round.length, 10);
    assert.equal(new Set(round.map((q) => q.verb.infinitive)).size, 10);
    assert.ok(round.every((q) => !("tense" in q) && !("person" in q)));
  }
});

test("revealing an answer never assigns a verdict, even for exact or unrelated text", () => {
  for (const answer of ["去", "完全不同的解释"]) {
    const state = revealMeaning({ phase: "writing" }, `  ${answer}  `);
    assert.deepEqual(state, { phase: "revealed", answer });
    assert.equal("correct" in state, false);
  }
});

test("IME composition and empty answers cannot reveal or rate a question", () => {
  const writing = { phase: "writing" };
  assert.equal(revealMeaning(writing, "输入中", true), writing);
  assert.equal(revealMeaning(writing, " \t\n"), writing);
  assert.equal(rateMeaning(writing, true), writing);
});

test("self-assessment is the sole verdict and cannot be counted or changed twice", () => {
  const revealed = revealMeaning({ phase: "writing" }, "我自己的中文解释");
  const rated = rateMeaning(revealed, false);
  assert.deepEqual(rated, {
    phase: "rated",
    answer: "我自己的中文解释",
    correct: false,
  });
  assert.equal(rateMeaning(rated, true), rated);
  assert.equal(revealMeaning(rated, "其他答案"), rated);
});
