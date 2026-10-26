import { PracticeRound } from "../lib/practice-round";
import {
  type Mistake,
  dueMistakes,
  prioritizeQuestions,
  reviewOutcome,
  reviewIntervals,
} from "../lib/mistake-review";
import { renderMistakeNotebook } from "../lib/mistake-notebook";
import { createWordSession } from "../lib/study-session";
import { sessionSizeControl } from "../lib/session-size-control";
import { loadAllRows } from "../lib/load-all-rows";
import {
  createClient,
  type SupabaseClient,
  type Session,
} from "@supabase/supabase-js";

type Rating = "again" | "hard" | "good" | "easy";
type WordCard = {
  id: string;
  user_id: string;
  word: string;
  meaning: string;
  example: string | null;
  created_at: string;
  updated_at: string;
  first_studied_at: string | null;
  introduced_on: string | null;
  due_at: string | null;
  interval_days: number;
  review_count: number;
  last_rating: Rating | null;
};

const allowedEmail = "qianzihanduo@gmail.com";
const loginPanel = document.querySelector<HTMLElement>("[data-login-panel]");
const appPanel = document.querySelector<HTMLElement>("[data-app-panel]");
const warning = document.querySelector<HTMLElement>("[data-config-warning]");
const status = document.querySelector<HTMLElement>("[data-status]");
const loginForm = document.querySelector<HTMLFormElement>("[data-login-form]");
const wordForm = document.querySelector<HTMLFormElement>("[data-word-form]");
const list = document.querySelector<HTMLElement>("[data-word-list]");
const formTitle = document.querySelector<HTMLElement>("[data-form-title]");
const saveButton =
  document.querySelector<HTMLButtonElement>("[data-save-word]");
const cancelEdit =
  document.querySelector<HTMLButtonElement>("[data-cancel-edit]");

const sessionSetup =
  document.querySelector<HTMLFormElement>("[data-word-setup]")!;
const sizeControl = sessionSizeControl(sessionSetup, () => "word");
const practiceRound = new PracticeRound<string>((id) => id);
let sessionIds: string[] = [];
function syncRound() {
  sessionIds = practiceRound.entries.map((e) => e.value);
  sessionIndex = practiceRound.cursor;
}
let sessionIndex = 0;
let sessionStarted = false;
let sessionRequested = 0;
let sessionOnly = false;
let message: [string, string] = ["", ""];
let supabase: SupabaseClient | null = null;
let cards: WordCard[] = [];
let mistakes: Mistake[] = [];
let ownerId: string | null = null;
let sessionKnown = false;
let epoch = 0;
type PendingReview = {
  id: string;
  cardId: string;
  rating: Rating;
  timezone: string;
  correction?: { id: string; expectedRevision: number };
};
let pendingReview: PendingReview | null = null;
let retryStored = true;
const pendingKey = (id: string) => `word-review-pending:${id}`;
function clearPending() {
  if (ownerId) {
    try {
      sessionStorage.removeItem(pendingKey(ownerId));
    } catch {
      /* Optional storage. */
    }
  }
  pendingReview = null;
}
function restorePending(id: string): PendingReview | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(pendingKey(id)) ?? "null");
    if (
      value &&
      /^[0-9a-f-]{36}$/i.test(value.id) &&
      /^[0-9a-f-]{36}$/i.test(value.cardId) &&
      ["again", "hard", "good", "easy"].includes(value.rating) &&
      typeof value.timezone === "string" &&
      value.timezone.length < 100
    )
      return value;
  } catch {
    /* Optional storage. */
  }
  return null;
}
let activeCard: WordCard | null = null;
let editingId: string | null = null;
let busy = false;
let dueRefreshTimer: number | undefined;

function scheduleDueRefresh() {
  if (dueRefreshTimer !== undefined) window.clearTimeout(dueRefreshTimer);
  const nextDue = cards
    .filter(
      (card) =>
        card.first_studied_at &&
        card.due_at &&
        Date.parse(card.due_at) > Date.now(),
    )
    .sort((a, b) => Date.parse(a.due_at!) - Date.parse(b.due_at!))[0];
  if (!nextDue?.due_at) return;
  const delay = Math.max(0, Date.parse(nextDue.due_at) - Date.now() + 500);
  dueRefreshTimer = window.setTimeout(() => {
    void loadCards().catch(() =>
      say(
        "加载词库失败，请检查网络连接。",
        "Couldn't refresh your words. Check your connection.",
      ),
    );
  }, delay);
}

function language() {
  return document.documentElement.dataset.uiLanguage === "zh" ? "zh" : "en";
}

function say(zh: string, en: string) {
  message = [zh, en];
  if (status) status.textContent = text(...message);
}

function text(zh: string, en: string) {
  return language() === "zh" ? zh : en;
}

function setBusy(value: boolean) {
  busy = value;
  document.querySelector<HTMLButtonElement>("[data-word-previous]")!.disabled =
    value || Boolean(pendingReview) || practiceRound.cursor === 0;
  document.querySelector<HTMLButtonElement>("[data-word-next]")!.disabled =
    value || Boolean(pendingReview);
  document
    .querySelectorAll<HTMLButtonElement>(
      "[data-word-form] button, [data-rating], [data-login-form] button, [data-word-setup] button",
    )
    .forEach((button) => {
      button.disabled = value || Boolean(pendingReview);
    });
  document.querySelector<HTMLElement>("[data-word-sync]")!.hidden =
    !pendingReview;
  document.querySelector<HTMLButtonElement>("[data-word-retry]")!.disabled =
    value;
  document.querySelector<HTMLElement>("[data-word-sync-message]")!.textContent =
    value
      ? text("正在同步进度…", "Syncing progress…")
      : text(
          retryStored
            ? "本题尚未确认同步，请重试后继续。刷新后仍可重试。"
            : "本题尚未确认同步，请在当前页面重试；浏览器未能保存待同步请求。",
          retryStored
            ? "This answer has not been confirmed as synced. Retry to continue, including after a refresh."
            : "Retry on this page; browser storage could not save the pending request.",
        );
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function reviewInterval(card: WordCard, rating: Rating) {
  if (rating === "again") return 0;
  if (rating === "hard") return 1;
  if (rating === "good")
    return card.interval_days <= 0
      ? 1
      : Math.max(card.interval_days + 1, Math.round(card.interval_days * 2));
  return card.interval_days <= 0
    ? 3
    : Math.max(card.interval_days + 1, Math.round(card.interval_days * 2.5));
}

function dueCards() {
  const now = Date.now();
  return cards
    .filter(
      (card) =>
        card.first_studied_at && card.due_at && Date.parse(card.due_at) <= now,
    )
    .sort((a, b) => Date.parse(a.due_at!) - Date.parse(b.due_at!));
}

function studiedToday() {
  const today = localDateKey();
  return cards.filter((card) => card.introduced_on === today).length;
}

function newCards() {
  return cards
    .filter((card) => !card.first_studied_at)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

function setTab(tab: "study" | "manage") {
  document
    .querySelectorAll<HTMLButtonElement>("[data-tab]")
    .forEach((button) => {
      const selected = button.dataset.tab === tab;
      button.setAttribute("aria-selected", String(selected));
    });
  document.querySelectorAll<HTMLElement>("[data-view]").forEach((view) => {
    view.hidden = view.dataset.view !== tab;
  });
}

function renderStudy() {
  document.querySelector<HTMLElement>("[data-session-note]")!.textContent =
    sessionRequested > sessionIds.length
      ? text(
          sessionOnly
            ? `本轮有 ${sessionIds.length} 个到期错题；可在错题本查看复习时间。`
            : `本轮可练 ${sessionIds.length} 个：优先到期复习，新词受每日 30 个额度限制。`,
          sessionOnly
            ? `This round has ${sessionIds.length} due mistakes. Check the notebook for review times.`
            : `Available this round: ${sessionIds.length}. Due reviews first, with up to 30 new words a day.`,
        )
      : "";
  renderMistakeNotebook(
    document.querySelector<HTMLElement>("[data-mistake-panel]")!,
    mistakes,
    "word",
    (id) =>
      cards.find((c) => c.id === id)?.word ??
      text("已删除的词条", "Deleted word"),
  );
  const due = dueCards();
  const fresh = newCards();
  const allowance = Math.max(0, 30 - studiedToday());
  const learnable = Boolean(due[0] || (fresh[0] && allowance > 0));

  document.querySelector<HTMLElement>("[data-due-count]")!.textContent = String(
    due.length,
  );
  document.querySelector<HTMLElement>("[data-new-count]")!.textContent = String(
    Math.min(allowance, fresh.length),
  );
  document.querySelector<HTMLElement>("[data-total-count]")!.textContent =
    String(cards.length);

  const studyCard = document.querySelector<HTMLElement>("[data-study-card]")!;
  const empty = document.querySelector<HTMLElement>("[data-study-empty]")!;
  practiceRound.remove((id) => !cards.some((card) => card.id === id));
  syncRound();
  document.querySelector<HTMLElement>("[data-word-previous]")!.hidden =
    !sessionStarted;
  document.querySelector<HTMLElement>("[data-word-next]")!.hidden =
    practiceRound.current?.correct === undefined;
  setBusy(busy);
  activeCard =
    cards.find((card) => card.id === sessionIds[sessionIndex]) ?? null;
  const inRound = Boolean(activeCard && sessionStarted);
  sessionSetup.hidden = inRound;
  studyCard.hidden = !inRound;
  empty.hidden = inRound || learnable;
  const summary = document.querySelector<HTMLElement>("[data-word-summary]")!;
  summary.hidden = !sessionStarted || inRound;
  summary.textContent = text(
    `本轮完成 · 共作答 ${practiceRound.completed} 次（含重练），进度已同步。`,
    `Round complete · ${practiceRound.completed} answers, including retries. Progress synced.`,
  );
  document.querySelector<HTMLElement>("[data-session-progress]")!.textContent =
    inRound
      ? text(
          `第 ${sessionIndex + 1} / ${sessionIds.length} 次 · 已答 ${practiceRound.completed} 次 · 待练 ${practiceRound.remaining} 次`,
          `Card ${sessionIndex + 1} of ${sessionIds.length} · ${practiceRound.completed} answered · ${practiceRound.remaining} remaining`,
        )
      : "";
  if (!learnable && !inRound) {
    const title = document.querySelector<HTMLElement>("[data-empty-title]")!;
    const copy = document.querySelector<HTMLElement>("[data-empty-copy]")!;
    if (cards.length === 0) {
      title.textContent = text("词库还是空的", "Your word list is empty");
      copy.textContent = text(
        "添加几个词条，就可以开始今天的练习。",
        "Add a few words to begin today's practice.",
      );
    } else if (due.length === 0 && fresh.length > 0) {
      title.textContent = text(
        "今天的新词学完了",
        "Today's new words are done",
      );
      copy.textContent = text(
        "明天会有新的学习额度。到期复习词仍会随时出现。",
        "Your new-word allowance refreshes tomorrow. Due reviews will appear as they come up.",
      );
    } else {
      title.textContent = text("今天的复习完成了", "You're all caught up");
      copy.textContent = text(
        "有新词到期时，它们会出现在这里。",
        "Words will appear here when they are due.",
      );
    }
    return;
  }

  if (!inRound || !activeCard) return;
  const isNew = !activeCard.first_studied_at;
  document.querySelector<HTMLElement>("[data-card-label]")!.textContent = isNew
    ? text("今日新词", "NEW WORD")
    : practiceRound.current?.retry
      ? text("本轮错词重练", "RETRY THIS ROUND")
      : practiceRound.current?.correct !== undefined
        ? text(
            "已答词条 · 评分将替换原结果",
            "ANSWERED CARD · RATING REPLACES ORIGINAL",
          )
        : text(
            `到期复习 · ${due.length} 个待复习`,
            `DUE REVIEW · ${due.length} due`,
          );
  document.querySelector<HTMLElement>("[data-card-word]")!.textContent =
    activeCard.word;
  document.querySelector<HTMLElement>("[data-card-hint]")!.textContent = text(
    "点击卡片查看释义",
    "Tap the card to reveal the meaning",
  );
  document.querySelector<HTMLElement>("[data-card-meaning]")!.textContent =
    activeCard.meaning;
  document.querySelector<HTMLElement>("[data-card-example]")!.textContent =
    activeCard.example ?? "";
  const card = document.querySelector<HTMLButtonElement>("[data-flashcard]")!;
  const wasRevealed =
    practiceRound.current?.correct !== undefined ||
    (card.dataset.cardId === practiceRound.current?.id &&
      card.getAttribute("aria-expanded") === "true");
  card.dataset.cardId = practiceRound.current!.id;
  card.setAttribute("aria-expanded", String(wasRevealed));
  document.querySelector<HTMLElement>("[data-card-answer]")!.hidden =
    !wasRevealed;
  document.querySelector<HTMLElement>("[data-card-hint]")!.hidden = wasRevealed;
  document.querySelector<HTMLElement>("[data-ratings]")!.hidden = !wasRevealed;
  const mistake = mistakes.find(
    (m) => m.kind === "word" && m.card_id === activeCard!.id && !m.mastered_at,
  );
  document
    .querySelectorAll<HTMLElement>("[data-rating] small")
    .forEach((hint) => {
      const rating = hint.closest<HTMLButtonElement>("[data-rating]")!.dataset
        .rating as Rating;
      const button = hint.closest<HTMLButtonElement>("[data-rating]")!;
      button.setAttribute(
        "aria-pressed",
        String(practiceRound.current?.rating === rating),
      );
      // Dynamic hints must not be overwritten by the global language renderer.
      hint.removeAttribute("data-ui-text");
      const outcome = mistake
        ? reviewOutcome(mistake, rating !== "again", Date.now())
        : null;
      hint.textContent =
        rating === "again"
          ? text(
              "本轮重练 · 10 分钟后复习",
              "Retry this round · review in 10 min",
            )
          : outcome
            ? outcome.mastered_at
              ? text("完成后掌握", "Master after review")
              : outcome.stage === mistake?.stage
                ? text("保持原定时间", "Keep scheduled time")
                : text(
                    `${reviewIntervals[outcome.stage] / 86400_000} 天后`,
                    `in ${reviewIntervals[outcome.stage] / 86400_000} ${outcome.stage === 1 ? "day" : "days"}`,
                  )
            : text(
                `${reviewInterval(activeCard!, rating)} 天后`,
                `in ${reviewInterval(activeCard!, rating)} ${reviewInterval(activeCard!, rating) === 1 ? "day" : "days"}`,
              );
    });
}

function renderList() {
  if (!list) return;
  list.replaceChildren();
  const listEmpty = document.querySelector<HTMLElement>("[data-list-empty]")!;
  listEmpty.hidden = cards.length > 0;
  document.querySelector<HTMLElement>("[data-list-count]")!.textContent =
    String(cards.length);

  for (const card of [...cards].sort((a, b) => a.word.localeCompare(b.word))) {
    const row = document.createElement("article");
    row.className = "vocabulary-word-row";
    const details = document.createElement("div");
    const word = document.createElement("strong");
    word.textContent = card.word;
    const meaning = document.createElement("span");
    meaning.textContent = card.meaning;
    details.append(word, meaning);
    if (card.example) {
      const example = document.createElement("small");
      example.textContent = card.example;
      details.append(example);
    }
    const actions = document.createElement("div");
    actions.className = "vocabulary-row-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "vocabulary-quiet";
    edit.textContent = text("编辑", "Edit");
    edit.addEventListener("click", () => beginEdit(card));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "vocabulary-quiet vocabulary-delete";
    remove.textContent = text("删除", "Delete");
    remove.addEventListener("click", () => deleteCard(card));
    actions.append(edit, remove);
    row.append(details, actions);
    list.append(row);
  }
}

function beginEdit(card: WordCard) {
  if (
    busy ||
    pendingReview ||
    !wordForm ||
    !formTitle ||
    !saveButton ||
    !cancelEdit
  )
    return;
  editingId = card.id;
  wordForm.querySelector<HTMLInputElement>("[name=word]")!.value = card.word;
  wordForm.querySelector<HTMLTextAreaElement>("[name=meaning]")!.value =
    card.meaning;
  wordForm.querySelector<HTMLTextAreaElement>("[name=example]")!.value =
    card.example ?? "";
  formTitle.textContent = text("编辑单词", "Edit word");
  saveButton.textContent = text("保存修改", "Save changes");
  cancelEdit.hidden = false;
  wordForm.querySelector<HTMLInputElement>("[name=word]")!.focus();
}

function resetForm() {
  wordForm?.reset();
  editingId = null;
  if (formTitle) formTitle.textContent = text("添加单词", "Add a word");
  if (saveButton) saveButton.textContent = text("保存词条", "Save word");
  if (cancelEdit) cancelEdit.hidden = true;
}

async function loadCards() {
  if (!supabase || !ownerId) return;
  const requestEpoch = epoch;
  const client = supabase;
  const userId = ownerId;
  const [loadedCards, loadedMistakes] = await Promise.all([
    loadAllRows<WordCard>((from, to) =>
      client
        .from("vocabulary_cards")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    loadAllRows<Mistake>((from, to) =>
      client
        .from("vocabulary_mistakes")
        .select("*")
        .eq("user_id", userId)
        .order("kind", { ascending: true })
        .order("item_key", { ascending: true })
        .range(from, to),
    ),
  ]);
  if (requestEpoch !== epoch) return;
  cards = loadedCards;
  mistakes = loadedMistakes;
  renderStudy();
  renderList();
  scheduleDueRefresh();
}

async function deleteCard(card: WordCard) {
  if (!supabase || busy || pendingReview) return;
  const confirmed = window.confirm(
    text(`确定删除“${card.word}”吗？`, `Delete “${card.word}”?`),
  );
  if (!confirmed) return;
  setBusy(true);
  const { error } = await supabase
    .from("vocabulary_cards")
    .delete()
    .eq("id", card.id);
  setBusy(false);
  if (error)
    return say(
      "删除失败，请稍后重试。",
      "Couldn't delete the word. Try again.",
    );
  if (activeCard?.id === card.id) activeCard = null;
  await loadCards();
  say("词条已删除。", "Word deleted.");
}

async function submitRating(rating: Rating) {
  if (!supabase || !ownerId || !activeCard || busy || pendingReview) return;
  const entry = practiceRound.current;
  if (!entry) return;
  pendingReview = {
    id: entry.id,
    ...(entry.correct !== undefined
      ? {
          correction: {
            id: crypto.randomUUID(),
            expectedRevision: entry.revision,
          },
        }
      : {}),
    cardId: activeCard.id,
    rating,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  retryStored = false;
  try {
    sessionStorage.setItem(pendingKey(ownerId), JSON.stringify(pendingReview));
    retryStored = true;
  } catch {
    /* In-memory retry remains available. */
  }
  await syncWordPending();
}

async function syncWordPending() {
  if (!supabase || !ownerId || !pendingReview || busy) return;
  const attempt = pendingReview;
  const requestEpoch = epoch;
  setBusy(true);
  try {
    const { data, error } = await supabase.rpc(
      attempt.correction ? "replace_practice_answer" : "record_practice_answer",
      attempt.correction
        ? {
            p_attempt_id: attempt.id,
            p_revision_id: attempt.correction.id,
            p_expected_revision: attempt.correction.expectedRevision,
            p_correct: attempt.rating !== "again",
            p_rating: attempt.rating,
          }
        : {
            p_attempt_id: attempt.id,
            p_kind: "word",
            p_correct: attempt.rating !== "again",
            p_card_id: attempt.cardId,
            p_rating: attempt.rating,
            p_timezone: attempt.timezone,
          },
    );
    if (requestEpoch !== epoch) return;
    if (error?.code === "40001") {
      clearPending();
      practiceRound.start([]);
      syncRound();
      sessionStarted = false;
      sessionRequested = 0;
      await loadCards();
      say(
        "这条评分已在其他页面更新。已重新加载进度，请开始新一轮。",
        "This assessment changed in another page. Progress reloaded; start a new round.",
      );
      return;
    }
    if (error?.code === "23514") {
      clearPending();
      practiceRound.entries = practiceRound.entries.slice(
        0,
        practiceRound.cursor,
      );
      syncRound();
      renderStudy();
      say(
        "今日的新词额度已用完，本轮结束。已提交的进度已保留。",
        "Today's new-word allowance is used up. This round has ended; saved progress is retained.",
      );
      return;
    }
    if (error || !data) throw error ?? new Error("Missing review");
    const card = data.card as WordCard | null;
    cards = cards.filter((c) => c.id !== attempt.cardId);
    if (card) cards.push(card);
    const mistake = data.mistake as Mistake | null;
    mistakes = mistakes.filter(
      (m) => m.kind !== "word" || m.card_id !== attempt.cardId,
    );
    if (mistake) mistakes.push(mistake);
    clearPending();
    if (
      practiceRound.settle(
        attempt.id,
        typeof data.correct === "boolean"
          ? data.correct
          : attempt.rating !== "again",
        data.revision ?? 0,
        undefined,
        attempt.rating,
      )
    ) {
      practiceRound.next();
      syncRound();
    }
    renderStudy();
    renderList();
    scheduleDueRefresh();
    if (sessionStarted && sessionIndex === sessionIds.length)
      document.querySelector<HTMLElement>("[data-word-summary]")!.focus();
    else if (activeCard)
      document.querySelector<HTMLButtonElement>("[data-flashcard]")!.focus();
    say(
      mistake
        ? mistake.mastered_at
          ? "这道错题已掌握，进度已同步。"
          : `进度已同步，下次复习：${new Date(mistake.next_review_at!).toLocaleString(document.documentElement.lang)}`
        : "复习进度已同步。",
      mistake
        ? mistake.mastered_at
          ? "Mistake mastered. Progress synced."
          : `Progress synced. Next review: ${new Date(mistake.next_review_at!).toLocaleString(document.documentElement.lang)}`
        : "Review progress synced.",
    );
  } catch {
    if (requestEpoch === epoch)
      say(
        "复习进度保存尚未确认，请重试同步。",
        "Your review has not been confirmed as saved. Retry sync.",
      );
  } finally {
    if (requestEpoch === epoch) setBusy(false);
  }
}
document
  .querySelector("[data-word-previous]")!
  .addEventListener("click", () => {
    if (busy || pendingReview || !practiceRound.previous()) return;
    syncRound();
    renderStudy();
    document.querySelector<HTMLButtonElement>("[data-flashcard]")!.focus();
  });
document.querySelector("[data-word-next]")!.addEventListener("click", () => {
  if (busy || pendingReview || !practiceRound.next()) return;
  syncRound();
  renderStudy();
});
document
  .querySelector("[data-word-retry]")!
  .addEventListener("click", () => void syncWordPending());

sessionSetup.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase || busy || pendingReview) return;
  const requestEpoch = epoch;
  const count = sizeControl.read();
  if (!count) return;
  setBusy(true);
  try {
    await loadCards();
    if (requestEpoch !== epoch) return;
    const only =
      document.querySelector<HTMLInputElement>("[data-review-only]")!.checked;
    const priority = dueMistakes(mistakes, "word", Date.now()).flatMap(
      (m) => cards.find((c) => c.id === m.card_id) ?? [],
    );
    const pool = only
      ? []
      : createWordSession(cards, count, Date.now(), localDateKey());
    const selected = prioritizeQuestions(
      priority,
      pool,
      count,
      (card) => card.id,
    ).map((card) => card.id);
    practiceRound.start(selected);
    syncRound();
    sessionStarted = sessionIds.length > 0;
    sessionRequested = count;
    sessionOnly = only;
    renderStudy();
    if (sessionStarted)
      document.querySelector<HTMLButtonElement>("[data-flashcard]")!.focus();
  } catch {
    say("加载词库失败，请重试。", "Couldn't load words. Please retry.");
  } finally {
    if (requestEpoch === epoch) setBusy(false);
  }
});

document
  .querySelector<HTMLButtonElement>("[data-flashcard]")
  ?.addEventListener("click", (event) => {
    const card = event.currentTarget as HTMLButtonElement;
    card.setAttribute("aria-expanded", "true");
    document.querySelector<HTMLElement>("[data-card-hint]")!.hidden = true;
    document.querySelector<HTMLElement>("[data-card-answer]")!.hidden = false;
    document.querySelector<HTMLElement>("[data-ratings]")!.hidden = false;
  });

document
  .querySelectorAll<HTMLButtonElement>("[data-rating]")
  .forEach((button) => {
    button.addEventListener(
      "click",
      () => void submitRating(button.dataset.rating as Rating),
    );
  });

document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
  button.addEventListener("click", () =>
    setTab(button.dataset.tab as "study" | "manage"),
  );
});

document
  .querySelector<HTMLButtonElement>("[data-empty-manage]")
  ?.addEventListener("click", () => setTab("manage"));
cancelEdit?.addEventListener("click", resetForm);

wordForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase || busy || pendingReview) return;
  const values = new FormData(wordForm);
  const word = String(values.get("word") ?? "").trim();
  const meaning = String(values.get("meaning") ?? "").trim();
  const example = String(values.get("example") ?? "").trim() || null;
  if (!word || !meaning) return;
  setBusy(true);
  const wasEditing = Boolean(editingId);
  const request = editingId
    ? supabase
        .from("vocabulary_cards")
        .update({
          word,
          meaning,
          example,
          updated_at: new Date().toISOString(),
        })
        .eq("id", editingId)
    : supabase.from("vocabulary_cards").insert({ word, meaning, example });
  const { error } = await request;
  setBusy(false);
  if (error)
    return say("保存失败，请稍后重试。", "Couldn't save the word. Try again.");
  resetForm();
  await loadCards();
  say(
    wasEditing ? "词条已更新。" : "词条已添加。",
    wasEditing ? "Word updated." : "Word added.",
  );
});

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase || busy || pendingReview) return;
  const email = String(new FormData(loginForm).get("email") ?? "")
    .trim()
    .toLowerCase();
  if (email !== allowedEmail) {
    say(
      "这个邮箱没有背词账号权限。",
      "This email is not authorized for vocabulary access.",
    );
    return;
  }
  setBusy(true);
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${window.location.origin}/vocabulary/`,
    },
  });
  setBusy(false);
  if (error)
    return say(
      "发送失败，请检查邮件服务配置后重试。",
      "Couldn't send the link. Check email delivery settings and try again.",
    );
  say("登录链接已发送，请查收邮箱。", "Sign-in link sent. Check your email.");
});

document
  .querySelector<HTMLButtonElement>("[data-sign-out]")
  ?.addEventListener("click", async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  });

document.addEventListener("ui-language-change", () => {
  if (status) status.textContent = text(...message);
  setBusy(busy);
  renderStudy();
  renderList();
  if (editingId) {
    const card = cards.find((item) => item.id === editingId);
    if (card) beginEdit(card);
  }
});

const url = import.meta.env.PUBLIC_SUPABASE_URL;
const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  if (warning) warning.hidden = false;
} else {
  supabase = createClient(url, anonKey);
  const showSession = async (session: Session | null) => {
    const email = session?.user.email;
    const authorized = email?.toLowerCase() === allowedEmail;
    const nextOwner = authorized ? session!.user.id : null;
    if (sessionKnown && nextOwner === ownerId && (nextOwner || !email)) return;
    sessionKnown = true;
    epoch++;
    ownerId = nextOwner;
    practiceRound.start([]);
    syncRound();
    sessionStarted = false;
    sessionRequested = 0;
    activeCard = null;
    cards = [];
    mistakes = [];
    resetForm();
    say("", "");
    pendingReview = ownerId ? restorePending(ownerId) : null;
    busy = false;
    if (loginPanel) loginPanel.hidden = Boolean(authorized);
    if (appPanel) appPanel.hidden = !authorized;
    if (!authorized) {
      if (dueRefreshTimer !== undefined) window.clearTimeout(dueRefreshTimer);
      if (email) await supabase?.auth.signOut();
      cards = [];
      mistakes = [];
      sessionIds = [];
      sessionIndex = 0;
      sessionStarted = false;
      activeCard = null;
      renderStudy();
      return;
    }
    document.querySelector<HTMLElement>("[data-user-email]")!.textContent =
      email!;
    try {
      await loadCards();
      if (pendingReview && !cards.some((c) => c.id === pendingReview!.cardId))
        clearPending();
      setBusy(false);
      await syncWordPending();
    } catch {
      setBusy(false);
      say(
        "加载词库失败，请检查 Supabase 数据库配置。",
        "Couldn't load your words. Check the Supabase database setup.",
      );
    }
  };
  void supabase.auth.getSession().then(({ data }) => showSession(data.session));
  supabase.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => void showSession(session), 0);
  });
}

window.setInterval(() => {
  if (ownerId) renderStudy();
}, 30_000);
