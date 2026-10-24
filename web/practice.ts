import {
  practiceExercises,
  practiceExercise,
  PRACTICE_LIMITS,
  type PracticeCaseResult,
  type PracticeExercise,
} from "../core/practice";
import type { DialectId } from "../core/dialects";
import { createSettings } from "./storage";
import "./practice.css";

export interface PracticeHost {
  container: HTMLElement;
  readSource(): string;
  writeSource(source: string): void;
  readDialect?(): DialectId;
  captureEnvironment?(): unknown;
  restoreEnvironment?(environment: unknown): void;
  applyDialect(
    id: DialectId,
    options: { strictness: "exam"; guideVersion?: "2026" },
  ): void;
  examActive(): boolean;
  settings?: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): boolean | void;
  };
  focusEditor?(): void;
}
interface Attempt {
  at: number;
  source: string;
  score: number;
  results: PracticeCaseResult[];
}
interface Draft {
  source: string;
  history: Attempt[];
}
interface Saved {
  version: 1;
  selected: string;
  active?: string;
  drafts: Record<string, Draft>;
  previous?: { source: string; dialect?: DialectId; environment?: unknown };
}
const STORAGE_KEY = "pseudo-practice-v1";
const node = <T extends keyof HTMLElementTagNameMap>(
  tag: T,
  text = "",
  className = "",
) => {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
};

export function mountPractice(host: PracticeHost) {
  let storageFailed = false,
    saving: ReturnType<typeof setTimeout> | undefined;
  const storage =
    host.settings ||
    createSettings(
      () => localStorage,
      () => {
        storageFailed = true;
      },
    );
  let state: Saved = {
    version: 1,
    selected: practiceExercises[0].id,
    drafts: Object.create(null),
  };
  try {
    const stored = JSON.parse(storage.getItem(STORAGE_KEY) || "null");
    if (stored?.version === 1) {
      if (practiceExercise(stored.selected)) state.selected = stored.selected;
      if (practiceExercise(stored.active)) state.active = stored.active;
      if (typeof stored.previous?.source === "string")
        state.previous = stored.previous;
      for (const exercise of practiceExercises) {
        const draft = stored.drafts?.[exercise.id];
        if (typeof draft?.source !== "string") continue;
        state.drafts[exercise.id] = {
          source: draft.source,
          history: Array.isArray(draft.history)
            ? draft.history
                .filter(
                  (a: Attempt) =>
                    typeof a?.source === "string" &&
                    Number.isFinite(a.at) &&
                    Number.isFinite(a.score) &&
                    Array.isArray(a.results),
                )
                .slice(-5)
            : [],
        };
      }
      if (
        state.active &&
        !host.examActive() &&
        state.drafts[state.active]?.source !== host.readSource()
      )
        state.active = undefined;
    }
  } catch {
    /* A corrupt optional practice record does not affect the editor. */
  }
  let worker: Worker | undefined,
    deadline: ReturnType<typeof setTimeout> | undefined;
  let token = 0,
    running = false,
    gradingSource = "",
    gradingId = "",
    results: PracticeCaseResult[] = [];
  let destroyed = false,
    busyMessage = "";
  const panel = node("section", "", "practice-panel");
  panel.setAttribute("aria-label", "原创练习与自动判分");
  const intro = node(
    "p",
    "10 道原创练习 · 在编辑器作答，提交后在独立运行环境中测试。每题 100 分，允许部分得分。",
    "practice-intro",
  );
  const controls = node("div", "", "practice-controls");
  const selectLabel = node("label", "选择练习 ");
  const select = node("select");
  select.id = "practice-select";
  for (const e of practiceExercises) {
    const option = node("option", `${e.title} · ${e.dialect}`);
    option.value = e.id;
    select.append(option);
  }
  select.value = state.selected;
  selectLabel.append(select);
  const load = node("button", "开始作答");
  load.id = "practice-load";
  load.type = "button";
  const submit = node("button", "提交判分");
  submit.id = "practice-submit";
  submit.type = "button";
  const cancel = node("button", "取消判分");
  cancel.id = "practice-cancel";
  cancel.type = "button";
  const redo = node("button", "重做（保留成绩）");
  redo.id = "practice-redo";
  redo.type = "button";
  const restore = node("button", "返回进入练习前的源码");
  restore.id = "practice-return";
  restore.type = "button";
  controls.append(selectLabel, load, submit, cancel, redo, restore);
  const notice = node("p", "", "practice-notice");
  notice.id = "practice-status";
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  const storageNotice = node("p", "", "practice-storage-warning");
  storageNotice.hidden = true;
  const content = node("div", "", "practice-content");
  const report = node("div", "", "practice-results");
  report.id = "practice-results";
  const history = node("div", "", "practice-history");
  history.id = "practice-history";
  const limits = node(
    "p",
    "计分只依据功能测试，不等同于官方评分。判分固定题目方言、严格模式、Guide 2026 和默认语义策略。仅忽略每行末尾空格与换行编码；空行和大小写有意义。本批题目全部使用整数或字符串，没有小数容差。其他输入/输出不得添加提示语。每例最多 50,000 指令、100 次输出、16,000 输出字符；单例墙钟上限 4 秒（Worker 启动另有 4 秒上限），可以随时取消。",
    "practice-footnote",
  );
  const privacy = node(
    "p",
    "所有数据保存在当前浏览器。非公开检查不在界面显示输入和预期输出，但随前端代码交付，可被查看；它们用于练习，不提供防作弊或保密保证。提交不会使用或改动 IDE 终端输入、虚拟文件和运行结果。",
    "practice-footnote",
  );
  panel.append(
    intro,
    controls,
    notice,
    storageNotice,
    content,
    report,
    history,
    limits,
    privacy,
  );
  host.container.replaceChildren(panel);

  function persist() {
    clearTimeout(saving);
    try {
      if (storage.setItem(STORAGE_KEY, JSON.stringify(state)) === false)
        storageFailed = true;
    } catch {
      storageFailed = true;
    }
    storageNotice.hidden = !storageFailed;
    storageNotice.textContent =
      "浏览器存储不可用或已满，练习草稿和成绩仅在当前会话保留。请下载源码备份。";
  }
  function saveCurrent() {
    if (state.active && !host.examActive()) {
      const draft = (state.drafts[state.active] ||= {
        source: host.readSource(),
        history: [],
      });
      draft.source = host.readSource();
    }
  }
  function selected(): PracticeExercise {
    return practiceExercise(state.selected)!;
  }
  function stop(message = "") {
    token++;
    clearTimeout(deadline);
    worker?.terminate();
    worker = undefined;
    running = false;
    if (message) busyMessage = message;
  }
  function updateControls() {
    const exam = host.examActive(),
      loaded = state.active === state.selected;
    select.disabled = exam;
    load.disabled = exam || running;
    load.textContent = loaded
      ? "答卷已在编辑器"
      : state.drafts[state.selected]
        ? "继续作答"
        : "开始作答";
    submit.disabled = exam || running || !loaded;
    cancel.hidden = !running;
    redo.disabled = exam || running || !state.drafts[state.selected];
    restore.hidden = !state.previous;
    restore.disabled = exam || running;
    notice.textContent = exam
      ? "考试进行中，练习选题与判分已锁定。"
      : busyMessage ||
        (loaded
          ? "当前题目已加载。可用普通运行手动输入样例，或提交自动判分。"
          : "选择题目后点击“开始作答 / 继续作答”。加载前的源码会单独保留，可返回原稿。");
  }
  function renderContent() {
    const e = selected();
    content.replaceChildren();
    content.append(
      node("h3", e.title),
      node(
        "p",
        `${e.dialect} · Guide 2026（AS）/ 2026–2028（0478） · 建议 ${e.minutes} 分钟 · ${e.topics.join(" / ")}`,
        "practice-meta",
      ),
      node("p", e.statement),
    );
    content.append(
      node("h4", "输入契约"),
      node("p", e.inputContract),
      node("h4", "输出契约"),
      node("p", e.outputContract),
    );
    const samples = node("div", "", "practice-samples");
    e.cases
      .filter((check) => check.public)
      .forEach((check, index) => {
        const sample = node("div", "", "practice-sample");
        sample.append(
          node("h4", `公开样例 ${index + 1}`),
          node("p", "输入（每次 INPUT 一行）："),
          node(
            "pre",
            check.input
              .map((value) => (value === "" ? "（空行）" : value))
              .join("\n"),
          ),
          node("p", "预期输出（每次 OUTPUT 一行）："),
          node("pre", check.output.join("\n")),
        );
        samples.append(sample);
      });
    content.append(samples);
  }
  function renderResults() {
    report.replaceChildren();
    history.replaceChildren();
    const draft = state.drafts[state.selected],
      latest = draft?.history.at(-1);
    if (latest) {
      const current =
        state.active === state.selected && latest.source === host.readSource();
      const title = node(
        "h3",
        `${current ? "当前答卷" : "最近一次提交（源码已不同）"}：${latest.score} / 100`,
      );
      title.id = "practice-score";
      report.append(title);
      if (!current)
        report.append(
          node(
            "p",
            "当前源码与这次提交不同，请重新提交后再判断当前答卷。",
            "practice-stale",
          ),
        );
      const list = node("ol");
      latest.results.forEach((result, i) => {
        const item = node(
          "li",
          `${result.passed ? "✓" : "✗"} ${result.score} / ${result.maxScore} 分 · ${result.feedback}`,
          result.passed ? "practice-pass" : "practice-fail",
        );
        if (selected().cases[i]?.public && result.actual) {
          const actual = node("details");
          actual.append(
            node("summary", "查看这组公开样例的实际输出"),
            node(
              "pre",
              result.actual.length ? result.actual.join("\n") : "（没有输出）",
            ),
          );
          item.append(actual);
        }
        list.append(item);
      });
      report.append(list);
    }
    if (draft?.history.length) {
      history.append(node("h4", "提交历史（最近 5 次）"));
      [...draft.history].reverse().forEach((attempt, reverseIndex) => {
        const row = node("div", "", "practice-history-row");
        row.append(
          node(
            "span",
            `${new Date(attempt.at).toLocaleString("zh-CN")} · ${attempt.score} / 100`,
          ),
        );
        const button = node("button", "恢复此答卷");
        button.type = "button";
        button.disabled = host.examActive() || running;
        button.dataset.practiceRestore = String(
          draft.history.length - reverseIndex - 1,
        );
        button.onclick = () => {
          if (host.examActive() || running) return;
          saveCurrent();
          if (
            state.active === state.selected &&
            host.readSource() !== attempt.source &&
            !confirm("恢复历史答卷会替换当前草稿，是否继续？")
          )
            return;
          activate(attempt.source);
          busyMessage =
            "已恢复历史答卷。历史成绩仍属于原提交；可修改后重新判分。";
          refresh();
        };
        row.append(button);
        history.append(row);
      });
    }
  }
  function refresh() {
    if (destroyed) return;
    if (host.examActive() && running) stop("已取消判分：考试已开始。");
    updateControls();
    renderResults();
  }
  function activate(source: string) {
    if (host.examActive()) return;
    stop();
    if (!state.previous)
      state.previous = {
        source: host.readSource(),
        dialect: host.readDialect?.(),
        environment: host.captureEnvironment?.(),
      };
    state.active = state.selected;
    const draft = (state.drafts[state.selected] ||= { source, history: [] });
    draft.source = source;
    host.applyDialect(selected().dialect, {
      strictness: "exam",
      guideVersion: "2026",
    });
    host.writeSource(source);
    persist();
    host.focusEditor?.();
  }
  select.onchange = () => {
    if (host.examActive()) {
      select.value = state.selected;
      return;
    }
    saveCurrent();
    stop();
    busyMessage = "";
    state.selected = select.value;
    persist();
    renderContent();
    refresh();
  };
  load.onclick = () => {
    if (host.examActive() || running) return;
    if (state.active !== state.selected) {
      saveCurrent();
      activate(state.drafts[state.selected]?.source ?? selected().starter);
    }
    busyMessage = "当前题目已加载到编辑器。编辑后点击“提交判分”。";
    refresh();
  };
  redo.onclick = () => {
    if (host.examActive() || running) return;
    if (
      !confirm(
        "重做会用起始代码替换此题草稿。已提交的最近 5 次成绩和答卷会保留，是否继续？",
      )
    )
      return;
    saveCurrent();
    activate(selected().starter);
    busyMessage = "已开始重做。历史提交保留在下方。";
    refresh();
  };
  restore.onclick = () => {
    if (host.examActive() || running || !state.previous) return;
    saveCurrent();
    const previous = state.previous;
    state.active = undefined;
    state.previous = undefined;
    if (previous.environment !== undefined && host.restoreEnvironment)
      host.restoreEnvironment(previous.environment);
    else if (previous.dialect)
      host.applyDialect(previous.dialect, {
        strictness: "exam",
        guideVersion: "2026",
      });
    host.writeSource(previous.source);
    persist();
    busyMessage = "已返回原稿。各题草稿和历史成绩仍已保留。";
    refresh();
    host.focusEditor?.();
  };
  function finish() {
    if (
      state.active !== gradingId ||
      state.selected !== gradingId ||
      host.readSource() !== gradingSource ||
      host.examActive()
    ) {
      stop("源码或题目已变化，丢弃本次判分。");
      refresh();
      return;
    }
    const draft = state.drafts[gradingId];
    draft.history.push({
      at: Date.now(),
      source: gradingSource,
      score: results.reduce((score, r) => score + r.score, 0),
      results: [...results],
    });
    draft.history = draft.history.slice(-5);
    draft.source = gradingSource;
    const score = draft.history.at(-1)!.score;
    stop();
    busyMessage =
      score === 100
        ? "100 / 100：全部测试通过。可以重做巩固，或选择下一题。"
        : `${score} / 100：已按测试点给出部分得分，查看下方中文反馈后修改再提交。`;
    persist();
    refresh();
  }
  submit.onclick = () => {
    if (host.examActive() || running || state.active !== state.selected) return;
    saveCurrent();
    persist();
    if (host.readSource().length > PRACTICE_LIMITS.source) {
      busyMessage =
        "练习判分限 200,000 字符；请缩短答卷。编辑器内的原稿没有更改。";
      refresh();
      return;
    }
    stop();
    running = true;
    gradingSource = host.readSource();
    gradingId = state.selected;
    results = [];
    const currentToken = token,
      exercise = selected();
    busyMessage = "准备独立判分环境…";
    refresh();
    try {
      worker = new Worker(new URL("./grading.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      stop("无法启动判分 Worker，请检查浏览器是否允许 Worker 后重试。");
      refresh();
      return;
    }
    const send = () => {
      if (!running || token !== currentToken) return;
      busyMessage = `正在判分 ${results.length + 1} / ${exercise.cases.length}，可随时取消…`;
      updateControls();
      clearTimeout(deadline);
      deadline = setTimeout(() => {
        if (token !== currentToken) return;
        const first = results.length;
        for (let i = first; i < exercise.cases.length; i++)
          results.push({
            index: i,
            passed: false,
            score: 0,
            maxScore: exercise.cases[i].points,
            code: i === first ? "TIMEOUT" : "NOT_RUN",
            feedback:
              i === first
                ? "执行超过 4 秒，已终止 Worker。请检查循环或简化程序。"
                : "因前一测试超时，本测试未执行；修正后重新提交。",
          });
        finish();
      }, PRACTICE_LIMITS.wallMs);
      worker!.postMessage({
        type: "case",
        token: currentToken,
        exerciseId: gradingId,
        source: gradingSource,
        index: results.length,
      });
    };
    // Startup is included in a bounded timeout, including malformed source that blocks parsing.
    deadline = setTimeout(() => {
      if (currentToken === token) {
        stop("判分环境启动超过 4 秒，已取消。本次未保存成绩，可重试。");
        refresh();
      }
    }, PRACTICE_LIMITS.wallMs);
    worker.onmessage = ({ data }) => {
      if (currentToken !== token || !running) return;
      if (data.type === "ready") send();
      else if (
        data.type === "result" &&
        data.token === currentToken &&
        data.result.index === results.length
      ) {
        clearTimeout(deadline);
        results.push(data.result);
        if (results.length === exercise.cases.length) finish();
        else send();
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      if (currentToken === token) {
        stop("判分环境发生错误，本次未保存成绩。请重试或下载源码。");
        refresh();
      }
    };
  };
  cancel.onclick = () => {
    stop("已取消判分，当前草稿保留，本次未保存成绩。");
    refresh();
  };
  function sourceChanged() {
    if (destroyed) return;
    // Exam editing uses the same editor but must never overwrite a practice draft.
    if (host.examActive()) {
      if (running) stop("已取消判分：考试已开始。");
      refresh();
      return;
    }
    if (running && host.readSource() !== gradingSource)
      stop("源码已修改，旧判分已取消；请重新提交。");
    saveCurrent();
    clearTimeout(saving);
    saving = setTimeout(persist, 400);
    refresh();
  }
  const beforeLeave = () => {
    saveCurrent();
    persist();
  };
  addEventListener("pagehide", beforeLeave);
  renderContent();
  refresh();
  return {
    sourceChanged,
    refresh,
    destroy() {
      beforeLeave();
      stop();
      destroyed = true;
      removeEventListener("pagehide", beforeLeave);
    },
  };
}
