import { test } from "node:test";
import assert from "node:assert/strict";
import { setCoreLocale } from "../core/i18n";
import {
  startExam,
  exportExamAnswer,
  type ExamEnvironment,
} from "../core/exam";
import { defaultPolicies } from "../core/policies";
import { examples, getExamples } from "../web/examples";
import { examBuiltinDescription, examPolicyText } from "../web/exam-copy";

const config: ExamEnvironment = {
  dialect: "0478",
  guideVersion: "2026",
  strictness: "learning",
  styleChecks: true,
  logicalPrecedence: "standard",
  policies: { ...defaultPolicies },
  maxSteps: 50000,
  seed: 123,
  runMode: "manual",
  fastMode: false,
  sourceName: "normal.pseudo",
};

test("exam validation uses the selected interface language", () => {
  try {
    setCoreLocale("en");
    assert.throws(
      () =>
        startExam(
          "",
          config,
          { dialect: "0478", guideVersion: "2026", minutes: 0 },
          1000,
        ),
      /Exam duration must be a whole number from 1–300 minutes/,
    );
    assert.throws(
      () =>
        startExam(
          "",
          config,
          { dialect: "0478", guideVersion: "2026", minutes: 1 },
          NaN,
        ),
      /Invalid system time/,
    );
    setCoreLocale("zh-CN");
    assert.throws(
      () =>
        startExam(
          "",
          config,
          { dialect: "0478", guideVersion: "2026", minutes: 0 },
          1000,
        ),
      /考试时长必须是 1–300 分钟的整数/,
    );
  } finally {
    setCoreLocale("en");
  }
});

test("exam record localization preserves the answer, timestamps and settings", () => {
  const session = startExam(
    "普通草稿",
    config,
    {
      dialect: "0478",
      guideVersion: "2026",
      minutes: 1,
      initialSource: 'OUTPUT "我的答卷"',
    },
    1000,
  );
  try {
    setCoreLocale("en");
    const english = JSON.parse(exportExamAnswer(session));
    assert.match(english.notice, /^Local practice record/);
    setCoreLocale("zh-CN");
    const chinese = JSON.parse(exportExamAnswer(session));
    assert.match(chinese.notice, /^本地模拟练习记录/);
    assert.notEqual(chinese.notice, english.notice);
    delete chinese.notice;
    delete english.notice;
    assert.deepEqual(chinese, english);
    assert.equal(chinese.answer, 'OUTPUT "我的答卷"');
    assert.equal(session.normalSource, "普通草稿");
  } finally {
    setCoreLocale("en");
  }
});

test("localized example catalogs do not mutate the original source catalog", () => {
  const original = structuredClone(examples);
  setCoreLocale("en");
  const english = getExamples();
  assert.equal(english.length, 7);
  assert.equal(english[0].name, "01 · Loops and input");
  assert.match(english[0].code, /^\/\/ Sum the numbers from 1 to N/);
  assert.ok(
    english.every(
      (example) => !/\p{Script=Han}/u.test(example.name + example.code),
    ),
  );
  const chinese = getExamples("zh-CN");
  assert.deepEqual(chinese, original);
  english[0].code = "changed source";
  assert.deepEqual(examples, original);
});

test("Insert descriptions and policy labels update without changing configuration", () => {
  const original = structuredClone(config);
  try {
    setCoreLocale("en");
    assert.equal(
      examBuiltinDescription("LENGTH", "Length of the string"),
      "Length of the string",
    );
    const english = examPolicyText(config);
    assert.match(english, /Logical precedence: NOT > AND > OR/);
    assert.match(english, /Step limit: 50000/);
    assert.doesNotMatch(english, /\p{Script=Han}/u);
    setCoreLocale("zh-CN");
    assert.equal(
      examBuiltinDescription("LENGTH", "Length of the string"),
      "字符串的长度",
    );
    assert.match(examPolicyText(config), /步数上限: 50000/);
    assert.deepEqual(config, original);
  } finally {
    setCoreLocale("en");
  }
});
