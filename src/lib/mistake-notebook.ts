import { type Mistake, type PracticeKind, dueMistakes } from "./mistake-review";
import { pronouns, tenses } from "./conjugation";

export function renderMistakeNotebook(
  root: HTMLElement,
  mistakes: Mistake[],
  kind: PracticeKind,
  word: (id: string) => string = (id) => id,
  tense = "mixed",
) {
  const text = (zh: string, en: string) =>
    document.documentElement.dataset.uiLanguage === "zh" ? zh : en;
  const items = mistakes.filter(
    (m) =>
      m.kind === kind &&
      (kind !== "conjugation" || tense === "mixed" || m.tense === tense),
  );
  const due = dueMistakes(items, kind, Date.now(), tense);
  root.querySelector<HTMLElement>("[data-mistake-count]")!.textContent = text(
    `· ${due.length} 个到期`,
    `· ${due.length} due`,
  );
  const upcoming = items
    .filter((m) => !m.mastered_at && m.next_review_at)
    .sort(
      (a, b) => Date.parse(a.next_review_at!) - Date.parse(b.next_review_at!),
    )[0];
  root.querySelector<HTMLElement>("[data-mistake-status]")!.textContent =
    due.length
      ? text(
          `${due.length} 个错题到期，开始下一轮时优先练习。`,
          `${due.length} mistakes are due and will come first in the next round.`,
        )
      : upcoming
        ? text("下次复习：", "Next review: ") +
          new Date(upcoming.next_review_at!).toLocaleString(
            document.documentElement.lang,
          )
        : text(
            items.length ? "本模式错题已全部掌握。" : "本模式还没有错题。",
            items.length
              ? "All mistakes in this mode are mastered."
              : "No mistakes in this mode yet.",
          );
  root.querySelector<HTMLElement>("[data-mistake-list]")!.replaceChildren(
    ...items
      .sort(
        (a, b) =>
          Number(Boolean(a.mastered_at)) - Number(Boolean(b.mastered_at)) ||
          (a.next_review_at ?? "").localeCompare(b.next_review_at ?? ""),
      )
      .map((m) => {
        const row = document.createElement("article");
        const name = document.createElement("strong");
        const tenseName = tenses.find((t) => t.id === m.tense);
        name.textContent =
          kind === "word"
            ? word(m.card_id!)
            : `${m.verb}${kind === "conjugation" ? ` · ${text(tenseName?.zh ?? "", tenseName?.en ?? "")} · ${pronouns[m.person!]}` : ""}`;
        const state = document.createElement("span");
        state.textContent = m.mastered_at
          ? text("已掌握", "Mastered")
          : text(`阶段 ${m.stage + 1} / 6 · `, `Stage ${m.stage + 1} of 6 · `) +
            (Date.parse(m.next_review_at!) <= Date.now()
              ? text("已到期 · ", "Due · ")
              : "") +
            new Date(m.next_review_at!).toLocaleString(
              document.documentElement.lang,
            );
        const count = document.createElement("small");
        count.textContent = text(
          `累计答错 ${m.wrong_count} 次`,
          `${m.wrong_count} mistakes recorded`,
        );
        row.append(name, state, count);
        return row;
      }),
  );
}
