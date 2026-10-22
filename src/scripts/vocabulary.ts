import { createWordSession } from "../lib/study-session";
import { sessionSizeControl } from "../lib/session-size-control";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
let sessionIds: string[] = [];
let sessionIndex = 0;
let sessionStarted = false;
let supabase: SupabaseClient | null = null;
let cards: WordCard[] = [];
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
  if (status) status.textContent = language() === "zh" ? zh : en;
}

function text(zh: string, en: string) {
  return language() === "zh" ? zh : en;
}

function setBusy(value: boolean) {
  busy = value;
  document
    .querySelectorAll<HTMLButtonElement>(
      "[data-word-form] button, [data-rating], [data-login-form] button, [data-word-setup] button",
    )
    .forEach((button) => {
      button.disabled = value;
    });
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

function nextDue(card: WordCard, rating: Rating, now: Date) {
  if (rating === "again") return new Date(now.getTime() + 10 * 60 * 1000);
  if (rating === "hard") return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const days = reviewInterval(card, rating);
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
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
  // Keep the chosen queue fixed; deleted future cards reduce the actual target.
  sessionIds = [
    ...sessionIds.slice(0, sessionIndex),
    ...sessionIds
      .slice(sessionIndex)
      .filter((id) => cards.some((card) => card.id === id)),
  ];
  activeCard =
    cards.find((card) => card.id === sessionIds[sessionIndex]) ?? null;
  const inRound = Boolean(activeCard && sessionStarted);
  sessionSetup.hidden = inRound;
  studyCard.hidden = !inRound;
  empty.hidden = inRound || learnable;
  const summary = document.querySelector<HTMLElement>("[data-word-summary]")!;
  summary.hidden = !sessionStarted || inRound;
  summary.textContent = text(
    `本轮完成 · ${sessionIndex} / ${sessionIds.length} 个，进度已同步。`,
    `Round complete · ${sessionIndex} of ${sessionIds.length} words. Progress synced.`,
  );
  document.querySelector<HTMLElement>("[data-session-progress]")!.textContent =
    inRound
      ? text(
          `本轮 ${sessionIndex + 1} / ${sessionIds.length} 个 · 已完成 ${sessionIndex} 个`,
          `Word ${sessionIndex + 1} of ${sessionIds.length} · ${sessionIndex} completed`,
        )
      : "";
  if (!learnable) {
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
  card.setAttribute("aria-expanded", "false");
  document.querySelector<HTMLElement>("[data-card-answer]")!.hidden = true;
  document.querySelector<HTMLElement>("[data-card-hint]")!.hidden = false;
  document.querySelector<HTMLElement>("[data-ratings]")!.hidden = true;
  document
    .querySelectorAll<HTMLElement>("[data-rating-hint]")
    .forEach((hint) => {
      hint.textContent = text(
        `${reviewInterval(activeCard!, hint.dataset.ratingHint as Rating)} 天后`,
        `in ${reviewInterval(activeCard!, hint.dataset.ratingHint as Rating)} days`,
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
  if (!wordForm || !formTitle || !saveButton || !cancelEdit) return;
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
  if (!supabase) return;
  const { data, error } = await supabase
    .from("vocabulary_cards")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  cards = (data ?? []) as WordCard[];
  renderStudy();
  renderList();
  scheduleDueRefresh();
}

async function deleteCard(card: WordCard) {
  if (!supabase || busy) return;
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
  if (!supabase || !activeCard || busy) return;
  setBusy(true);
  const now = new Date();
  const dueAt = nextDue(activeCard, rating, now);
  const patch: Partial<WordCard> = {
    first_studied_at: activeCard.first_studied_at ?? now.toISOString(),
    introduced_on: activeCard.introduced_on ?? localDateKey(now),
    last_rating: rating,
    due_at: dueAt.toISOString(),
    interval_days: reviewInterval(activeCard, rating),
    review_count: activeCard.review_count + 1,
    updated_at: now.toISOString(),
  };
  const { error } = await supabase
    .from("vocabulary_cards")
    .update(patch)
    .eq("id", activeCard.id);
  setBusy(false);
  if (error)
    return say(
      "复习进度保存失败，请重试。",
      "Couldn't save your review. Please try again.",
    );
  cards = cards.map((card) =>
    card.id === activeCard!.id ? { ...card, ...patch } : card,
  );
  sessionIndex++;
  renderStudy();
  renderList();
  scheduleDueRefresh();
  if (sessionIndex === sessionIds.length)
    document.querySelector<HTMLElement>("[data-word-summary]")!.focus();
  else document.querySelector<HTMLButtonElement>("[data-flashcard]")!.focus();
  say("复习进度已同步。", "Review progress synced.");
}

sessionSetup.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase || busy) return;
  const count = sizeControl.read();
  if (!count) return;
  setBusy(true);
  try {
    await loadCards();
    sessionIds = createWordSession(
      cards,
      count,
      Date.now(),
      localDateKey(),
    ).map((card) => card.id);
    sessionIndex = 0;
    sessionStarted = sessionIds.length > 0;
    document.querySelector<HTMLElement>("[data-session-note]")!.textContent =
      sessionIds.length < count
        ? text(
            `本轮可练 ${sessionIds.length} 个：优先到期复习，新词受每日 30 个额度限制。`,
            `This round has ${sessionIds.length} words: due reviews first, with up to 30 new words a day.`,
          )
        : "";
    renderStudy();
    if (sessionStarted)
      document.querySelector<HTMLButtonElement>("[data-flashcard]")!.focus();
  } catch {
    say("加载词库失败，请重试。", "Couldn't load words. Please retry.");
  } finally {
    setBusy(false);
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
  if (!supabase || busy) return;
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
  if (!supabase || busy) return;
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
  const showSession = async (email: string | undefined) => {
    const authorized = email?.toLowerCase() === allowedEmail;
    if (loginPanel) loginPanel.hidden = Boolean(authorized);
    if (appPanel) appPanel.hidden = !authorized;
    if (!authorized) {
      if (dueRefreshTimer !== undefined) window.clearTimeout(dueRefreshTimer);
      if (email) await supabase?.auth.signOut();
      cards = [];
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
    } catch {
      say(
        "加载词库失败，请检查 Supabase 数据库配置。",
        "Couldn't load your words. Check the Supabase database setup.",
      );
    }
  };
  void supabase.auth
    .getSession()
    .then(({ data }) => showSession(data.session?.user.email));
  supabase.auth.onAuthStateChange((_event, session) => {
    void showSession(session?.user.email);
  });
}
