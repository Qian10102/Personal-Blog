import {
  createClient,
  type SupabaseClient,
  type Session,
} from "@supabase/supabase-js";
import {
  checkAnswer,
  createRound,
  pronouns,
  roundLength,
  summarizeProgress,
  tenses,
  type Mode,
  type Progress,
  type Question,
} from "../lib/conjugation.ts";
import { verbs } from "../data/french-verbs.ts";

type Pending = {
  id: string;
  verb: string;
  tense: Progress["tense"];
  correct: boolean;
};
const allowedEmail = "qianzihanduo@gmail.com";
const el = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const text = (zh: string, en: string) =>
  document.documentElement.dataset.uiLanguage === "zh" ? zh : en;
const input = el<HTMLInputElement>("#conjugation-answer");
const next = el<HTMLButtonElement>("[data-next]");
const setup = el<HTMLFormElement>("[data-setup]");
const answerForm = el<HTMLFormElement>("[data-answer-form]");
let client: SupabaseClient;
let userId: string | null = null;
let epoch = 0;
let rows: Progress[] = [];
let round: Question[] = [];
let index = 0;
let roundCorrect = 0;
let answered = false;
let verdict = false;
let pending: Pending | null = null;
let saving = false;
let loading = false;
let ready = false;
let message: [string, string] = ["", ""];
let syncMessage: [string, string] = ["", ""];
let retryStored = true;
const pendingKey = (id: string) => `conjugation-pending:${id}`;

function say(zh: string, en: string) {
  message = [zh, en];
  el("[data-status]").textContent = text(...message);
}

function renderStats() {
  const stats = summarizeProgress(rows);
  const accuracy = (attempts: number, correct: number) =>
    attempts ? `${Math.round((correct / attempts) * 100)}%` : "—";
  el("[data-total-attempts]").textContent = String(stats.total.attempts);
  el("[data-total-accuracy]").textContent = accuracy(
    stats.total.attempts,
    stats.total.correct,
  );
  el("[data-round-score]").textContent = round.length
    ? `${roundCorrect} / ${roundLength}`
    : "—";
  el("[data-tense-stats]").replaceChildren(
    ...stats.byTense.map((tense) => {
      const row = document.createElement("div");
      row.className = "conjugation-tense-row";
      const name = document.createElement("span");
      name.textContent = text(tense.zh, tense.en);
      const detail = document.createElement("span");
      detail.textContent = tense.attempts
        ? `${tense.correct} / ${tense.attempts} · ${accuracy(tense.attempts, tense.correct)}`
        : text("尚未练习", "Not practiced yet");
      row.append(name, detail);
      return row;
    }),
  );
  el("[data-last-practiced]").textContent = stats.total.last
    ? text("最近练习：", "Last practiced: ") +
      new Date(stats.total.last).toLocaleString(document.documentElement.lang)
    : text(
        "完成第一题后，这里会记录你的进步。",
        "Your progress appears here after your first answer.",
      );
}

function renderQuestion() {
  const question = round[index];
  if (!question) return;
  const tense = tenses.find((item) => item.id === question.tense)!;
  el("[data-question-count]").textContent = text(
    `第 ${index + 1} / ${roundLength} 题`,
    `Question ${index + 1} of ${roundLength}`,
  );
  el("[data-question-tense]").textContent =
    `${text(tense.zh, tense.en)} · ${tense.fr}`;
  el("[data-verb]").textContent = question.verb.infinitive;
  el("[data-person]").textContent =
    `${question.tense === "subjonctif" ? "que " : ""}${pronouns[question.person]} …`;
  const needsAgreement =
    question.tense === "passe-compose" && question.verb.auxiliary === "être";
  el("[data-agreement]").textContent = needsAgreement
    ? text(
        "此题用 être；主语按阳性处理，nous / vous / ils 按复数处理。表示移动的动词按不及物用法。",
        "Use être with masculine agreement; nous / vous / ils are plural. Movement verbs use their intransitive meaning.",
      )
    : "";
  el<HTMLProgressElement>("[data-round-progress]").value =
    index + Number(answered);
  if (answered) {
    el("[data-verdict]").textContent = verdict
      ? text("答对了", "Correct")
      : text("再记一次", "Keep practicing");
    el("[data-standard-answer]").textContent =
      question.verb.forms[question.tense][question.person];
  }
  next.textContent =
    index === roundLength - 1
      ? text("查看本轮结果", "See round results")
      : text("下一题", "Next question");
}

function renderSync() {
  el("[data-sync-panel]").hidden = !pending;
  el("[data-sync-message]").textContent = text(...syncMessage);
  el<HTMLButtonElement>("[data-retry]").hidden = saving || !pending;
  next.disabled = saving || Boolean(pending);
  setup.querySelector<HTMLButtonElement>("button")!.disabled =
    !ready || Boolean(pending);
}

function showQuestion() {
  answered = false;
  input.value = "";
  input.disabled = false;
  el<HTMLButtonElement>("[data-check]").disabled = false;
  el("[data-feedback]").hidden = true;
  next.hidden = true;
  renderQuestion();
  input.focus();
}

function readPending(id: string): Pending | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(pendingKey(id)) ?? "null");
    if (
      value &&
      typeof value.id === "string" &&
      /^[0-9a-f-]{36}$/i.test(value.id) &&
      verbs.some((verb) => verb.infinitive === value.verb) &&
      tenses.some((tense) => tense.id === value.tense) &&
      typeof value.correct === "boolean"
    )
      return value;
  } catch {
    /* Storage may be unavailable; in-memory retries still work. */
  }
  return null;
}

async function syncPending() {
  if (!pending || saving || !userId) return;
  const attempt = pending;
  const requestEpoch = epoch;
  const owner = userId;
  saving = true;
  syncMessage = ["正在同步进度…", "Syncing progress…"];
  renderSync();
  try {
    const { data, error } = await client.rpc("record_conjugation_answer", {
      p_attempt_id: attempt.id,
      p_verb: attempt.verb,
      p_tense: attempt.tense,
      p_correct: attempt.correct,
    });
    if (requestEpoch !== epoch) return;
    if (error || !data?.[0]) throw error ?? new Error("Missing progress");
    const updated = data[0] as Progress;
    rows = rows.filter(
      (row) => row.verb !== updated.verb || row.tense !== updated.tense,
    );
    rows.push(updated);
    pending = null;
    try {
      sessionStorage.removeItem(pendingKey(owner));
    } catch {
      /* Optional retry storage. */
    }
    renderStats();
    say("练习进度已同步。", "Practice progress synced.");
  } catch {
    if (requestEpoch !== epoch) return;
    syncMessage = retryStored
      ? [
          "本题尚未确认同步，请重试后继续。刷新页面后也可重试。",
          "This answer has not been confirmed as synced. Retry to continue; you can also retry after refreshing.",
        ]
      : [
          "本题尚未确认同步，请在当前页面重试。浏览器未能保存待同步请求，刷新会丢失这次请求。",
          "This answer has not been confirmed as synced. Retry on this page; browser storage is unavailable, so refreshing would lose the pending request.",
        ];
  } finally {
    if (requestEpoch === epoch) {
      saving = false;
      renderSync();
      if (!pending && round[index] && answered) next.focus();
    }
  }
}

async function loadProgress() {
  if (!userId || loading) return;
  const requestEpoch = epoch;
  loading = true;
  ready = false;
  el("[data-load-panel]").hidden = false;
  el("[data-practice-panel]").hidden = true;
  el("[data-reload]").hidden = true;
  el("[data-load-message]").textContent = text(
    "正在加载练习进度…",
    "Loading practice progress…",
  );
  try {
    const { data, error } = await client
      .from("conjugation_progress")
      .select("verb, tense, attempts, correct, last_practiced_at")
      .eq("user_id", userId);
    if (requestEpoch !== epoch) return;
    if (error) throw error;
    rows = (data ?? []) as Progress[];
    ready = true;
    el("[data-load-panel]").hidden = true;
    el("[data-practice-panel]").hidden = false;
    renderStats();
    renderSync();
    await syncPending();
  } catch {
    if (requestEpoch !== epoch) return;
    el("[data-load-message]").textContent = text(
      "无法加载练习进度，请检查网络连接及数据库配置。",
      "Couldn't load progress. Check your connection and database setup.",
    );
    el("[data-reload]").hidden = false;
  } finally {
    if (requestEpoch === epoch) loading = false;
  }
}

function showSession(session: Session | null) {
  const authorized = session?.user.email?.toLowerCase() === allowedEmail;
  const id = authorized ? session!.user.id : null;
  el("[data-login-panel]").hidden = Boolean(id);
  el("[data-app-panel]").hidden = !id;
  if (userId === id) {
    if (session && !authorized) void client.auth.signOut();
    return;
  }
  epoch++;
  userId = id;
  ready = false;
  loading = false;
  saving = false;
  rows = [];
  round = [];
  pending = id ? readPending(id) : null;
  retryStored = true;
  answered = false;
  index = 0;
  roundCorrect = 0;
  el("[data-question]").hidden = true;
  el("[data-summary]").hidden = true;
  setup.hidden = false;
  say("", "");
  renderStats();
  if (!id) {
    el("[data-user-email]").textContent = "";
    if (session) void client.auth.signOut();
    return;
  }
  el("[data-user-email]").textContent = session!.user.email!;
  void loadProgress();
}

setup.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!ready || pending || !userId) return;
  round = createRound(el<HTMLSelectElement>("#tense-mode").value as Mode);
  index = 0;
  roundCorrect = 0;
  setup.hidden = true;
  el("[data-summary]").hidden = true;
  el("[data-question]").hidden = false;
  say("", "");
  renderStats();
  showQuestion();
});

answerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (
    !ready ||
    !userId ||
    answered ||
    pending ||
    !round[index] ||
    !input.value.trim()
  )
    return;
  answered = true;
  verdict = checkAnswer(round[index], input.value);
  if (verdict) roundCorrect++;
  input.disabled = true;
  el<HTMLButtonElement>("[data-check]").disabled = true;
  el("[data-feedback]").hidden = false;
  el("[data-feedback]").dataset.correct = String(verdict);
  next.hidden = false;
  pending = {
    id: crypto.randomUUID(),
    verb: round[index].verb.infinitive,
    tense: round[index].tense,
    correct: verdict,
  };
  retryStored = false;
  try {
    sessionStorage.setItem(pendingKey(userId), JSON.stringify(pending));
    retryStored = true;
  } catch {
    /* Keep in-memory retry available. */
  }
  renderQuestion();
  renderStats();
  void syncPending();
});

next.addEventListener("click", () => {
  if (!answered || pending || saving) return;
  index++;
  if (index < roundLength) return showQuestion();
  el("[data-question]").hidden = true;
  el("[data-summary]").hidden = false;
  el("[data-summary-score]").textContent = text(
    `${roundCorrect} / ${roundLength} 题答对`,
    `${roundCorrect} of ${roundLength} correct`,
  );
  setup.hidden = false;
  el("[data-summary]").focus();
});
el("[data-retry]").addEventListener("click", () => void syncPending());
el("[data-reload]").addEventListener("click", () => void loadProgress());

el<HTMLFormElement>("[data-login-form]").addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const button = form.querySelector<HTMLButtonElement>("button")!;
    if (button.disabled) return;
    const email = String(new FormData(form).get("email") ?? "")
      .trim()
      .toLowerCase();
    if (email !== allowedEmail)
      return say(
        "这个邮箱没有背词账号权限。",
        "This email is not authorized for vocabulary access.",
      );
    button.disabled = true;
    try {
      const { error } = await client.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/vocabulary/conjugation/`,
        },
      });
      if (error) throw error;
      say(
        "登录链接已发送，请查收邮箱。",
        "Sign-in link sent. Check your email.",
      );
    } catch {
      say(
        "发送失败，请稍后重试。",
        "Couldn't send the sign-in link. Please try again.",
      );
    } finally {
      button.disabled = false;
    }
  },
);

el<HTMLButtonElement>("[data-sign-out]").addEventListener(
  "click",
  async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    try {
      const { error } = await client.auth.signOut();
      if (error) throw error;
      showSession(null);
    } catch {
      say("退出失败，请重试。", "Couldn't sign out. Please try again.");
    } finally {
      button.disabled = false;
    }
  },
);

document.addEventListener("ui-language-change", () => {
  renderStats();
  renderQuestion();
  renderSync();
  el("[data-status]").textContent = text(...message);
  if (loading)
    el("[data-load-message]").textContent = text(
      "正在加载练习进度…",
      "Loading practice progress…",
    );
  else if (!ready)
    el("[data-load-message]").textContent = text(
      "无法加载练习进度，请检查网络连接及数据库配置。",
      "Couldn't load progress. Check your connection and database setup.",
    );
  if (index === roundLength)
    el("[data-summary-score]").textContent = text(
      `${roundCorrect} / ${roundLength} 题答对`,
      `${roundCorrect} of ${roundLength} correct`,
    );
});

const url = import.meta.env.PUBLIC_SUPABASE_URL;
const key = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) el("[data-config-warning]").hidden = false;
else {
  client = createClient(url, key);
  // Defer work outside the auth callback's lock before loading or signing out.
  client.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => showSession(session), 0);
  });
  void client.auth
    .getSession()
    .then(({ data, error }) => {
      if (error)
        say(
          "登录状态加载失败，请重新登录。",
          "Couldn't restore your session. Please sign in again.",
        );
      showSession(data.session);
    })
    .catch(() => {
      showSession(null);
      say(
        "登录状态加载失败，请重新登录。",
        "Couldn't restore your session. Please sign in again.",
      );
    });
}
