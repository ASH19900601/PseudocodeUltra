import { test } from "node:test";
import assert from "node:assert/strict";
import { getLocale, localizeMessage, setCoreLocale, tr } from "../core/i18n";
import { printableHTML } from "../web/print";
import { Machine, display } from "../core/runtime";

test("English is the default and Chinese can be selected explicitly", () => {
  assert.equal(getLocale(), "en");
  assert.equal(tr("Run", "运行"), "Run");
  setCoreLocale("zh-CN");
  assert.equal(tr("Run", "运行"), "运行");
  assert.equal(
    localizeMessage("未声明变量 / Undeclared Name"),
    "未声明变量 / Undeclared Name",
  );
  setCoreLocale("en");
});

test("message localization preserves English tails and interpolated user data", () => {
  assert.equal(
    localizeMessage("文件不存在 / Missing file 中文 / folder.txt", "en"),
    "Missing file 中文 / folder.txt",
  );
  assert.equal(
    localizeMessage(
      "无法识别语句 / Unknown statement: OUTPUT 中文 / value",
      "en",
    ),
    "Unknown statement: OUTPUT 中文 / value",
  );
  assert.equal(localizeMessage("原始中文用户内容", "en"), "原始中文用户内容");
  assert.equal(
    localizeMessage("English / unchanged", "en"),
    "English / unchanged",
  );
  assert.equal(
    localizeMessage("第一行\n输入不是数字 / Invalid numeric input", "en"),
    "第一行\nInvalid numeric input",
  );
});

test("arguments formerly present only in Chinese messages remain visible", () => {
  assert.equal(
    localizeMessage(
      "ROUND 第 2 个参数应为 INTEGER / Invalid argument type",
      "en",
    ),
    "ROUND argument 2 must be INTEGER",
  );
  assert.equal(
    localizeMessage("不能将 REAL 赋给 INTEGER / Incompatible assignment", "en"),
    "Cannot assign REAL to INTEGER",
  );
  assert.equal(
    localizeMessage("中文 / data.txt 未以 READ 打开 / Wrong file mode", "en"),
    "中文 / data.txt is not open in READ mode",
  );
  assert.equal(
    localizeMessage("Test 参数数量错误 / Wrong argument count", "en"),
    "Wrong argument count for Test",
  );
  assert.equal(
    localizeMessage("补充 ENDIF / Insert terminator", "en"),
    "Insert ENDIF",
  );
});

test("known Chinese-only application errors receive English fallbacks", () => {
  assert.equal(
    localizeMessage("此方言不支持 DATE", "en"),
    "Type unavailable in this dialect: DATE",
  );
  assert.equal(localizeMessage("未知运算符 ⊕", "en"), "Unknown operator ⊕");
  assert.equal(
    localizeMessage("未声明循环变量 Level", "en"),
    "Undeclared loop variable Level",
  );
  assert.equal(
    localizeMessage("考试时长必须是 1–300 分钟的整数", "en"),
    "Exam duration must be a whole number from 1 to 300 minutes",
  );
});

test("print output uses selected document language and keeps source literal", () => {
  setCoreLocale("en");
  const source = 'OUTPUT "中文 / English <example>"';
  const english = printableHTML(source);
  assert.match(english, /<html lang="en">/);
  assert.match(english, /中文 \/ English &lt;example&gt;/);
  setCoreLocale("zh-CN");
  assert.match(printableHTML(source), /<html lang="zh-CN">/);
  setCoreLocale("en");
});

test("debug snapshots localize undefined without rewriting matching user strings", () => {
  const source =
    'DECLARE Pending : STRING\nDECLARE Literal : STRING\nDECLARE Entries : ARRAY[1:2] OF STRING\nEntries[2] ← "未初始化"\nLiteral ← "未初始化"\nOUTPUT Literal';
  const legacy = new Machine(source);
  while (!legacy.generator.next().done) {}
  assert.equal(legacy.snapshot(legacy.global).PENDING, "未初始化");
  assert.equal(legacy.inspect(legacy.global).PENDING, "未初始化");
  assert.equal(legacy.snapshot(legacy.global).ENTRIES, "[未初始化, 未初始化]");

  const english = new Machine(source, "0478", {
    inspectionUninitialized: "Uninitialized",
  });
  const output: string[] = [];
  for (const event of english.generator)
    if (event.kind === "output") output.push(event.text!);
  assert.equal(english.snapshot(english.global).PENDING, "Uninitialized");
  assert.equal(english.inspect(english.global).PENDING, "Uninitialized");
  assert.equal(english.snapshot(english.global).LITERAL, "未初始化");
  assert.equal(english.inspect(english.global).LITERAL, "未初始化");
  assert.equal(
    english.snapshot(english.global).ENTRIES,
    "[Uninitialized, 未初始化]",
  );
  assert.deepEqual(english.inspect(english.global).ENTRIES, {
    "[1]": "Uninitialized",
    "[2]": "未初始化",
  });
  const entries = english.global.find("Entries")!.value;
  assert.equal(display(entries), "[未初始化, 未初始化]");
  assert.equal(display(entries, "Uninitialized"), "[Uninitialized, 未初始化]");
  assert.equal(
    display({ tag: "pointer", cell: { value: entries } }, "Uninitialized"),
    "^[Uninitialized, 未初始化]",
  );
  assert.deepEqual(output, ["未初始化"]);
});

test("debug locale changes while INPUT is pending preserve the live session", () => {
  const machine = new Machine(
    "DECLARE Pending : STRING\nINPUT Pending\nOUTPUT Pending",
    "0478",
    { inspectionUninitialized: "Uninitialized" },
  );
  let event = machine.generator.next();
  while (!event.done && event.value.kind !== "input")
    event = machine.generator.next();
  assert.equal(event.done, false);
  assert.equal(machine.inspect(machine.currentScope).PENDING, "Uninitialized");
  machine.options.inspectionUninitialized = "未初始化";
  assert.equal(machine.inspect(machine.currentScope).PENDING, "未初始化");
  machine.options.inspectionUninitialized = "Uninitialized";
  const outputs: string[] = [];
  event = machine.generator.next("未初始化");
  while (!event.done) {
    if (event.value.kind === "output") outputs.push(event.value.text!);
    event = machine.generator.next();
  }
  assert.deepEqual(outputs, ["未初始化"]);
  assert.equal(machine.inspect(machine.global).PENDING, "未初始化");
});
