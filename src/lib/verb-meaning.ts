import { verbs } from "../data/french-verbs.ts";
import { roundLength } from "./conjugation.ts";

export type MeaningAnswer =
  | { phase: "writing" }
  | { phase: "revealed"; answer: string }
  | { phase: "rated"; answer: string; correct: boolean };

export function revealMeaning(
  state: MeaningAnswer,
  answer: string,
  composing = false,
): MeaningAnswer {
  if (state.phase !== "writing" || composing || !answer.trim()) return state;
  return { phase: "revealed", answer: answer.trim() };
}

export function rateMeaning(
  state: MeaningAnswer,
  correct: boolean,
): MeaningAnswer {
  if (state.phase !== "revealed") return state;
  return { phase: "rated", answer: state.answer, correct };
}

export function createMeaningRound(random = Math.random) {
  const pool = [...verbs];
  for (let i = 0; i < roundLength; i++) {
    const j = i + Math.floor(random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, roundLength).map((verb) => ({ verb }));
}
