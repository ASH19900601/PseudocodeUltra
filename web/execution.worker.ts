import { expression, type Expr } from "../core/lexer";
import { Machine, display, type Event } from "../core/runtime";
import { localizeMessage, setCoreLocale, tr } from "../core/i18n";
let machine: Machine | undefined,
  result: IteratorResult<Event, any> | undefined,
  active = false,
  waiting = false,
  skip = false,
  mode = "run",
  depth = 0,
  breakpoints: number[] = [],
  trace: Event[] = [],
  batch: Event[] = [],
  traceLimit = 50000,
  traceIndex = 0,
  truncated = false,
  timer: ReturnType<typeof setTimeout> | undefined;
const send = (type: string, data: any = {}) => postMessage({ type, ...data });
const flush = () => {
  if (batch.length) {
    send("events", { events: batch });
    batch = [];
  }
};
function append(e: Event) {
  if (trace.length < traceLimit) trace.push(e);
  else {
    trace[traceIndex] = e;
    traceIndex = (traceIndex + 1) % traceLimit;
    truncated = true;
  }
  batch.push(e);
}
function fail(e: any) {
  active = false;
  flush();
  send("error", {
    message: localizeMessage(e.message),
    rawMessage: e.message,
    code: e.code || "RUNTIME",
    line: e.line || machine?.line || 1,
    column: e.column || machine?.column || 1,
    source: e.source,
    stack: e.frames || machine?.stack,
    files: machine?.files,
    state: machine
      ? {
          kind: "step",
          line: machine.line,
          variables: machine.snapshot(machine.currentScope),
          values: machine.inspect(machine.currentScope),
          stack: [...machine.stack],
        }
      : undefined,
  });
}
function pump() {
  if (!active || !machine || !result) return;
  try {
    for (let i = 0; i < 250 && active; i++) {
      if (result.done) {
        active = false;
        flush();
        const ordered = truncated
          ? [...trace.slice(traceIndex), ...trace.slice(0, traceIndex)]
          : trace;
        send("done", {
          files: machine.files,
          trace: ordered,
          truncated,
          steps: machine.steps,
          state: {
            kind: "step",
            line: machine.line,
            variables: machine.snapshot(machine.global),
            values: machine.inspect(machine.global),
            stack: [],
          },
        });
        return;
      }
      const e = result.value;
      if (e.kind === "step") {
        const stop =
          !skip &&
          (mode === "step" ||
            (mode === "over" && (e.stack?.length || 0) <= depth) ||
            (mode === "out" && (e.stack?.length || 0) < depth) ||
            breakpoints.includes(e.line));
        if (stop) {
          active = false;
          flush();
          send("paused", { event: e });
          return;
        }
        append(e);
        skip = false;
      } else if (e.kind === "trace") append(e);
      else if (e.kind === "input") {
        waiting = true;
        active = false;
        flush();
        send("input", {
          line: e.line,
          state: {
            kind: "step",
            line: e.line,
            variables: machine.snapshot(machine.currentScope),
            values: machine.inspect(machine.currentScope),
            stack: [...machine.stack],
          },
        });
        return;
      } else {
        flush();
        send(e.kind, {
          text: e.kind === "warning" ? localizeMessage(e.text || "") : e.text,
          ...(e.kind === "warning" ? { rawText: e.text } : {}),
          line: e.line,
        });
      }
      result = machine.generator.next();
    }
    flush();
    if (active) timer = setTimeout(pump, 0);
  } catch (e) {
    fail(e);
  }
}
onmessage = ({ data: d }) => {
  if (d.type === "locale") {
    setCoreLocale(d.locale === "zh-CN" ? "zh-CN" : "en");
    if (machine) {
      machine.options.inspectionUninitialized = tr("Uninitialized", "未初始化");
      send("debug-locale", {
        state: {
          kind: "step",
          line: machine.line,
          variables: machine.snapshot(machine.currentScope),
          values: machine.inspect(machine.currentScope),
          stack: [...machine.stack],
        },
      });
    }
  } else if (d.type === "start") {
    setCoreLocale(d.locale === "zh-CN" ? "zh-CN" : "en");
    clearTimeout(timer);
    trace = [];
    batch = [];
    traceIndex = 0;
    truncated = false;
    machine = undefined;
    result = undefined;
    traceLimit = Math.max(1, Math.min(100000, d.traceLimit || 50000));
    try {
      machine = new Machine(d.source, d.dialect, {
        inspectionUninitialized: tr("Uninitialized", "未初始化"),
        files: d.files,
        maxSteps: d.maxSteps || 100000,
        strict: d.strict,
        seed: d.seed,
        profileOptions: d.profileOptions,
        fast: d.fast,
        trace: d.trace ?? !d.fast,
        policies: d.policies,
      });
      result = machine.generator.next();
      mode = d.mode;
      depth = 0;
      breakpoints = d.fast ? [] : d.breakpoints || [];
      skip = false;
      waiting = false;
      active = true;
      send("started");
      pump();
    } catch (e) {
      fail(e);
    }
  } else if (d.type === "resume" && machine) {
    if (waiting) {
      send("input", { line: machine.line });
      return;
    }
    mode = d.mode;
    depth = result && !result.done ? result.value.stack?.length || 0 : 0;
    skip = true;
    active = true;
    pump();
  } else if (d.type === "pause") {
    if (waiting) return;
    active = false;
    flush();
    if (result && !result.done) send("paused", { event: result.value });
  } else if (d.type === "input" && waiting && machine) {
    waiting = false;
    try {
      result = machine.generator.next(d.value);
      active = true;
      pump();
    } catch (e) {
      fail(e);
    }
  } else if (d.type === "watch" && machine) {
    const savedLine = machine.line,
      savedColumn = machine.column;
    try {
      const e = expression(
        d.expression,
        1,
        1,
        0,
        !machine.p.whileDo,
        machine.p.logicalPrecedence,
      );
      const safe = (x: Expr): boolean =>
        x.kind === "new"
          ? false
          : x.kind === "name" &&
              !machine!.currentScope.find(x.name) &&
              machine!.modules.has(x.name.toUpperCase())
            ? false
            : x.kind === "call"
              ? x.target.kind === "name" &&
                machine!.p.builtins.includes(x.target.name.toUpperCase()) &&
                !["RAND", "RANDOM"].includes(x.target.name.toUpperCase()) &&
                x.args.every(safe)
              : x.kind === "binary"
                ? safe(x.left) && safe(x.right)
                : x.kind === "unary"
                  ? safe(x.right)
                  : x.kind === "index"
                    ? safe(x.target) && x.args.every(safe)
                    : x.kind === "member" || x.kind === "deref"
                      ? safe(x.target)
                      : true;
      if (!safe(e))
        throw new Error(
          "监视表达式不允许调用用户子程序、NEW 或随机函数 / Watch must be pure",
        );
      const g = machine.eval(e, machine.currentScope),
        value = g.next();
      if (!value.done) throw new Error("Watch cannot suspend");
      send("watch", {
        expression: d.expression,
        value: display(value.value, tr("Uninitialized", "未初始化")),
      });
    } catch (e: any) {
      send("watch", {
        expression: d.expression,
        value: localizeMessage(e.message),
        error: true,
        rawMessage: e.message,
      });
    } finally {
      machine.line = savedLine;
      machine.column = savedColumn;
    }
  } else if (d.type === "breakpoints") breakpoints = d.lines;
};
