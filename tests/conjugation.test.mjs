import test from "node:test";
import assert from "node:assert/strict";
import { verbs } from "../src/data/french-verbs.ts";
import {
  checkAnswer,
  createRound,
  normalizeAnswer,
  summarizeProgress,
  tenses,
} from "../src/lib/conjugation.ts";

const verb = (name) => verbs.find((item) => item.infinitive === name);
const forms = (name, tense) => verb(name).forms[tense];

test("100 unique verbs each have all six tenses and all six persons", () => {
  assert.equal(verbs.length, 100);
  assert.equal(new Set(verbs.map((item) => item.infinitive)).size, 100);
  for (const item of verbs) {
    assert.equal(Object.keys(item.forms).length, 6);
    for (const tense of tenses) {
      assert.equal(
        item.forms[tense.id].length,
        6,
        `${item.infinitive}: ${tense.id}`,
      );
      for (const answer of item.forms[tense.id]) {
        assert.ok(answer.length > 0);
        assert.doesNotMatch(answer, /undefined|null|\d/);
      }
    }
  }
});

test("irregular indicative, future and conditional stems", () => {
  assert.deepEqual(forms("être", "imparfait"), [
    "étais",
    "étais",
    "était",
    "étions",
    "étiez",
    "étaient",
  ]);
  assert.deepEqual(forms("faire", "present"), [
    "fais",
    "fais",
    "fait",
    "faisons",
    "faites",
    "font",
  ]);
  for (const [name, future, conditional] of [
    ["aller", "irai", "irais"],
    ["avoir", "aurai", "aurais"],
    ["être", "serai", "serais"],
    ["voir", "verrai", "verrais"],
    ["envoyer", "enverrai", "enverrais"],
    ["courir", "courrai", "courrais"],
    ["obtenir", "obtiendrai", "obtiendrais"],
    ["devoir", "devrai", "devrais"],
  ]) {
    assert.equal(forms(name, "futur")[0], future);
    assert.equal(forms(name, "conditionnel")[0], conditional);
  }
});

test("subjunctive irregular and double stems", () => {
  assert.deepEqual(forms("avoir", "subjonctif"), [
    "aie",
    "aies",
    "ait",
    "ayons",
    "ayez",
    "aient",
  ]);
  assert.deepEqual(forms("être", "subjonctif"), [
    "sois",
    "sois",
    "soit",
    "soyons",
    "soyez",
    "soient",
  ]);
  assert.deepEqual(forms("vouloir", "subjonctif"), [
    "veuille",
    "veuilles",
    "veuille",
    "voulions",
    "vouliez",
    "veuillent",
  ]);
  assert.deepEqual(forms("venir", "subjonctif"), [
    "vienne",
    "viennes",
    "vienne",
    "venions",
    "veniez",
    "viennent",
  ]);
  assert.deepEqual(forms("boire", "subjonctif"), [
    "boive",
    "boives",
    "boive",
    "buvions",
    "buviez",
    "boivent",
  ]);
  assert.equal(forms("faire", "subjonctif")[3], "fassions");
  assert.equal(forms("savoir", "subjonctif")[3], "sachions");
});

test("spelling changes preserve -ger, -cer and -ier forms", () => {
  assert.deepEqual(forms("manger", "imparfait"), [
    "mangeais",
    "mangeais",
    "mangeait",
    "mangions",
    "mangiez",
    "mangeaient",
  ]);
  assert.deepEqual(forms("commencer", "imparfait"), [
    "commençais",
    "commençais",
    "commençait",
    "commencions",
    "commenciez",
    "commençaient",
  ]);
  assert.equal(forms("changer", "subjonctif")[3], "changions");
  assert.equal(forms("commencer", "subjonctif")[4], "commenciez");
  assert.equal(forms("étudier", "imparfait")[3], "étudiions");
  assert.equal(forms("acheter", "subjonctif")[0], "achète");
  assert.equal(forms("acheter", "subjonctif")[3], "achetions");
  assert.equal(forms("appeler", "futur")[0], "appellerai");
});

test("compound past uses auxiliaries and masculine plural agreement", () => {
  assert.deepEqual(forms("aller", "passe-compose"), [
    "suis allé",
    "es allé",
    "est allé",
    "sommes allés",
    "êtes allés",
    "sont allés",
  ]);
  assert.equal(forms("naître", "passe-compose")[5], "sont nés");
  assert.equal(forms("descendre", "passe-compose")[4], "êtes descendus");
  assert.equal(forms("mourir", "passe-compose")[3], "sommes morts");
  assert.equal(forms("prendre", "passe-compose")[3], "avons pris");
  assert.equal(forms("être", "passe-compose")[3], "avons été");
  assert.equal(forms("devoir", "passe-compose")[0], "ai dû");
});

test("grading ignores case, Unicode accents and whitespace but preserves verb endings", () => {
  const question = {
    verb: verb("être"),
    tense: "passe-compose",
    person: 3,
  };
  assert.ok(checkAnswer(question, "  AVONS\t ETE\n"));
  assert.ok(checkAnswer(question, "avons e\u0301te\u0301"));
  assert.ok(checkAnswer(question, "avonsété"));
  assert.equal(checkAnswer(question, "été"), false);
  assert.equal(checkAnswer(question, "avons étés"), false);
  assert.equal(checkAnswer(question, "nous avons été"), false);
  assert.equal(checkAnswer(question, ""), false);
  assert.equal(normalizeAnswer("ÇŒUR"), "coeur");
  assert.equal(
    checkAnswer(
      { verb: verb("aller"), tense: "passe-compose", person: 5 },
      "sont alle",
    ),
    false,
  );
});

test("accepts both standard -ayer spellings", () => {
  for (const [name, tense, first, second] of [
    ["payer", "present", "paie", "paye"],
    ["essayer", "present", "essaie", "essaye"],
    ["payer", "futur", "paierai", "payerai"],
    ["essayer", "conditionnel", "essaierais", "essayerais"],
  ]) {
    for (const answer of [first, second])
      assert.ok(checkAnswer({ verb: verb(name), tense, person: 0 }, answer));
  }
});

test("rounds contain ten unique questions in the selected mode", () => {
  for (const mode of ["mixed", ...tenses.map((tense) => tense.id)]) {
    for (const random of [() => 0, () => 0.999999, Math.random]) {
      const round = createRound(mode, random);
      assert.equal(round.length, 10);
      assert.equal(
        new Set(round.map((q) => `${q.verb.infinitive}:${q.tense}:${q.person}`))
          .size,
        10,
      );
      for (const q of round) {
        assert.ok(q.person >= 0 && q.person < 6);
        if (mode !== "mixed") assert.equal(q.tense, mode);
      }
    }
  }
});

test("statistics aggregate across verbs and separate tenses without fabricating a zero accuracy", () => {
  const empty = summarizeProgress([]);
  assert.deepEqual(empty.total, { attempts: 0, correct: 0, last: "" });
  assert.equal(empty.byTense.length, 6);
  const stats = summarizeProgress([
    {
      verb: "aller",
      tense: "present",
      attempts: 3,
      correct: 2,
      last_practiced_at: "2026-10-19T00:00:00Z",
    },
    {
      verb: "avoir",
      tense: "present",
      attempts: 2,
      correct: 1,
      last_practiced_at: "2026-10-20T00:00:00Z",
    },
    {
      verb: "avoir",
      tense: "futur",
      attempts: 5,
      correct: 4,
      last_practiced_at: "2026-10-18T00:00:00Z",
    },
  ]);
  assert.deepEqual(stats.total, {
    attempts: 10,
    correct: 7,
    last: "2026-10-20T00:00:00Z",
  });
  assert.equal(stats.byTense.find((row) => row.id === "present").attempts, 5);
  assert.equal(stats.byTense.find((row) => row.id === "present").correct, 3);
  assert.equal(stats.byTense.find((row) => row.id === "imparfait").attempts, 0);
});
