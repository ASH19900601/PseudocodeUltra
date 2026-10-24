import { EditorView, basicSetup, minimalSetup } from "codemirror";
import {
  EditorState,
  Compartment,
  StateEffect,
  StateField,
  RangeSetBuilder,
  Transaction,
} from "@codemirror/state";
import {
  keymap,
  lineNumbers,
  hoverTooltip,
  Decoration,
  type DecorationSet,
  gutter,
  GutterMarker,
} from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import {
  StreamLanguage,
  indentUnit,
  foldService,
  syntaxHighlighting,
  HighlightStyle,
  defaultHighlightStyle,
} from "@codemirror/language";
import {
  autocompletion,
  snippetCompletion,
  type Completion,
} from "@codemirror/autocomplete";
import { tags } from "@lezer/highlight";
import { linter, forceLinting, setDiagnostics } from "@codemirror/lint";
import {
  profile,
  signatures,
  type DialectId,
  type Diagnostic,
} from "../core/dialects";
import { keywords, lex } from "../core/lexer";
import {
  WorkerRequestController,
  type AnalysisState,
} from "./analysis-controller";
import {
  completionKeywords,
  signatureHelp,
  type UserSignature,
  type LanguageCompletion,
  type Definition,
} from "../core/language";
import { builtinSignature, signatureText } from "../core/builtins";
import {
  traceRows,
  csv,
  xlsx,
  gradeTrace,
  type TraceOptions,
} from "../core/trace";
import { printSource } from "./print";
import { parse } from "../core/parser";
import { format, traceCSV, flowchart } from "../core/tools";
import type { Target } from "../core/transpile";
import type { Event, VirtualFile } from "../core/runtime";
import {
  loadFiles,
  saveFiles,
  createSettings,
  settingChoice,
  settingInteger,
  storedPolicies,
  exportFiles,
  importFiles,
} from "./storage";
import { examples } from "./examples";
import {
  createExamController,
  type ExamSession,
  type ExamEnvironment,
} from "./exam";
import { validConfig } from "../core/exam";
import { mountPractice } from "./practice";
import { defaultPolicies } from "../core/policies";
import "./style.css";
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const settings = createSettings(undefined, () =>
  queueMicrotask(() => {
    $("storage-warning").hidden = false;
    $("save-state").textContent = "未保存 · 请下载";
  }),
);
let language: DialectId = settingChoice(
  settings.getItem("dialect"),
  ["0478", "2210", "9618-AS", "9618-A2"],
  "0478",
);
let filesReady = false;
let examMode = false,
  examLocked = false;
let examFiles: Record<string, VirtualFile> = {};
let examController: ReturnType<typeof createExamController> | undefined;
let practiceController: ReturnType<typeof mountPractice> | undefined;
let sourceName = settings.getItem("sourceName") || "main.pseudo";
let runMode = settingChoice(
  settings.getItem("runMode"),
  ["manual", "change", "blur"],
  "manual",
);
let autoRunTimer: ReturnType<typeof setTimeout> | undefined;
let converted = "";
const watches = new Set<string>();
const watchValues = new Map<string, string>();
const attempts: Record<string, string> = {};
const tracePageSize = 200;
let tracePage = 0;
let worker: Worker | undefined,
  busy = false,
  paused = false,
  trace: Event[] = [],
  files: Record<string, VirtualFile> = {},
  breakpoints = new Set<number>(),
  activeLine = 0,
  lastEvent: Event | undefined,
  tab = "console";
let guideVersion = settingChoice(
  settings.getItem("guideVersion"),
  ["2026", "2027–2029"],
  "2026",
);
let strictness = settingChoice(
  settings.getItem("strictness"),
  ["exam", "learning", "lenient"],
  "exam",
);
let fastBusy = false;
const currentProfile = () =>
  profile(language, {
    guideVersion,
    strictness,
    styleChecks: settings.getItem("styleChecks") === "true",
    logicalPrecedence: settingChoice(
      settings.getItem("logicalPrecedence"),
      ["standard", "leftToRight"] as const,
      "standard",
    ),
  });
let policyState = storedPolicies(settings.getItem("policies"));
const maxSteps = () =>
  settingInteger(settings.getItem("maxSteps"), 100000, 1, 1000000000);
const randomSeed = () =>
  settingInteger(settings.getItem("seed"), 42, 0, 4294967295);
let userSignatureList: UserSignature[] = [];
let continuationLines = new Set<number>();
const numberConfig = new Compartment();
const serviceWorker = () =>
  new Worker(new URL("./language.worker.ts", import.meta.url), {
    type: "module",
  });
let analysisPaused = false;
let analysisStatus: AnalysisState | undefined;
let analysisClock: ReturnType<typeof setInterval> | undefined;
const analysisController = new WorkerRequestController(
  serviceWorker,
  (state) => {
    analysisStatus = state;
    clearInterval(analysisClock);
    renderAnalysisStatus();
    if (state.status === "running")
      analysisClock = setInterval(renderAnalysisStatus, 200);
  },
);
// Interactive symbol queries must never synchronously parse the whole document
// in the UI thread. They use a separate cancellable worker from diagnostics.
const queryController = new WorkerRequestController(serviceWorker);
const analysisProfileKey = () => JSON.stringify(currentProfile());
function languageOptions() {
  return {
    guideVersion,
    strictness,
    styleChecks: currentProfile().styleChecks,
    logicalPrecedence: currentProfile().logicalPrecedence,
  };
}
function renderAnalysisStatus() {
  if (examMode) return;
  const state = analysisStatus;
  if (!state || !$("analysis-state")) return;
  const running = state.status === "running";
  const pending = state.status === "pending";
  $("analysis-progress").hidden = !running;
  $("analysis-cancel").hidden = !(running || pending);
  $("analysis-resume").hidden =
    running || pending || state.status === "complete";
  $("analysis-state").textContent = pending
    ? "代码已更改，等待分析当前文档"
    : running
      ? `${state.phase} · ${((Date.now() - state.startedAt) / 1000).toFixed(1)} 秒 · 编辑器可继续操作`
      : state.status === "complete"
        ? "完整诊断已更新"
        : state.status === "cancelled"
          ? "分析已取消，文档完整保留；点击重新分析恢复"
          : `分析失败：${state.phase || "未知错误"}`;
}
async function analyzeAsync(source: string) {
  if (analysisPaused)
    throw Object.assign(new Error("分析已暂停"), { name: "AbortError" });
  const profileKey = analysisProfileKey();
  const result = await analysisController.request<{
    diagnostics: Diagnostic[];
    signatures: UserSignature[];
    outline: { name: string; kind: string; line: number }[];
    continuations: number[];
  }>({ source, dialect: language, profileOptions: languageOptions() });
  if (
    source === editor.state.doc.toString() &&
    profileKey === analysisProfileKey()
  ) {
    userSignatureList = result.signatures;
    renderOutline(result.outline);
    if (
      result.continuations.length !== continuationLines.size ||
      result.continuations.some((line) => !continuationLines.has(line))
    ) {
      continuationLines = new Set(result.continuations);
      editor.dispatch({
        effects: numberConfig.reconfigure(
          lineNumbers({
            formatNumber: (n) => (continuationLines.has(n) ? "" : String(n)),
          }),
        ),
      });
    }
  }
  return result.diagnostics;
}
async function languageQuery<T>(
  operation: string,
  detail: Record<string, unknown>,
) {
  if (examMode) throw new DOMException("考试期间关闭学习辅助", "AbortError");
  const result = await queryController.request<{ result: T }>({
    type: "query",
    source: editor.state.doc.toString(),
    dialect: language,
    operation,
    ...detail,
  });
  return result.result;
}
const escape = (s: any) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
$("app").innerHTML =
  `<aside class="rail"><a class="brand" href="#" aria-label="Pseudocode Ultra">P<span>u</span></a><button id="workspace-nav" class="rail-active" title="Workspace">⌘</button><button id="examples-nav" title="Examples">▤</button><button id="help-nav" title="Language reference">?</button><div class="rail-bottom">CAIE</div></aside><div class="shell"><header><div><span class="eyebrow">COMPUTER SCIENCE LAB</span><h1>Pseudocode <em>Ultra</em></h1></div><div class="header-right"><span class="local-dot"></span>本地执行 · Local-first <button id="practice-open" title="原创练习">练习</button><button id="exam-open" title="考试练习">考试</button><button id="theme" title="Switch theme">◐</button></div></header><div id="storage-warning" class="storage-warning" role="alert" hidden>本机存储不可用或保存失败，部分内容可能仅在本次会话保留。请下载备份。 / Local storage failed; download a backup.</div><section class="toolbar"><div class="select-wrap"><label for="dialect">考试方言 / DIALECT</label><select id="dialect"><option>0478</option><option>2210</option><option>9618-AS</option><option>9618-A2</option></select></div><span class="divider"></span><button id="run" class="primary">▶ 运行 <kbd>Ctrl ↵</kbd></button><select id="run-mode" aria-label="运行方式 / Run mode"><option value="manual">手动运行</option><option value="change">输入后运行</option><option value="blur">失焦时运行</option></select><label class="fast-toggle" title="高速执行不生成追踪表，调试请关闭"><input id="fast-mode" type="checkbox">高速</label><button id="pause" disabled>Ⅱ 暂停</button><button id="step">↳ 单步</button><button id="over" disabled>↷ 跳过</button><button id="out" disabled>↑ 跳出</button><button id="stop" disabled>■ 停止</button><span class="toolbar-space"></span><button id="format">格式化</button><button id="print-pdf">PDF</button><button id="download">↓ 保存</button><button id="upload">↑ 打开</button><input id="source-upload" type="file" accept=".txt,.pseudo,.psc" hidden></section><main><section class="editor-panel panel"><div class="panel-heading"><div class="file-tab"><span class="file-icon">⌁</span> <span id="source-name">${escape(sourceName)}</span><span id="save-state" class="save-state" role="status">已保存本机</span></div><select id="examples" aria-label="Load example"><option value="">示例程序 / Examples</option>${examples.map((e, i) => `<option value="${i}">${e.name}</option>`).join("")}</select></div><div id="editor"></div><div id="signature-help" hidden></div><div class="editor-footer"><span id="cursor">Ln 1, Col 1</span><span>UTF-8 <span id="indent">4 spaces</span><button id="clear-breakpoints">清除断点</button></span></div></section><aside class="inspector panel"><div class="panel-heading"><h2>调试工作台 <small>DEBUGGER</small></h2><span id="status" class="status" role="status" aria-live="polite">就绪</span></div><div class="debug-section"><h3>变量 <small>VARIABLES</small></h3><div id="variables" class="empty">运行或单步执行后查看变量</div></div><div class="debug-section"><h3>监视表达式 <small>WATCH</small></h3><form id="watch-form"><input id="watch-input" placeholder="变量名称，例如 Total" aria-label="Watch variable"><button>＋</button></form><div id="watches"></div></div><div class="debug-section"><h3>调用栈 <small>CALL STACK</small></h3><div id="stack" class="empty">尚未进入子程序</div></div><div class="debug-section"><h3>虚拟文件 <small>FILES · IndexedDB</small></h3><div id="files"></div><button id="add-file">＋ 新建文件</button><button id="import-file">↑ 导入文件</button><button id="backup-files">↓ 备份全部</button><input id="file-upload" type="file" hidden></div><div class="debug-section"><h3>代码大纲 <small>OUTLINE</small></h3><div id="outline"></div></div><div class="policy-note"><span>ℹ</span><div>Cambridge 规范版本可配置<br><small>依据官方 Guide / Insert / v6 考纲实现。具体来源与模糊语义策略见语言参考。</small></div></div></aside><section class="output-panel panel"><nav class="tabs" role="tablist" aria-label="Output panels"><button data-tab="console" class="selected">终端 <span>CONSOLE</span></button><button data-tab="diagnostics">诊断 <span id="diagnostic-count">0</span></button><button data-tab="trace">追踪表</button><button data-tab="flow">流程图</button><button data-tab="ast">AST / Tokens</button><button data-tab="export">代码转换</button><button data-tab="reference">语言参考</button><button data-tab="practice">原创练习</button></nav><div id="console" class="tab-pane"><div id="console-output"><div class="terminal-hint">Pseudocode Ultra runtime<br><span>准备好了。点击运行，或点击行号旁设置断点后开始单步执行。</span></div></div><form id="input-form" hidden><label for="runtime-input">INPUT →</label><input id="runtime-input" autocomplete="off" placeholder="输入值后按 Enter"><button class="primary">提交</button></form></div><div id="diagnostics" class="tab-pane" hidden></div><div id="trace" class="tab-pane" hidden><div class="pane-actions"><button id="csv">↓ CSV</button><button id="xlsx">↓ Excel</button><label><input id="trace-blank" type="checkbox"> 填空练习</label><button id="grade-trace">批改本页</button><span id="trace-grade"></span><select id="trace-filter" aria-label="Trace row policy"><option value="all">每条语句</option><option value="changes">仅变量变化</option><option value="modules">模块进入/返回</option><option value="loops">每次循环</option><option value="branches">IF/CASE 分支</option><option value="left-to-right">从左到右</option></select><input id="trace-columns" aria-label="Trace columns" placeholder="列顺序，如 I, Total"><label><input id="hide-repeats" type="checkbox"> 隐藏重复值</label></div><div class="pane-actions"><button id="trace-prev">上一页</button><span id="trace-page" aria-live="polite"></span><button id="trace-next">下一页</button></div><div id="trace-table"></div></div><div id="flow" class="tab-pane" hidden><select id="flow-module" aria-label="Flowchart module"></select><div id="flow-content"></div></div><div id="ast" class="tab-pane" hidden><select id="ast-mode" aria-label="AST or Tokens"><option>AST</option><option>Tokens</option></select><pre id="ast-content"></pre></div><div id="export" class="tab-pane" hidden><div class="pane-actions"><select id="target" aria-label="转换语言 / Target language"><option value="python">Python 3</option><option value="java">Java 17+</option><option value="vb">VB.NET</option></select><button id="convert">转换</button><button id="export-download" disabled>↓ 下载</button><span>完整类型与虚拟文件语义 · 独立程序，仅依赖目标语言标准库。</span></div><pre id="export-content"></pre></div><div id="reference" class="tab-pane" hidden></div><div id="practice" class="tab-pane" hidden></div></section></main><footer><span><i></i> 不上传源码 · 在浏览器 Worker 中执行</span><span id="runtime-info">指令上限 100,000 · 确定性随机种子</span></footer></div><dialog id="file-dialog" aria-labelledby="file-title"><form method="dialog"><h2 id="file-title">文件</h2><p id="file-record-note" hidden>此文件包含随机记录；修改文本会保留所有记录。 / Random records will be preserved.</p><textarea aria-labelledby="file-title" id="file-text" spellcheck="false"></textarea><div class="dialog-actions"><button value="cancel">取消</button><button id="file-save" value="save" class="primary">保存</button></div></form></dialog>`;
$("editor").insertAdjacentHTML(
  "afterend",
  `<div class="analysis-controls"><progress id="analysis-progress" aria-label="语言分析进度" hidden></progress><span id="analysis-state" role="status" aria-live="polite">等待分析</span><button id="analysis-cancel" hidden>取消分析</button><button id="analysis-resume" hidden>重新分析</button></div>`,
);
$("analysis-cancel").onclick = () => {
  analysisPaused = true;
  analysisController.cancel();
};
$("analysis-resume").onclick = () => {
  analysisPaused = false;
  void diagnose(editor.state.doc.toString());
  forceLinting(editor);
};
const highlight = StateEffect.define<number>();
const currentLine = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(v, tr) {
    v = v.map(tr.changes);
    for (const effect of tr.effects)
      if (effect.is(highlight)) {
        if (effect.value < 1 || effect.value > tr.state.doc.lines)
          return Decoration.none;
        const line = tr.state.doc.line(effect.value);
        return Decoration.set([
          Decoration.line({ class: "execution-line" }).range(line.from),
        ]);
      }
    return v;
  },
  provide: (f) => EditorView.decorations.from(f),
});
class Breakpoint extends GutterMarker {
  toDOM() {
    const span = document.createElement("span");
    span.className = "breakpoint";
    span.textContent = "●";
    return span;
  }
}
const marker = new Breakpoint();
const languageConfig = new Compartment();
const createLanguageSupport = () =>
  StreamLanguage.define({
    token(stream) {
      if (stream.match("//")) {
        stream.skipToEnd();
        return "comment";
      }
      if (stream.match(/"[^"\n]*"|'[^'\n]*'/)) return "string";
      if (stream.match(/\b\d+(\.\d+)?\b/)) return "number";
      if (stream.match(/[A-Za-z][\w]*/)) {
        const name = stream.current().toUpperCase();
        return keywords.has(name)
          ? "keyword"
          : profile(language).builtins.includes(name)
            ? "variableName.standard"
            : null;
      }
      stream.next();
      return null;
    },
  });
const indentConfig = new Compartment();
const setupConfig = new Compartment(),
  hoverConfig = new Compartment(),
  completionConfig = new Compartment(),
  lintConfig = new Compartment(),
  readOnlyConfig = new Compartment();
const editor = new EditorView({
  state: EditorState.create({
    doc: settings.getItem("source") ?? examples[0].code,
    extensions: [
      EditorView.contentAttributes.of({
        "aria-label": "伪代码编辑器 / Pseudocode editor",
        spellcheck: "false",
      }),
      EditorView.domEventHandlers({
        beforeinput(event, view) {
          if (
            event.inputType !== "insertText" ||
            event.isComposing ||
            !event.data ||
            event.data.length < 20000 ||
            view.state.readOnly ||
            !event.cancelable
          )
            return false;
          event.preventDefault();
          view.dispatch(view.state.replaceSelection(event.data), {
            annotations: Transaction.userEvent.of("input.paste"),
            scrollIntoView: true,
          });
          return true;
        },
        blur() {
          if (runMode === "blur") scheduleAutoRun();
        },
      }),
      numberConfig.of(
        lineNumbers({
          formatNumber: (n) => (continuationLines.has(n) ? "" : String(n)),
        }),
      ),
      setupConfig.of(basicSetup),
      readOnlyConfig.of([]),
      indentConfig.of(indentUnit.of(" ".repeat(profile(language).indent))),
      hoverConfig.of(
        hoverTooltip(async (view, pos) => {
          if (examMode) return null;
          const word = view.state.wordAt(pos);
          if (!word) return null;
          const doc = view.state.doc;
          let description: string | undefined;
          try {
            description = await languageQuery<string | undefined>("hover", {
              position: pos,
            });
          } catch {
            return null;
          }
          if (examMode || view.state.doc !== doc) return null;
          if (!description) return null;
          return {
            pos: word.from,
            end: word.to,
            create() {
              const dom = document.createElement("div");
              dom.className = "type-tooltip";
              dom.textContent = description;
              return { dom };
            },
          };
        }),
      ),
      keymap.of([
        {
          key: "F9",
          run: (view) => {
            if (examMode) return true;
            const line = view.state.doc.lineAt(
              view.state.selection.main.head,
            ).number;
            breakpoints.has(line)
              ? breakpoints.delete(line)
              : breakpoints.add(line);
            view.dispatch({});
            worker?.postMessage({
              type: "breakpoints",
              lines: [...breakpoints],
            });
            return true;
          },
        },
        indentWithTab,
        {
          key: "F12",
          run: () => {
            jumpDefinition();
            return true;
          },
        },
        {
          key: "Mod-Shift-r",
          run: () => {
            renameSymbol();
            return true;
          },
        },
        {
          key: "Mod-Enter",
          run: () => {
            start("run");
            return true;
          },
        },
        {
          key: "F10",
          run: () => {
            step("over");
            return true;
          },
        },
        {
          key: "F11",
          run: () => {
            step("step");
            return true;
          },
        },
      ]),
      languageConfig.of(createLanguageSupport()),
      syntaxHighlighting(
        HighlightStyle.define([
          ...defaultHighlightStyle.specs,
          {
            tag: tags.invalid,
            color: "#bf4055",
            textDecoration: "underline wavy",
          },
        ]),
      ),
      foldService.of((state, from, to) => {
        const line = state.doc.lineAt(from);
        const endFor = (text: string) => {
          text = text
            .trim()
            .toUpperCase()
            .replace(/^(PUBLIC|PRIVATE)\s+/, "");
          if (/^TYPE\s+\w+$/.test(text)) return "ENDTYPE";
          const name = text.split(/\s/)[0];
          return (
            {
              IF: "ENDIF",
              FOR: "NEXT",
              WHILE: "ENDWHILE",
              REPEAT: "UNTIL",
              CASE: "ENDCASE",
              PROCEDURE: "ENDPROCEDURE",
              FUNCTION: "ENDFUNCTION",
              CLASS: "ENDCLASS",
            } as Record<string, string>
          )[name];
        };
        const end = endFor(line.text);
        if (!end) return null;
        const stack = [end];
        for (let i = line.number + 1; i <= state.doc.lines; i++) {
          const row = state.doc.line(i),
            text = row.text.trim().toUpperCase(),
            open = endFor(text);
          if (open) stack.push(open);
          else if (text.split(/\s/)[0] === stack.at(-1)) {
            stack.pop();
            if (!stack.length)
              return { from: line.to, to: Math.max(line.to, row.from - 1) };
          }
        }
        return null;
      }),
      completionConfig.of(
        autocompletion({
          override: [
            async (context) => {
              if (examMode) return null;
              const w = context.matchBefore(/[\w]*/);
              if (
                !w ||
                (w.from === w.to &&
                  !context.explicit &&
                  context.state.sliceDoc(w.from - 1, w.from) !== ".")
              )
                return null;
              let items: LanguageCompletion[];
              try {
                items = await languageQuery<LanguageCompletion[]>(
                  "completion",
                  {
                    position: context.pos,
                  },
                );
              } catch {
                return null;
              }
              if (
                examMode ||
                context.aborted ||
                !editor.hasFocus ||
                context.state.doc !== editor.state.doc
              )
                return null;
              return {
                from: w.from,
                options: items
                  .map<Completion>((item) => ({
                    ...item,
                    info: item.detail + "\n" + item.info,
                  }))
                  .concat([
                    snippetCompletion(
                      `IF \${condition} THEN\n${" ".repeat(profile(language).indent)}\${statement}\nENDIF`,
                      { label: "IF … THEN", type: "keyword" },
                    ),
                    snippetCompletion(
                      `FOR \${I} ← \${1} TO \${10}\n${" ".repeat(profile(language).indent)}\${statement}\nNEXT \${I}`,
                      { label: "FOR … NEXT", type: "keyword" },
                    ),
                  ]),
              };
            },
          ],
        }),
      ),
      lintConfig.of(
        linter(
          async (view) => {
            const ds = await diagnose(view.state.doc.toString());
            return ds.slice(0, 100).map((d) => {
              const l = view.state.doc.line(
                Math.min(Math.max(1, d.line), view.state.doc.lines),
              );
              return {
                from: Math.min(
                  view.state.doc.length,
                  d.from ?? l.from + Math.max(0, d.column - 1),
                ),
                to: Math.min(view.state.doc.length, d.to ?? l.to),
                actions: d.actions?.map((a) => ({
                  name: a.name,
                  apply(view: EditorView) {
                    view.dispatch({ changes: a.edits });
                  },
                })),
                severity: d.severity,
                message: `${d.code} · ${d.message}\n${d.source.doc} (${d.source.version}, ${d.source.section}; ${d.source.verified ? "官方来源" : "策略"})`,
              };
            });
          },
          { delay: 400 },
        ),
      ),
      currentLine,
      gutter({
        class: "breakpoint-gutter",
        markers: (v) => {
          const b = new RangeSetBuilder<GutterMarker>();
          for (const line of [...breakpoints].sort((a, b) => a - b))
            if (line <= v.state.doc.lines)
              b.add(
                v.state.doc.line(line).from,
                v.state.doc.line(line).from,
                marker,
              );
          return b.finish();
        },
        initialSpacer: () => marker,
        domEventHandlers: {
          mousedown(view, line) {
            if (examMode) return true;
            const n = view.state.doc.lineAt(line.from).number;
            breakpoints.has(n) ? breakpoints.delete(n) : breakpoints.add(n);
            view.dispatch({});
            worker?.postMessage({
              type: "breakpoints",
              lines: [...breakpoints],
            });
            return true;
          },
        },
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          analysisController.invalidate();
          queryController.invalidate();
          if (!examMode && !analysisPaused) {
            clearInterval(analysisClock);
            analysisStatus = { status: "pending", startedAt: Date.now() };
            renderAnalysisStatus();
          }
          worker?.terminate();
          worker = undefined;
          busy = paused = false;
          clearTimeout(autoRunTimer);
          queueMicrotask(() => {
            clearDebugState();
            status("代码已更改");
            $("input-form").hidden = true;
            buttons();
          });
          persistEditorSource(update.state.doc.toString());
          invalidateConversion();
          breakpoints.clear();
          clearTimeout(diagnosticTimer);
          diagnosticTimer = setTimeout(() => {
            diagnose(editor.state.doc.toString());
            if (tab === "flow" || tab === "ast") refreshTab();
          }, 450);
          if (runMode === "change") scheduleAutoRun();
        }
        if (update.selectionSet || update.docChanged) {
          const a = update.state.doc.lineAt(update.state.selection.main.head);
          $("cursor").textContent =
            `Ln ${a.number}, Col ${update.state.selection.main.head - a.from + 1}`;
          const hint = examMode
            ? undefined
            : signatureHelp(
                update.state.sliceDoc(
                  Math.max(0, update.state.selection.main.head - 5000),
                  update.state.selection.main.head,
                ),
                language,
                userSignatureList,
              );
          $("signature-help").hidden = !hint;
          if (hint)
            $("signature-help").textContent =
              hint.label +
              " · 参数 " +
              (hint.activeParameter + 1) +
              " · " +
              hint.source;
        }
      }),
    ],
  }),
  parent: $("editor"),
});
let latestDiagnostics: Diagnostic[] = [];
let diagnosticTimer: ReturnType<typeof setTimeout>;
async function diagnose(source: string) {
  if (examMode) return [];
  const requestedProfile = analysisProfileKey();
  let d: Diagnostic[];
  try {
    d = await analyzeAsync(source);
  } catch (e: any) {
    if (e.name === "AbortError") return [];
    d = [
      {
        code: "ANALYSIS",
        message: e.message,
        line: 1,
        column: 1,
        severity: "error" as const,
        source: profile(language).source,
      },
    ];
  }
  if (
    source !== editor.state.doc.toString() ||
    requestedProfile !== analysisProfileKey()
  )
    return d;
  if (examMode) return [];
  latestDiagnostics = d;
  $("diagnostic-count").textContent = String(d.length);
  diagnosticPage = 0;
  renderDiagnostics();
  return d;
}
let diagnosticPage = 0;
const diagnosticPageSize = 100;
function renderDiagnostics() {
  const d = latestDiagnostics;
  const start = diagnosticPage * diagnosticPageSize;
  $("diagnostics").innerHTML = d.length
    ? (d.length > diagnosticPageSize
        ? `<div class="pane-actions"><button id="diagnostic-prev" ${diagnosticPage === 0 ? "disabled" : ""}>上一页</button><span>第 ${diagnosticPage + 1} / ${Math.ceil(d.length / diagnosticPageSize)} 页 · 共 ${d.length} 条完整诊断</span><button id="diagnostic-next" ${start + diagnosticPageSize >= d.length ? "disabled" : ""}>下一页</button><button id="diagnostic-save">下载全部诊断</button></div>`
        : "") +
      d
        .slice(start, start + diagnosticPageSize)
        .map(
          (x, index) =>
            `<div class="diagnostic ${x.severity}"><button class="diagnostic-jump" data-line="${x.line}"><strong>${escape(x.code)}</strong><span>${escape(x.message)}</span><small>Line ${x.line} · ${escape(x.source.doc)} · ${escape(x.source.section)} · ${x.source.verified ? "规范来源" : "工程策略"}</small></button>${(x.actions || []).map((a, i) => `<button class="diagnostic-fix" data-fix="${start + index}:${i}">${escape(a.name)}</button>`).join("")}</div>`,
        )
        .join("")
    : '<div class="empty">未发现静态诊断。运行时仍会检查类型、边界和文件状态。</div>';

  if ($("diagnostic-prev"))
    $("diagnostic-prev").onclick = () => {
      diagnosticPage--;
      renderDiagnostics();
    };
  if ($("diagnostic-next"))
    $("diagnostic-next").onclick = () => {
      diagnosticPage++;
      renderDiagnostics();
    };
  if ($("diagnostic-save"))
    $("diagnostic-save").onclick = () =>
      download(
        "diagnostics.json",
        JSON.stringify(d, null, 2),
        "application/json",
      );
}
function status(s: string) {
  $("status").textContent = s;
}
function buttons() {
  const locked = examLocked;
  ($("run") as HTMLButtonElement).disabled =
    locked || !filesReady || (busy && !paused);
  ($("pause") as HTMLButtonElement).disabled =
    examMode || !busy || paused || fastBusy || !$("input-form").hidden;
  $<HTMLButtonElement>("step").disabled =
    examMode || !filesReady || (busy && !paused);
  for (const id of ["over", "out"])
    ($(id) as HTMLButtonElement).disabled = examMode || !paused;
  ($("stop") as HTMLButtonElement).disabled = !busy;
  for (const id of ["add-file", "import-file", "backup-files"])
    $<HTMLButtonElement>(id).disabled = examMode || !filesReady;
}
function clearDebugState() {
  trace = [];
  tracePage = 0;
  for (const key of Object.keys(attempts)) delete attempts[key];
  lastEvent = undefined;
  watchValues.clear();
  $("variables").innerHTML =
    '<span class="empty">运行或单步执行后查看变量</span>';
  $("stack").innerHTML = '<span class="empty">尚未进入子程序</span>';
  mark(0);
  paintWatches();
  if (tab === "trace") renderTrace();
}
function invalidateConversion() {
  converted = "";
  $("export-content").textContent =
    "源码、设置或文件变化后，请重新转换。 / Convert the current program.";
  $<HTMLButtonElement>("export-download").disabled = true;
}
function scheduleAutoRun() {
  if (examMode) return;
  clearTimeout(autoRunTimer);
  const source = editor.state.doc.toString(),
    key = analysisProfileKey();
  autoRunTimer = setTimeout(
    async () => {
      if (
        !source.trim() ||
        !filesReady ||
        busy ||
        source !== editor.state.doc.toString() ||
        key !== analysisProfileKey()
      )
        return;
      const diagnostics = await diagnose(source);
      if (
        source === editor.state.doc.toString() &&
        key === analysisProfileKey() &&
        !busy &&
        !diagnostics.some((d) => d.severity === "error")
      )
        start("run");
    },
    runMode === "change" ? 700 : 0,
  );
}
function log(s: string, cls = "") {
  const row = document.createElement("div");
  row.className = cls;
  row.textContent = s;
  $("console-output").append(row);
  $("console-output").scrollTop = $("console-output").scrollHeight;
}
function mark(line: number) {
  activeLine = line;
  editor.dispatch({ effects: highlight.of(line) });
  if (line > 0 && line <= editor.state.doc.lines)
    editor.dispatch({
      effects: EditorView.scrollIntoView(editor.state.doc.line(line).from, {
        y: "center",
      }),
    });
}
function renderState(e: Event) {
  lastEvent = e;
  const vars = e.variables || {};
  $("variables").innerHTML = Object.keys(vars).length
    ? Object.entries(vars)
        .map(([k, v]) => inspectorValue(k, e.values?.[k] ?? v))
        .join("")
    : '<span class="empty">当前作用域没有变量</span>';
  $("stack").innerHTML = e.stack?.length
    ? e.stack
        .map(
          (s, i) =>
            `<div class="stack-frame"><span>${i + 1}</span>${escape(s)}</div>`,
        )
        .reverse()
        .join("")
    : '<span class="empty">main.pseudo</span>';
  renderWatches();
}
function inspectorValue(k: string, v: any, depth = 0): string {
  if (depth > 6) return "";
  if (v && typeof v === "object")
    return `<details class="variable"><summary><span>${escape(k)}</span><code>${Array.isArray(v) ? "SET" : "COMPOSITE"} · ${Object.keys(v).length}</code></summary><div class="variable-children">${Object.entries(
      v,
    )
      .map(([key, value]) => inspectorValue(key, value, depth + 1))
      .join("")}</div></details>`;
  const text = typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : v;
  return `<div class="variable scalar"><span>${escape(k)}</span><code title="${escape(text)}" tabindex="0">${escape(text)}</code></div>`;
}
function start(mode: string) {
  examController?.tick();
  if (examLocked || (examMode && mode !== "run")) return;
  if (!filesReady || (busy && !paused)) return;
  clearTimeout(autoRunTimer);
  if (busy && paused) {
    worker?.postMessage({ type: "resume", mode });
    paused = false;
    status("运行中");
    buttons();
    return;
  }
  worker?.terminate();
  worker = new Worker(new URL("./execution.worker.ts", import.meta.url), {
    type: "module",
  });
  busy = true;
  fastBusy = mode === "run" && $<HTMLInputElement>("fast-mode").checked;
  paused = false;
  clearDebugState();
  trace = [];
  tracePage = 0;
  watchValues.clear();
  for (const key of Object.keys(attempts)) delete attempts[key];
  $("console-output").replaceChildren();
  $("input-form").hidden = true;
  status("运行中");
  buttons();
  showTab("console");
  worker.onmessage = ({ data: d }) => {
    if (d.type === "events") {
      trace.push(...d.events);
      if (trace.length > 50000) trace.splice(0, trace.length - 50000);
      lastEvent = d.events.at(-1) || lastEvent;
    } else if (d.type === "step" || d.type === "trace") {
      trace.push(d.event);
      lastEvent = d.event;
    } else if (d.type === "watch") {
      watchValues.set(d.expression, d.value);
      paintWatches();
    } else if (d.type === "output") log(d.text);
    else if (d.type === "warning") log("⚠ " + d.text, "warning");
    else if (d.type === "paused") {
      paused = true;
      status("已暂停");
      mark(d.event.line);
      renderState(d.event);
      buttons();
    } else if (d.type === "input") {
      status("等待输入");
      $("input-form").hidden = false;
      $<HTMLInputElement>("runtime-input").focus();
      mark(d.line);
      if (d.state) renderState(d.state);
      buttons();
    } else if (d.type === "done") {
      busy = false;
      paused = false;
      status("执行完成");
      mark(0);
      trace = d.trace;
      if (examMode) examFiles = d.files;
      else {
        files = d.files;
        void persistFiles();
      }
      invalidateConversion();
      if (d.state) renderState(d.state);
      else if (lastEvent) renderState(lastEvent);
      renderFiles();
      $("runtime-info").textContent =
        `已执行 ${d.steps} 条指令 · ${fastBusy ? "高速模式，无追踪" : trace.length + " 行追踪"}${d.truncated ? "（已达追踪行数上限）" : ""}`;
      buttons();
      refreshTab();
    } else if (d.type === "error") {
      busy = false;
      paused = false;
      status("执行错误");
      mark(d.line);
      if (d.files && examMode) examFiles = d.files;
      if (d.files && !examMode) {
        files = d.files;
        renderFiles();
        void persistFiles();
        invalidateConversion();
      }
      if (d.state) renderState(d.state);
      log(
        `${d.code} · Line ${d.line}:${d.column || 1}\n${d.message}${d.stack?.length ? "\n" + d.stack.join(" → ") : ""}${d.source ? `\n${d.source.doc} ${d.source.section} (${d.source.version}; ${d.source.verified ? "官方来源" : "工程策略"})` : ""}`,
        "error",
      );
      $("input-form").hidden = true;
      buttons();
    }
  };
  worker.onerror = (e) => {
    status("Worker 错误");
    log(e.message, "error");
    busy = paused = false;
    $("input-form").hidden = true;
    mark(0);
    buttons();
  };
  worker.postMessage({
    type: "start",
    source: editor.state.doc.toString(),
    dialect: language,
    mode,
    breakpoints: [...breakpoints],
    files: examMode ? examFiles : files,
    trace: !examMode && !fastBusy,
    maxSteps: maxSteps(),
    seed: randomSeed(),
    strict: strictness === "exam",
    fast: fastBusy,
    policies: policyState,
    profileOptions: {
      guideVersion,
      strictness,
      styleChecks: currentProfile().styleChecks,
      logicalPrecedence: currentProfile().logicalPrecedence,
    },
  });
}
function step(mode: string) {
  if (!busy) start("step");
  else if (paused) {
    start(mode);
  }
}
function stop() {
  clearTimeout(autoRunTimer);
  worker?.terminate();
  worker = undefined;
  busy = false;
  paused = false;
  mark(0);
  status("已停止");
  $("input-form").hidden = true;
  buttons();
}
$("run-mode").onchange = () => {
  clearTimeout(autoRunTimer);
  runMode = $<HTMLSelectElement>("run-mode").value as typeof runMode;
  settings.setItem("runMode", runMode);
};
$<HTMLSelectElement>("run-mode").value = runMode;
$("run").onclick = () => start("run");
$("step").onclick = () => step("step");
$("over").onclick = () => step("over");
$("out").onclick = () => step("out");
$("pause").onclick = () => worker?.postMessage({ type: "pause" });
$("stop").onclick = stop;
$("input-form").onsubmit = (e) => {
  e.preventDefault();
  examController?.tick();
  if (examLocked) return;
  worker?.postMessage({
    type: "input",
    value: $<HTMLInputElement>("runtime-input").value,
  });
  $<HTMLInputElement>("runtime-input").value = "";
  $("input-form").hidden = true;
  status("运行中");
  buttons();
};
function setSource(s: string, addToHistory = true) {
  stop();
  breakpoints.clear();
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: s },
    annotations: Transaction.addToHistory.of(addToHistory),
  });
}
function setDialect(id: DialectId, internal = false) {
  if (examMode && !internal) return;
  stop();
  clearDebugState();
  invalidateConversion();
  language = id;
  editor.dispatch({
    effects: languageConfig.reconfigure(createLanguageSupport()),
  });
  $<HTMLSelectElement>("dialect").value = id;
  settings.setItem("dialect", id);
  editor.dispatch({
    effects: indentConfig.reconfigure(
      indentUnit.of(" ".repeat(profile(id).indent)),
    ),
  });
  $("indent").textContent = `${profile(id).indent} spaces`;
  diagnose(editor.state.doc.toString());
  renderReference();
}
$("dialect").onchange = () =>
  setDialect($<HTMLSelectElement>("dialect").value as DialectId);
setDialect(language);
$("examples").onchange = () => {
  const v = $<HTMLSelectElement>("examples").value;
  if (v === "") return;
  const ex = examples[Number(v)];
  setDialect(ex.dialect as DialectId);
  setSource(ex.code);
  sourceName = "main.pseudo";
  settings.setItem("sourceName", sourceName);
  $("source-name").textContent = sourceName;
  $<HTMLSelectElement>("examples").value = "";
};
$("format").onclick = () => {
  if (examMode) return;
  const source = format(editor.state.doc.toString(), language);
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: source },
  });
};
function download(name: string, s: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([s], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("download").onclick = () => download(sourceName, editor.state.doc.toString());
$("upload").onclick = () => $("source-upload").click();
$("source-upload").onchange = async () => {
  const input = $<HTMLInputElement>("source-upload"),
    f = input.files?.[0];
  try {
    if (f) {
      const source = await f.text();
      if (examMode) return;
      setSource(source);
      sourceName = f.name;
      settings.setItem("sourceName", sourceName);
      $("source-name").textContent = sourceName;
    }
  } catch (error: any) {
    log("无法打开源码 / Unable to open source: " + error.message, "error");
    showTab("console");
  } finally {
    input.value = "";
  }
};
$("clear-breakpoints").onclick = () => {
  breakpoints.clear();
  editor.dispatch({});
  worker?.postMessage({ type: "breakpoints", lines: [] });
};
$("watch-form").onsubmit = (e) => {
  e.preventDefault();
  if (examMode) return;
  const input = $<HTMLInputElement>("watch-input");
  if (input.value.trim()) watches.add(input.value.trim());
  input.value = "";
  renderWatches();
};
function renderWatches() {
  if (worker && (paused || !busy || !$("input-form").hidden))
    for (const expression of watches)
      worker?.postMessage({ type: "watch", expression });
  paintWatches();
}
function paintWatches() {
  $("watches").innerHTML = [...watches]
    .map(
      (k) =>
        `<div class="watch"><code>${escape(k)}</code><span>${escape(watchValues.get(k) ?? lastEvent?.variables?.[k.toUpperCase()] ?? "暂停后查看")}</span><button data-remove-watch="${escape(k)}" aria-label="Remove watch">×</button></div>`,
    )
    .join("");
}
$("watches").onclick = (e) => {
  const k = (e.target as HTMLElement).dataset.removeWatch;
  if (k) {
    watches.delete(k);
    watchValues.delete(k);
    renderWatches();
  }
};
function showTab(name: string) {
  if (examMode && name !== "console") return;
  tab = name;
  document
    .querySelectorAll<HTMLElement>(".tab-pane")
    .forEach((e) => (e.hidden = e.id !== name));
  document.querySelectorAll<HTMLElement>("[data-tab]").forEach((e) => {
    const selected = e.dataset.tab === name;
    e.classList.toggle("selected", selected);
    e.setAttribute("aria-selected", String(selected));
    e.tabIndex = selected ? 0 : -1;
  });
  refreshTab();
}
document.querySelectorAll<HTMLElement>("[data-tab]").forEach((e) => {
  const name = e.dataset.tab!;
  e.id = "tab-" + name;
  e.setAttribute("role", "tab");
  e.setAttribute("aria-controls", name);
  $(name).setAttribute("role", "tabpanel");
  $(name).setAttribute("aria-labelledby", e.id);
  e.onclick = () => showTab(name);
  e.onkeydown = (event) => {
    const tabs = Array.from(
        document.querySelectorAll<HTMLElement>("[data-tab]:not(:disabled)"),
      ),
      index = tabs.indexOf(e);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (index + tabs.length - 1) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : -1;
    if (next >= 0) {
      event.preventDefault();
      showTab(tabs[next].dataset.tab!);
      tabs[next].focus();
    }
  };
});
showTab(tab);
function refreshTab() {
  if (tab === "trace") renderTrace();
  if (tab === "flow") renderFlow();
  if (tab === "ast") renderAST();
}
function currentTrace() {
  return traceRows(trace, {
    policy: $<HTMLSelectElement>("trace-filter")
      .value as TraceOptions["policy"],
    columns: $<HTMLInputElement>("trace-columns")
      .value.split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
    hideRepeated: $<HTMLInputElement>("hide-repeats").checked,
  });
}
function renderTrace() {
  const { rows, columns } = currentTrace(),
    blank = $<HTMLInputElement>("trace-blank").checked,
    pages = Math.max(1, Math.ceil(rows.length / tracePageSize));
  tracePage = Math.max(0, Math.min(tracePage, pages - 1));
  const start = tracePage * tracePageSize,
    visible = rows.slice(start, start + tracePageSize);
  $("trace-page").textContent =
    `${tracePage + 1} / ${pages} · ${rows.length} 行`;
  $<HTMLButtonElement>("trace-prev").disabled = tracePage === 0;
  $<HTMLButtonElement>("trace-next").disabled = tracePage === pages - 1;
  $("trace-table").innerHTML = rows.length
    ? `<table><thead><tr><th>Line</th><th>Call stack</th>${columns.map((c) => `<th>${escape(c)}</th>`).join("")}</tr></thead><tbody>${visible.map((r, i) => `<tr><td>${r.line}</td><td>${escape(r.stack)}</td>${columns.map((c) => `<td>${blank ? `<input class="trace-answer" aria-label="Row ${start + i + 1} ${escape(c)}" data-answer="${start + i + ":" + escape(c)}" value="${escape(attempts[start + i + ":" + c] || "")}">` : escape(r.variables[c])}</td>`).join("")}</tr>`).join("")}</tbody></table>`
    : '<div class="empty">执行代码以生成追踪表。调试模式记录语句、循环、模块与分支快照；高速模式不生成追踪表。</div>';
}
for (const [id, delta] of [
  ["trace-prev", -1],
  ["trace-next", 1],
] as const)
  $(id).onclick = () => {
    tracePage += delta;
    $("trace-grade").textContent = "";
    renderTrace();
  };
for (const id of [
  "hide-repeats",
  "trace-filter",
  "trace-columns",
  "trace-blank",
])
  $(id).onchange = () => {
    tracePage = 0;
    if (["trace-filter", "trace-columns", "hide-repeats"].includes(id))
      for (const key of Object.keys(attempts)) delete attempts[key];
    $("trace-grade").textContent = "";
    renderTrace();
  };
$("trace-table").oninput = (e) => {
  const input = e.target as HTMLInputElement;
  if (input.dataset.answer) attempts[input.dataset.answer] = input.value;
};
$("csv").onclick = () => {
  const { rows, columns } = currentTrace();
  download(
    "trace.csv",
    csv(rows, columns, $<HTMLInputElement>("trace-blank").checked),
    "text/csv",
  );
};
$("xlsx").onclick = () => {
  const { rows, columns } = currentTrace(),
    bytes = xlsx(rows, columns, $<HTMLInputElement>("trace-blank").checked);
  const url = URL.createObjectURL(
    new Blob([bytes.buffer as ArrayBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "trace.xlsx";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$("grade-trace").onclick = () => {
  const { rows, columns } = currentTrace(),
    start = tracePage * tracePageSize,
    pageAttempts: Record<string, string> = {};
  for (let i = 0; i < tracePageSize; i++)
    for (const column of columns)
      pageAttempts[i + ":" + column] = attempts[start + i + ":" + column] || "";
  const answers = gradeTrace(
    rows.slice(start, start + tracePageSize),
    columns,
    pageAttempts,
  );
  for (const a of answers) {
    const input = Array.from(
      document.querySelectorAll<HTMLInputElement>(".trace-answer"),
    ).find((e) => e.dataset.answer === start + a.row + ":" + a.column);
    if (input) {
      input.classList.toggle("correct", a.correct);
      input.classList.toggle("incorrect", !a.correct);
      input.title = a.correct
        ? "正确 / Correct"
        : "应为 / Expected: " + a.expected;
    }
  }
  $("trace-grade").textContent =
    `${answers.filter((a) => a.correct).length} / ${answers.length} 正确`;
};
function renderFlow() {
  const f = flowchart(
    editor.state.doc.toString(),
    language,
    $<HTMLSelectElement>("flow-module").value || "main",
  );
  const selected = $<HTMLSelectElement>("flow-module").value;
  $<HTMLSelectElement>("flow-module").innerHTML = f.modules
    .map(
      (name: string) =>
        `<option value="${escape(name)}">${escape(name)}</option>`,
    )
    .join("");
  $<HTMLSelectElement>("flow-module").value = f.modules.includes(selected)
    ? selected
    : "main";
  const width = 900,
    row = 100;
  const shape = (n: any) => {
    const y = n.id * row + 30,
      cls = n.shape === "decision" ? "decision" : "process";
    const polygon =
      n.shape === "decision"
        ? `<polygon points="450,${y} 680,${y + 30} 450,${y + 60} 220,${y + 30}"/>`
        : n.shape === "io"
          ? `<polygon points="240,${y} 690,${y} 660,${y + 60} 210,${y + 60}"/>`
          : `<rect x="220" y="${y}" width="460" height="60" rx="${n.shape === "terminal" ? 30 : 5}"/>`;
    return `<g class="${cls}" data-line="${n.line}">${polygon}<text x="450" y="${y + 35}" text-anchor="middle">${escape(n.label.slice(0, 54))}</text></g>`;
  };
  $("flow-content").innerHTML =
    `<p class="flow-note">当前模块控制流 · 菱形：条件 · 平行四边形：输入/输出</p><svg viewBox="0 0 ${width} ${f.nodes.length * row + 60}" role="img" aria-label="Program control flow"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#70869a"/></marker></defs>${f.edges
      .map((e, i) => {
        const a = e.from * row + 90,
          b = e.to * row + 30;
        const x = e.label === "FALSE" ? 780 : 100;
        return e.to === e.from + 1
          ? `<path d="M450 ${a} L450 ${b}" marker-end="url(#arrow)"/><text x="460" y="${a + 15}">${escape(e.label || "")}</text>`
          : `<path d="M${e.label === "FALSE" ? 680 : 220} ${a - 30} H${x} V${b + 30} H220" marker-end="url(#arrow)"/><text x="${x + 8}" y="${a - 35}">${escape(e.label || "")}</text>`;
      })
      .join("")}${f.nodes.map(shape).join("")}</svg>`;
}
function renderAST() {
  try {
    $("ast-content").textContent = JSON.stringify(
      $<HTMLSelectElement>("ast-mode").value === "AST"
        ? parse(editor.state.doc.toString(), currentProfile()).body
        : lex(editor.state.doc.toString()),
      null,
      2,
    );
  } catch (e: any) {
    $("ast-content").textContent = e.message;
  }
}
$("flow-module").onchange = renderFlow;
$("flow-content").onclick = (e) => {
  const element = (e.target as Element).closest("[data-line]");
  const line = Number(element?.getAttribute("data-line"));
  if (line > 0) {
    editor.dispatch({
      selection: { anchor: editor.state.doc.line(line).from },
      effects: EditorView.scrollIntoView(editor.state.doc.line(line).from),
    });
    editor.focus();
  }
};
$("ast-mode").onchange = renderAST;
$("target").onchange = invalidateConversion;
$("convert").onclick = async () => {
  if (examMode) return;
  const source = editor.state.doc.toString(),
    profileKey = analysisProfileKey(),
    target = $<HTMLSelectElement>("target").value as Target;
  const fileSnapshot = files,
    policyKey = JSON.stringify(policyState);
  $<HTMLButtonElement>("convert").disabled = true;
  try {
    const { transpile } = await import("../core/transpile");
    if (
      examMode ||
      source !== editor.state.doc.toString() ||
      profileKey !== analysisProfileKey() ||
      target !== $<HTMLSelectElement>("target").value ||
      fileSnapshot !== files ||
      policyKey !== JSON.stringify(policyState)
    )
      return;
    converted = transpile(source, language, target, {
      files,
      seed: randomSeed(),
      maxSteps: maxSteps(),
      policies: policyState,
      profileOptions: {
        guideVersion,
        logicalPrecedence: currentProfile().logicalPrecedence,
      },
    });
    $("export-content").textContent = converted;
    $<HTMLButtonElement>("export-download").disabled = !converted;
  } catch (e: any) {
    converted = "";
    $("export-content").textContent = e.message;
    $<HTMLButtonElement>("export-download").disabled = true;
  } finally {
    $<HTMLButtonElement>("convert").disabled = examMode;
  }
};
$("export-download").onclick = () => {
  if (converted)
    download(
      $<HTMLSelectElement>("target").value === "java"
        ? "Main.java"
        : $<HTMLSelectElement>("target").value === "vb"
          ? "Program.vb"
          : "main.py",
      converted,
    );
};
function renderReference() {
  const p = currentProfile();
  const select = (id: string, items: string[], value: string) =>
    `<select id="${id}">${items.map((v) => `<option value="${v}" ${v === value ? "selected" : ""}>${v}</option>`).join("")}</select>`;
  const policyChoices: Record<string, string[]> = {
    divNegative: ["truncate", "floor"],
    intNegative: ["truncate", "floor"],
    roundHalf: ["away", "even"],
    forBounds: ["once", "eachIteration"],
    shortCircuit: ["true", "false"],
    realOutput: ["compact", "preserve"],
    booleanOutput: ["upper", "lower"],
    filenameCase: ["sensitive", "insensitive"],
  };
  $("reference").innerHTML =
    `<h3>运行与规范设置</h3><div class="settings-grid"><label>Guide 版本 ${select("guide-version", ["2026", "2027–2029"], guideVersion)}</label><label>逻辑优先级 ${select("logical-precedence", ["standard", "leftToRight"], currentProfile().logicalPrecedence)}</label><label>检查模式 ${select("strictness", ["exam", "learning", "lenient"], strictness)}</label><label>指令上限 <input id="max-steps" type="number" required min="1" max="1000000000" value="${maxSteps()}"></label><label>随机种子 <input id="random-seed" type="number" required min="0" max="4294967295" value="${randomSeed()}"></label><label><input id="style-checks" type="checkbox" ${p.styleChecks ? "checked" : ""}> 风格检查（PascalCase / 缩进）</label></div><h3>${escape(p.id)} · ${escape(p.version)}</h3><p>语法依据 Cambridge 官方公开文档。0478/2210 使用 2026–2028 v6；9618 使用所选 Guide 与 June 2024 Insert。AS/A2 特性边界依据 9618 考纲 10、19、20 节。</p><h3>模糊语义策略</h3><p>下列选项是官方未完全规定的运行策略；修改后同时应用到解释器和三语言导出。高速优化仅用于默认策略，调试模式始终保留逐语句语义。</p><div class="settings-grid">${Object.entries(
      policyChoices,
    )
      .map(
        ([name, values]) =>
          `<label>${name}${select("policy-" + name, values, String((policyState as any)[name]))}</label>`,
      )
      .join("")}</div><h3>内置函数签名与来源</h3>${p.builtins
      .map((name) => {
        const sig = builtinSignature(name, p)!;
        return `<details class="signature-entry"><summary><code>${escape(signatureText(sig))}</code></summary><p>${escape(sig.description)}</p><a href="${sig.source.url}" target="_blank" rel="noreferrer">${escape(sig.source.doc)} · ${escape(sig.source.version)} · ${escape(sig.source.section)}</a></details>`;
      })
      .join("")}<h3>默认策略说明</h3><table>${Object.entries(p.policies)
      .map(([k, v]) => `<tr><th>${escape(k)}</th><td>${escape(v)}</td></tr>`)
      .join(
        "",
      )}</table><h3>规范来源</h3><a href="${p.source.url}" target="_blank" rel="noreferrer">${escape(p.source.doc)} · ${escape(p.source.version)} · ${escape(p.source.section)}</a>`;
  $("logical-precedence").onchange = () => {
    settings.setItem(
      "logicalPrecedence",
      $<HTMLSelectElement>("logical-precedence").value,
    );
    stop();
    invalidateConversion();
    forceLinting(editor);
    diagnose(editor.state.doc.toString());
  };
  $("guide-version").onchange = () => {
    guideVersion = $<HTMLSelectElement>("guide-version").value as any;
    settings.setItem("guideVersion", guideVersion);
    stop();
    invalidateConversion();
    forceLinting(editor);
    diagnose(editor.state.doc.toString());
    renderReference();
  };
  $("strictness").onchange = () => {
    strictness = $<HTMLSelectElement>("strictness").value as any;
    settings.setItem("strictness", strictness);
    stop();
    invalidateConversion();
    forceLinting(editor);
    diagnose(editor.state.doc.toString());
  };
  $("style-checks").onchange = () => {
    settings.setItem(
      "styleChecks",
      String($<HTMLInputElement>("style-checks").checked),
    );
    forceLinting(editor);
    invalidateConversion();
    diagnose(editor.state.doc.toString());
  };
  for (const [id, name] of [
    ["max-steps", "maxSteps"],
    ["random-seed", "seed"],
  ])
    $(id).onchange = () => {
      const input = $<HTMLInputElement>(id);
      input.setCustomValidity("");
      if (input.checkValidity() && Number.isInteger(Number(input.value))) {
        settings.setItem(name, input.value);
        stop();
        invalidateConversion();
        $("runtime-info").textContent =
          `指令上限 ${maxSteps().toLocaleString()} · 随机种子 ${randomSeed()}`;
      } else {
        if (input.value && !Number.isInteger(Number(input.value)))
          input.setCustomValidity("请输入整数 / Enter an integer");
        input.reportValidity();
        input.value = String(name === "seed" ? randomSeed() : maxSteps());
        input.setCustomValidity("");
      }
    };
  for (const name of Object.keys(policyChoices))
    $("policy-" + name).onchange = () => {
      const value = $<HTMLSelectElement>("policy-" + name).value;
      (policyState as any)[name] =
        name === "shortCircuit" ? value === "true" : value;
      settings.setItem("policies", JSON.stringify(policyState));
      stop();
      invalidateConversion();
    };
}
function putVirtualFile(name: string, value: VirtualFile) {
  if (busy) stop();
  Object.defineProperty(files, name, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  invalidateConversion();
}
async function importVirtualFile(file: File) {
  const text = await file.text();
  const incoming = file.name.endsWith(".pufiles.json")
    ? importFiles(text)
    : { [file.name]: { text } };
  for (const [original, value] of Object.entries(incoming)) {
    let name = original,
      number = 2;
    while (Object.prototype.hasOwnProperty.call(files, name))
      name = original + " (" + number++ + ")";
    putVirtualFile(name, value);
  }
}
let editingFile = "";
function renderFiles() {
  $("files").innerHTML = Object.keys(files).length
    ? Object.keys(files)
        .map(
          (k) =>
            `<div class="virtual-file"><button data-file="${escape(k)}" title="${escape(k)}">▤ ${escape(k)}</button><button data-export-file="${escape(k)}" aria-label="下载文件 / Download ${escape(k)}" title="下载文件 / Download">↓</button><button data-delete="${escape(k)}" aria-label="删除文件 / Delete ${escape(k)}">×</button></div>`,
        )
        .join("")
    : '<span class="empty">暂无文件 · 运行 WRITEFILE 可创建</span>';
}
async function persistFiles() {
  try {
    await saveFiles(files);
  } catch {
    log("文件持久化失败，请导出备份。", "warning");
    $("storage-warning").hidden = false;
  }
}
function editFile(name: string) {
  editingFile = name;
  $("file-title").textContent = name;
  $<HTMLTextAreaElement>("file-text").value = files[name]?.text || "";
  $("file-record-note").hidden = !files[name]?.records;
  $<HTMLDialogElement>("file-dialog").showModal();
}
$("add-file").onclick = () => {
  const name = prompt("文件名 / Filename");
  if (name?.trim()) {
    if (Object.prototype.hasOwnProperty.call(files, name.trim())) {
      alert(
        "文件已存在，请点击文件名编辑，或选择不同名称。 / File exists. Open it to edit or choose another name.",
      );
      return;
    }
    editFile(name.trim());
  }
};
$("files").onclick = (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("button");
  if (!el) return;
  if (el.dataset.file) editFile(el.dataset.file);
  if (el.dataset.exportFile) {
    const name = el.dataset.exportFile,
      file = files[name];
    if (file.records)
      download(
        name + ".pufiles.json",
        exportFiles({ [name]: file }),
        "application/json",
      );
    else download(name, file.text);
  }
  if (el.dataset.delete && confirm("删除此文件？")) {
    if (busy) stop();
    delete files[el.dataset.delete];
    invalidateConversion();
    renderFiles();
    void persistFiles();
  }
};
$("file-save").onclick = () => {
  putVirtualFile(editingFile, {
    ...files[editingFile],
    text: $<HTMLTextAreaElement>("file-text").value,
  });
  renderFiles();
  void persistFiles();
};
$("backup-files").onclick = () =>
  download("workspace.pufiles.json", exportFiles(files), "application/json");
$("import-file").onclick = () => $("file-upload").click();
$("file-upload").onchange = async () => {
  const input = $<HTMLInputElement>("file-upload"),
    f = input.files?.[0];
  try {
    if (f) {
      await importVirtualFile(f);
      renderFiles();
      await persistFiles();
    }
  } catch (error: any) {
    log("无法导入文件 / Import failed: " + error.message, "error");
    showTab("console");
  } finally {
    input.value = "";
  }
};
$("diagnostics").onclick = (e) => {
  const fix = (e.target as Element).closest<HTMLElement>("[data-fix]");
  if (fix) {
    if (examMode) return;
    const [index, action] = fix.dataset.fix!.split(":").map(Number);
    const edits = latestDiagnostics[index]?.actions?.[action]?.edits;
    if (edits) editor.dispatch({ changes: edits });
    return;
  }
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-line]");
  if (b) {
    const n = Math.min(Number(b.dataset.line), editor.state.doc.lines);
    editor.dispatch({
      selection: { anchor: editor.state.doc.line(n).from },
      effects: EditorView.scrollIntoView(editor.state.doc.line(n).from),
    });
    editor.focus();
  }
};
$("theme").onclick = () => {
  document.body.classList.toggle("dark");
  settings.setItem(
    "theme",
    document.body.classList.contains("dark") ? "dark" : "light",
  );
};
if (settings.getItem("theme") === "dark") document.body.classList.add("dark");
$("help-nav").onclick = () => showTab("reference");
$("examples-nav").onclick = () => $<HTMLSelectElement>("examples").focus();
$("workspace-nav").onclick = () => editor.focus();
loadFiles()
  .then((f) => {
    files = f;
    renderFiles();
  })
  .catch(() => {
    renderFiles();
    log("IndexedDB 不可用，文件仅在内存中保存。", "warning");
    $("storage-warning").hidden = false;
  })
  .finally(() => {
    filesReady = true;
    buttons();
  });
diagnose(editor.state.doc.toString());

async function jumpDefinition() {
  if (examMode) return;
  const word = editor.state.wordAt(editor.state.selection.main.head);
  if (!word) return;
  const doc = editor.state.doc;
  let def: Definition | undefined;
  try {
    def = await languageQuery<Definition | undefined>("definition", {
      name: editor.state.sliceDoc(word.from, word.to),
      line: doc.lineAt(word.from).number,
      column: word.from - doc.lineAt(word.from).from + 1,
    });
  } catch {
    return;
  }
  if (doc !== editor.state.doc) return;
  if (def) {
    editor.dispatch({
      selection: { anchor: editor.state.doc.line(def.line).from },
      effects: EditorView.scrollIntoView(editor.state.doc.line(def.line).from),
    });
    editor.focus();
  }
}
async function renameSymbol() {
  if (examMode) return;
  const word = editor.state.wordAt(editor.state.selection.main.head);
  if (!word) return;
  const name = editor.state.sliceDoc(word.from, word.to),
    replacement = prompt("重命名 / Rename " + name, name);
  if (!replacement || replacement === name) return;
  try {
    const doc = editor.state.doc;
    const text = await languageQuery<string>("rename", {
      name,
      replacement,
      line: doc.lineAt(word.from).number,
      column: word.from - doc.lineAt(word.from).from + 1,
    });
    if (doc !== editor.state.doc) return;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: text },
    });
  } catch (e: any) {
    if (e.name !== "AbortError") {
      log(e.message, "error");
      showTab("console");
    }
  }
}
status("就绪");

$("print-pdf").onclick = () => {
  try {
    printSource(editor.state.doc.toString(), sourceName);
  } catch (e: any) {
    log(e.message, "error");
    showTab("console");
  }
};
function renderOutline(items: { name: string; kind: string; line: number }[]) {
  if (!$("outline")) return;
  $("outline").innerHTML = items.length
    ? items
        .map(
          (n) =>
            `<button class="outline-entry" data-outline-line="${n.line}"><span>${escape(n.kind)}</span>${escape(n.name)}</button>`,
        )
        .join("")
    : '<span class="empty">主程序 · 尚无子程序或自定义类型</span>';
}
$("outline").onclick = (e) => {
  const element = (e.target as Element).closest<HTMLElement>(
    "[data-outline-line]",
  );
  if (element) {
    const line = Number(element.dataset.outlineLine);
    editor.dispatch({
      selection: { anchor: editor.state.doc.line(line).from },
      effects: EditorView.scrollIntoView(editor.state.doc.line(line).from),
    });
    editor.focus();
  }
};

$("files").ondragover = (e) => {
  e.preventDefault();
  $("files").classList.add("drag-active");
};
$("files").ondragleave = () => $("files").classList.remove("drag-active");
$("files").ondrop = async (e) => {
  e.preventDefault();
  $("files").classList.remove("drag-active");
  if (!filesReady) return;
  try {
    for (const file of Array.from(e.dataTransfer?.files || []))
      await importVirtualFile(file);
    renderFiles();
    await persistFiles();
  } catch (error: any) {
    log("无法导入文件 / Import failed: " + error.message, "error");
    showTab("console");
  }
};

function persistEditorSource(source: string) {
  if (examMode) {
    // Expiry can lock and restore the last timely answer. Run it after the
    // current CodeMirror transaction, since it may dispatch another change.
    queueMicrotask(() => {
      if (examMode) examController?.sourceChanged();
    });
    $("save-state").textContent = "考试答卷 · 独立保存";
    return;
  }
  const saved = settings.setItem("source", source);
  $("save-state").textContent = saved ? "已保存本机" : "未保存 · 请下载";
  practiceController?.sourceChanged();
}

function replaceWorkspaceSource(source: string) {
  editor.dispatch({ effects: setupConfig.reconfigure([]) });
  setSource(source, false);
  editor.dispatch({
    effects: setupConfig.reconfigure(examMode ? minimalSetup : basicSetup),
  });
}

function currentEnvironment(): ExamEnvironment {
  return {
    dialect: language,
    guideVersion,
    strictness,
    styleChecks: currentProfile().styleChecks,
    logicalPrecedence: currentProfile().logicalPrecedence,
    policies: { ...policyState },
    maxSteps: maxSteps(),
    seed: randomSeed(),
    runMode,
    fastMode: $<HTMLInputElement>("fast-mode").checked,
    sourceName,
  };
}
function applyEnvironment(config: ExamEnvironment) {
  if (!validConfig(config)) return;
  stop();
  guideVersion = config.guideVersion;
  strictness = config.strictness;
  policyState = { ...config.policies };
  runMode = config.runMode;
  sourceName = config.sourceName;
  for (const [key, value] of Object.entries({
    guideVersion,
    strictness,
    styleChecks: String(config.styleChecks),
    logicalPrecedence: config.logicalPrecedence,
    policies: JSON.stringify(policyState),
    maxSteps: String(config.maxSteps),
    seed: String(config.seed),
    runMode,
    sourceName,
  }))
    settings.setItem(key, value);
  $<HTMLSelectElement>("run-mode").value = runMode;
  $<HTMLInputElement>("fast-mode").checked = config.fastMode;
  $("source-name").textContent = sourceName;
  setDialect(config.dialect, true);
  syncExamControls();
}

const learningExtensions = {
  hover: hoverConfig.get(editor.state) ?? [],
  completion: completionConfig.get(editor.state) ?? [],
  lint: lintConfig.get(editor.state) ?? [],
};
function syncExamControls() {
  document.body.classList.toggle("exam-active", examMode);
  for (const id of [
    "dialect",
    "examples",
    "run-mode",
    "fast-mode",
    "format",
    "upload",
    "source-upload",
    "examples-nav",
    "help-nav",
    "practice-open",
    "convert",
    "watch-input",
    "clear-breakpoints",
  ])
    $<HTMLButtonElement>(id).disabled = examMode;
  document
    .querySelectorAll<HTMLButtonElement>("[data-tab]")
    .forEach((button) => {
      button.disabled = examMode && button.dataset.tab !== "console";
    });
  document
    .querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      "#reference input, #reference select",
    )
    .forEach((input) => (input.disabled = examMode));
  if (examMode) {
    $("signature-help").hidden = true;
    $<HTMLButtonElement>("export-download").disabled = true;
    showTab("console");
  }
  buttons();
}
function examStateChanged(session: ExamSession | null) {
  const changedMode = examMode !== !!session;
  examMode = !!session;
  examLocked = !!session && session.status !== "running";
  clearTimeout(autoRunTimer);
  clearTimeout(diagnosticTimer);
  analysisController.cancel();
  queryController.cancel();
  if (changedMode) {
    examFiles = {};
    // Reset history at the document boundary, so Undo cannot switch between a
    // normal draft and a separately saved examination answer.
    editor.dispatch({ effects: setupConfig.reconfigure([]) });
    editor.dispatch({
      effects: [
        setupConfig.reconfigure(examMode ? minimalSetup : basicSetup),
        hoverConfig.reconfigure(examMode ? [] : learningExtensions.hover),
        completionConfig.reconfigure(
          examMode ? [] : learningExtensions.completion,
        ),
        lintConfig.reconfigure(examMode ? [] : learningExtensions.lint),
      ],
    });
  }
  editor.dispatch({
    effects: readOnlyConfig.reconfigure([
      EditorState.readOnly.of(examLocked),
      EditorView.editable.of(!examLocked),
    ]),
  });
  if (examMode) {
    latestDiagnostics = [];
    $("diagnostic-count").textContent = "0";
    editor.dispatch(setDiagnostics(editor.state, []));
  } else {
    analysisPaused = false;
  }
  clearDebugState();
  syncExamControls();
  practiceController?.refresh();
}

// Practice is mounted first so a restored exam can immediately suspend its
// independent grader without copying the exam answer into a practice draft.
practiceController = mountPractice({
  container: $("practice"),
  settings,
  readSource: () => editor.state.doc.toString(),
  writeSource: replaceWorkspaceSource,
  readDialect: () => language,
  captureEnvironment: currentEnvironment,
  restoreEnvironment: (config) => {
    if (validConfig(config)) applyEnvironment(config);
  },
  applyDialect: (dialect) =>
    applyEnvironment({
      ...currentEnvironment(),
      dialect,
      guideVersion: "2026",
      strictness: "exam",
      styleChecks: false,
      logicalPrecedence: "standard",
      policies: { ...defaultPolicies },
      seed: 123456789,
      maxSteps: 50000,
      runMode: "manual",
      fastMode: false,
      sourceName: "practice-answer.pseudo",
    }),
  examActive: () => examMode,
  focusEditor: () => editor.focus(),
});
examController = createExamController({
  settings,
  getSource: () => editor.state.doc.toString(),
  setSource: replaceWorkspaceSource,
  getConfig: currentEnvironment,
  applyConfig: applyEnvironment,
  stopExecution: stop,
  onStateChange: examStateChanged,
});
document
  .querySelector(".toolbar")!
  .insertAdjacentElement("afterend", examController.element);
$("exam-open").onclick = () => {
  const details = $<HTMLDetailsElement>("exam-details");
  details.open = true;
  details.scrollIntoView({ block: "nearest", behavior: "smooth" });
};
$("practice-open").onclick = () => {
  showTab("practice");
  $("practice").scrollIntoView({ block: "nearest", behavior: "smooth" });
};
