import { verbs } from "../data/french-verbs.ts";
import { drawQuestions } from "./study-session.ts";

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

export function createMeaningRound(random = Math.random, count = 10) {
  return drawQuestions(verbs, count, random).map((verb) => ({ verb }));
}
