import { drawQuestions } from "./study-session.ts";
import { verbs } from "../data/french-verbs.ts";

export const tenses = [
  {
    id: "present",
    fr: "Présent de l’indicatif",
    zh: "直陈式现在时",
    en: "Present indicative",
  },
  {
    id: "passe-compose",
    fr: "Passé composé",
    zh: "复合过去时",
    en: "Compound past",
  },
  { id: "imparfait", fr: "Imparfait", zh: "未完成过去时", en: "Imperfect" },
  { id: "futur", fr: "Futur simple", zh: "简单将来时", en: "Simple future" },
  {
    id: "conditionnel",
    fr: "Conditionnel présent",
    zh: "现在条件式",
    en: "Present conditional",
  },
  {
    id: "subjonctif",
    fr: "Subjonctif présent",
    zh: "现在虚拟式",
    en: "Present subjunctive",
  },
] as const;

export type Tense = (typeof tenses)[number]["id"];
export type Mode = Tense | "mixed";
export type Question = {
  verb: (typeof verbs)[number];
  tense: Tense;
  person: number;
};
export type Progress = {
  verb: string;
  tense: Tense;
  attempts: number;
  correct: number;
  last_practiced_at: string;
};
export const pronouns = ["je", "tu", "il", "nous", "vous", "ils"] as const;
export const roundLength = 10;

export function normalizeAnswer(answer: string): string {
  return answer
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/[’‘ʼ]/g, "'")
    .replace(/\s+/gu, "");
}

export function checkAnswer(question: Question, answer: string): boolean {
  const expected = question.verb.forms[question.tense][question.person];
  return expected
    .split(" / ")
    .some((variant) => normalizeAnswer(answer) === normalizeAnswer(variant));
}

export function createRound(
  mode: Mode,
  random = Math.random,
  count = roundLength,
): Question[] {
  const pool: Question[] = [];
  for (const verb of verbs)
    for (const tense of tenses) {
      if (mode !== "mixed" && tense.id !== mode) continue;
      for (let person = 0; person < pronouns.length; person++)
        pool.push({ verb, tense: tense.id, person });
    }
  return drawQuestions(pool, count, random);
}

export function summarizeProgress(rows: Progress[]) {
  const summarize = (items: Progress[]) =>
    items.reduce(
      (sum, row) => ({
        attempts: sum.attempts + row.attempts,
        correct: sum.correct + row.correct,
        last:
          row.last_practiced_at > sum.last ? row.last_practiced_at : sum.last,
      }),
      { attempts: 0, correct: 0, last: "" },
    );
  return {
    total: summarize(rows),
    byTense: tenses.map((tense) => ({
      ...tense,
      ...summarize(rows.filter((row) => row.tense === tense.id)),
    })),
  };
}
