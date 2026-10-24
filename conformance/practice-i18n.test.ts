import { test } from "node:test";
import assert from "node:assert/strict";
import { setCoreLocale } from "../core/i18n";
import {
  practiceExercises,
  getPracticeExercises,
  practiceExercise,
  practiceResultFeedback,
  evaluatePracticeCase,
} from "../core/practice";
import { practiceSolutions } from "./practice-solutions";

const han = /\p{Script=Han}/u;

test("English is the default practice language and all ten exercises have complete translated copy", () => {
  setCoreLocale("en");
  const exercises = getPracticeExercises();
  assert.equal(exercises.length, 10);
  for (const [index, english] of exercises.entries()) {
    const chinese = getPracticeExercises("zh-CN")[index];
    assert.equal(chinese, practiceExercises[index]);
    assert.equal(english.id, chinese.id);
    assert.equal(english.dialect, chinese.dialect);
    assert.equal(english.minutes, chinese.minutes);
    for (const field of [
      english.title,
      ...english.topics,
      english.statement,
      english.inputContract,
      english.outputContract,
      english.starter,
    ]) {
      assert.ok(field.length > 0);
      assert.doesNotMatch(field, han);
    }
    assert.match(chinese.title, han);
    for (const [caseIndex, check] of english.cases.entries()) {
      assert.doesNotMatch(check.criterion + check.advice, han);
      assert.deepEqual(check.input, chinese.cases[caseIndex].input);
      assert.deepEqual(check.output, chinese.cases[caseIndex].output);
      assert.equal(check.public, chinese.cases[caseIndex].public);
      assert.equal(check.points, chinese.cases[caseIndex].points);
      const result = evaluatePracticeCase(
        practiceSolutions[english.id],
        english,
        caseIndex,
        "en",
      );
      assert.equal(result.passed, true);
      assert.doesNotMatch(result.feedback, han);
    }
  }
});

test("saved feedback follows the selected language while preserving the original result and program output", () => {
  const chinese = practiceExercise("temperature", "zh-CN")!;
  const source = practiceSolutions.temperature.replace(
    "Temperature <= 0",
    "Temperature < 0",
  );
  const result = evaluatePracticeCase(source, chinese, 2, "zh-CN");
  const saved = JSON.stringify(result);
  assert.match(result.feedback, han);
  const english = practiceResultFeedback(result, chinese, "en");
  assert.doesNotMatch(english, han);
  assert.match(english, /0/);
  assert.match(practiceResultFeedback(result, chinese, "zh-CN"), /零度边界/);
  assert.equal(JSON.stringify(result), saved);
  const publicCase = evaluatePracticeCase(
    'DECLARE X : INTEGER\nINPUT X\nOUTPUT "用户输出"',
    practiceExercise("temperature", "en")!,
    0,
    "en",
  );
  assert.deepEqual(publicCase.actual, ["用户输出"]);
  assert.doesNotMatch(publicCase.feedback, han);
});

test("practice execution failures and saved timeout results are localized without changing grading codes", () => {
  const exercise = practiceExercise("sum-two", "en")!;
  const extra = evaluatePracticeCase(
    "DECLARE X : INTEGER\nINPUT X\nINPUT X\nINPUT X",
    exercise,
    0,
    "en",
  );
  assert.equal(extra.code, "INPUT_EXCESS");
  assert.doesNotMatch(extra.feedback, han);
  assert.match(practiceResultFeedback(extra, exercise, "zh-CN"), /额外输入/);
  const timeout = {
    index: 1,
    passed: false,
    score: 0,
    maxScore: 20,
    code: "TIMEOUT",
    feedback: "执行超过 4 秒，已终止 Worker。",
  };
  assert.match(
    practiceResultFeedback(timeout, exercise, "en"),
    /exceeded 4 seconds/,
  );
  assert.match(
    practiceResultFeedback(timeout, exercise, "zh-CN"),
    /执行超过 4 秒/,
  );
});
