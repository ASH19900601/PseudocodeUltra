import { builtinSignature, signatureText } from "../core/builtins";
import {
  EXAM_ARCHIVE_KEY,
  EXAM_SESSION_KEY,
  examClock,
  examRules,
  expireExam,
  exportExamAnswer,
  parseExamSession,
  startExam,
  submitExam,
  type ExamEnvironment,
  type ExamSession,
  type ExamStartOptions,
} from "../core/exam";
import { createSettings } from "./storage";
import "./exam.css";

export type {
  ExamEnvironment,
  ExamSession,
  ExamStartOptions,
} from "../core/exam";
export interface ExamHost {
  getSource(): string;
  setSource(source: string): void;
  getConfig(): ExamEnvironment;
  applyConfig(config: ExamEnvironment): void;
  stopExecution(): void;
  /** Called on entry, restore, submission, expiry and exit; answer edits do not reconfigure the editor. */
  onStateChange(state: ExamSession | null): void;
  settings?: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): boolean | void;
    readonly persistent?: boolean;
  };
  now?: () => number;
}
export function createExamController(host: ExamHost) {
  const settings = host.settings ?? createSettings();
  const now = host.now ?? Date.now;
  let session = parseExamSession(settings.getItem(EXAM_SESSION_KEY));
  if (session?.status === "ended") session = null;
  let archived = parseExamSession(settings.getItem(EXAM_ARCHIVE_KEY));
  let applying = false;
  let saved = true;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const element = document.createElement("section");
  element.id = "exam-panel";
  element.className = "exam-panel";
  element.setAttribute("aria-label", "本地考试练习");
  element.innerHTML = `<details id="exam-details"><summary>考试练习 <span id="exam-summary"></span></summary>
    <p class="exam-notice">本地模拟练习，不具备防作弊能力，也不代表官方考试或成绩。考试期间关闭学习辅助，规则与方言锁定。普通草稿单独保留。</p>
    <form id="exam-setup" class="exam-controls">
      <label>考试方言<select id="exam-dialect"><option>0478</option><option>2210</option><option>9618-AS</option><option>9618-A2</option></select></label>
      <label>Guide 版本<select id="exam-guide"><option>2026</option><option>2027–2029</option></select></label>
      <label>时长（分钟）<input id="exam-minutes" type="number" min="1" max="300" step="1" required value="45"></label>
      <label class="exam-copy-option"><input id="exam-copy-source" type="checkbox">以当前源码为起始代码</label>
      <button id="exam-start" class="primary" type="submit">开始考试</button>
    </form>
    <div id="exam-session" hidden>
      <div class="exam-controls"><strong id="exam-state" role="status" aria-live="polite"></strong><span id="exam-rules"></span>
        <span>剩余 <time id="exam-countdown" role="timer"></time></span><span id="exam-save-state" role="status"></span>
        <button id="exam-submit">提交答卷</button><button id="exam-download">下载答卷</button><button id="exam-record">下载记录</button><button id="exam-finish">结束并恢复草稿</button>
      </div><p id="exam-deadline"></p>
    </div>
    <p id="exam-message" role="status"></p>
    <div id="exam-archive" hidden><span id="exam-archive-status"></span> <button id="exam-archive-download">下载上次答卷</button> <button id="exam-archive-record">下载上次记录</button></div>
    <details id="exam-insert"><summary>Insert 函数与规则参考</summary><div id="exam-insert-content"></div></details>
  </details>`;
  const get = <T extends HTMLElement = HTMLElement>(id: string) =>
    element.querySelector<T>(`#${id}`)!;
  const escape = (value: unknown) =>
    String(value).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]!,
    );
  const statusLabel = (state: ExamSession) =>
    ({
      running: "考试进行中",
      submitted: "答卷已提交 · 只读",
      expired: "时间已到 · 答卷已锁定",
      ended: "已结束",
    })[state.status];
  function write() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
    }
    if (!session) return;
    session.savedAt = now();
    saved =
      settings.setItem(EXAM_SESSION_KEY, JSON.stringify(session)) !== false;
    get("exam-save-state").textContent =
      saved && settings.persistent !== false
        ? "答卷已保存本机"
        : "答卷未持久保存，请下载";
  }
  function insertReference() {
    const config = session?.config ?? {
      ...host.getConfig(),
      dialect: get<HTMLSelectElement>("exam-dialect")
        .value as ExamEnvironment["dialect"],
      guideVersion: get<HTMLSelectElement>("exam-guide")
        .value as ExamEnvironment["guideVersion"],
    };
    const rules = examRules(config);
    const operators =
      config.dialect === "0478" || config.dialect === "2210"
        ? "赋值 ←；比较 =、<>、<、<=、>、>=；逻辑 NOT、AND、OR；WHILE … DO；字符串位置从 1 开始。"
        : "赋值 ←；比较 =、<>、<、<=、>、>=；逻辑 NOT、AND、OR；整数运算 DIV、MOD；字符串位置从 1 开始。";
    get("exam-insert-content").innerHTML =
      `<p>本项目整理的函数与规则速查，并非官方原卷 Insert 的复本；展示本项目当前实现，本次未重新复核官方原文。</p><h3>${escape(rules.label)}</h3><p>${escape(operators)}</p><div class="exam-signatures">${rules.profile.builtins
        .map((name) => {
          const sig = builtinSignature(name, rules.profile);
          return sig
            ? `<p><code>${escape(signatureText(sig))}</code><small>${escape(sig.description)}</small></p>`
            : "";
        })
        .join(
          "",
        )}</div><details><summary>本次锁定的运行策略</summary><pre>${escape(JSON.stringify({ logicalPrecedence: config.logicalPrecedence, ...rules.policies, maxSteps: config.maxSteps, seed: config.seed }, null, 2))}</pre><p>以上包含项目运行策略，不全是官方规范。9618 Guide 选项不适用于 0478/2210，后者固定使用 2026–2028 v6。</p></details>`;
  }
  function updateSetupGuide() {
    const basic = ["0478", "2210"].includes(
      get<HTMLSelectElement>("exam-dialect").value,
    );
    get<HTMLSelectElement>("exam-guide").disabled = basic;
    insertReference();
  }
  function render() {
    get("exam-setup").hidden = !!session;
    get("exam-session").hidden = !session;
    get("exam-archive").hidden = !!session || !archived;
    get("exam-summary").textContent = session
      ? `· ${statusLabel(session)} · ${examClock(session.deadline, now())}`
      : "· 可配置倒计时与答卷";
    if (session) {
      get("exam-state").textContent = statusLabel(session);
      get("exam-rules").textContent = examRules(session.config).label;
      get("exam-countdown").textContent = examClock(session.deadline, now());
      get("exam-deadline").textContent =
        `开始：${new Date(session.startedAt).toLocaleString()}；截止：${new Date(session.deadline).toLocaleString()}。关闭页面、切换标签或休眠不会暂停倒计时。`;
      get<HTMLButtonElement>("exam-submit").disabled =
        session.status !== "running";
    }
    if (archived)
      get("exam-archive-status").textContent =
        `上次答卷 · ${statusLabel(archived)} · ${new Date(archived.startedAt).toLocaleString()}`;
    insertReference();
  }
  function applySession() {
    if (!session) return;
    applying = true;
    try {
      host.stopExecution();
      // Route editor writes to the exam store before replacing the visible document.
      host.onStateChange(session);
      host.applyConfig(structuredClone(session.config));
      host.setSource(session.answer);
    } finally {
      applying = false;
    }
    get<HTMLDetailsElement>("exam-details").open = true;
    render();
  }
  function start(options: ExamStartOptions) {
    if (session) throw new Error("请先结束当前考试");
    session = startExam(host.getSource(), host.getConfig(), options, now());
    write();
    get("exam-message").textContent =
      "已开始考试。规则锁定，Insert 参考可在下方查看。";
    applySession();
    return session;
  }
  function tick() {
    if (!session) return;
    const next = expireExam(session, now());
    if (next !== session) {
      session = next;
      host.stopExecution();
      host.onStateChange(session);
      write();
      render();
      get("exam-message").textContent =
        "考试时间已到。答卷已锁定，可下载或结束并恢复普通草稿。";
    }
    get("exam-countdown").textContent = examClock(session.deadline, now());
    // The summary remains visible when the panel is folded; it is intentionally not aria-live.
    get("exam-summary").textContent =
      `· ${statusLabel(session)} · ${examClock(session.deadline, now())}`;
  }
  function sourceChanged() {
    if (!session || applying) return;
    tick();
    if (session.status !== "running") {
      if (host.getSource() !== session.answer) host.setSource(session.answer);
      return;
    }
    session.answer = host.getSource();
    get("exam-save-state").textContent = "答卷保存中…";
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(write, 350);
  }
  function submit() {
    if (!session) return;
    tick();
    if (session.status !== "running") return session;
    session.answer = host.getSource();
    session = submitExam(session, now());
    host.stopExecution();
    host.onStateChange(session);
    write();
    render();
    get("exam-message").textContent =
      "答卷已提交并锁定。此处保存本地答卷，不进行官方评分。";
    return session;
  }
  function finish() {
    if (!session) return;
    tick();
    if (session.status === "running") {
      session.answer = host.getSource();
      session = {
        ...session,
        status: "ended",
        completedAt: now(),
        savedAt: now(),
      };
    }
    write();
    archived = session;
    const archiveSaved =
      settings.setItem(EXAM_ARCHIVE_KEY, JSON.stringify(session)) !== false;
    const normalSource = session.normalSource,
      normalConfig = structuredClone(session.normalConfig);
    settings.setItem(EXAM_SESSION_KEY, "null");
    session = null;
    applying = true;
    try {
      host.stopExecution();
      host.onStateChange(null);
      host.applyConfig(normalConfig);
      host.setSource(normalSource);
    } finally {
      applying = false;
    }
    get<HTMLSelectElement>("exam-dialect").value = normalConfig.dialect;
    get<HTMLSelectElement>("exam-guide").value = normalConfig.guideVersion;
    updateSetupGuide();
    render();
    get("exam-message").textContent =
      archiveSaved && settings.persistent !== false
        ? "已恢复普通草稿与设置。上次答卷保留在本机，可下载备份。"
        : "已恢复普通草稿与设置。上次答卷未持久保存，请立即下载备份。";
  }
  function download(state: ExamSession | null, record = false) {
    if (!state) return;
    if (state === session) {
      tick();
      write();
      state = session;
    }
    if (!state) return;
    const blob = new Blob([record ? exportExamAnswer(state) : state.answer], {
      type: record
        ? "application/json;charset=utf-8"
        : "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `${state.id}.${record ? "json" : "pseudo"}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  get<HTMLFormElement>("exam-setup").onsubmit = (event) => {
    event.preventDefault();
    try {
      start({
        dialect: get<HTMLSelectElement>("exam-dialect")
          .value as ExamStartOptions["dialect"],
        guideVersion: get<HTMLSelectElement>("exam-guide")
          .value as ExamStartOptions["guideVersion"],
        minutes: Number(get<HTMLInputElement>("exam-minutes").value),
        initialSource: get<HTMLInputElement>("exam-copy-source").checked
          ? host.getSource()
          : "",
      });
    } catch (error) {
      get("exam-message").textContent = String((error as Error).message);
    }
  };
  get("exam-submit").onclick = () => submit();
  get("exam-finish").onclick = () => {
    if (
      session?.status === "running" &&
      !confirm("结束本次考试并恢复普通草稿？当前答卷会保留为上次答卷。")
    )
      return;
    finish();
  };
  get("exam-download").onclick = () => download(session);
  get("exam-record").onclick = () => download(session, true);
  get("exam-archive-download").onclick = () => download(archived);
  get("exam-archive-record").onclick = () => download(archived, true);
  get("exam-dialect").onchange = updateSetupGuide;
  get("exam-guide").onchange = insertReference;
  get<HTMLSelectElement>("exam-dialect").value = host.getConfig().dialect;
  get<HTMLSelectElement>("exam-guide").value = host.getConfig().guideVersion;
  updateSetupGuide();
  if (session) {
    session = expireExam(session, now());
    write();
    applySession();
  } else render();
  const timer = setInterval(tick, 250);
  const flush = () => {
    tick();
    write();
  };
  window.addEventListener("beforeunload", flush);
  const visibility = () => {
    tick();
    if (document.hidden) write();
  };
  document.addEventListener("visibilitychange", visibility);
  return {
    element,
    get state() {
      return session;
    },
    get active() {
      return !!session;
    },
    get locked() {
      return !!session && session.status !== "running";
    },
    start,
    sourceChanged,
    tick,
    submit,
    finish,
    destroy() {
      flush();
      clearInterval(timer);
      if (saveTimer) clearTimeout(saveTimer);
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", visibility);
    },
  };
}
