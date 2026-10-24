import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startExam,
  expireExam,
  submitExam,
  parseExamSession,
  examClock,
  examRules,
  exportExamAnswer,
  EXAM_SESSION_KEY,
  EXAM_ARCHIVE_KEY,
  type ExamEnvironment,
} from "../core/exam";
import { defaultPolicies } from "../core/policies";
const config = (): ExamEnvironment => ({
  dialect: "0478",
  guideVersion: "2026",
  strictness: "learning",
  styleChecks: true,
  logicalPrecedence: "leftToRight",
  policies: { ...defaultPolicies, roundHalf: "even" },
  maxSteps: 5000,
  seed: 17,
  runMode: "change",
  fastMode: true,
  sourceName: "normal.pseudo",
});
const options = {
  dialect: "9618-AS" as const,
  guideVersion: "2027–2029" as const,
  minutes: 45,
};

test("exam starts with a separate answer and captures the complete original environment", () => {
  const normal = config(),
    session = startExam('OUTPUT "normal"', normal, options, 1000);
  assert.equal(session.status, "running");
  assert.equal(session.answer, "");
  assert.equal(session.normalSource, 'OUTPUT "normal"');
  assert.deepEqual(session.normalConfig, normal);
  assert.equal(session.deadline, 2701000);
  assert.equal(session.config.dialect, "9618-AS");
  assert.equal(session.config.guideVersion, "2027–2029");
  assert.equal(session.config.strictness, "exam");
  assert.equal(session.config.styleChecks, false);
  assert.equal(session.config.runMode, "manual");
  assert.equal(session.config.fastMode, false);
  assert.equal(session.config.policies.roundHalf, "even");
  assert.equal(session.config.logicalPrecedence, "leftToRight");
});
test("starting and editing an exam cannot mutate the ordinary draft or original policies", () => {
  const normal = config(),
    session = startExam(
      "normal",
      normal,
      { ...options, initialSource: "starter" },
      1000,
    );
  session.answer = "answer";
  normal.policies.roundHalf = "away";
  session.config.policies.divNegative = "floor";
  assert.equal(session.normalSource, "normal");
  assert.equal(session.normalConfig.policies.roundHalf, "even");
  assert.equal(session.normalConfig.policies.divNegative, "truncate");
  assert.equal(session.answer, "answer");
});
test("an intentionally empty normal draft and empty answer survive a session round trip", () => {
  const session = startExam("", config(), options, 1000);
  assert.deepEqual(parseExamSession(JSON.stringify(session)), session);
  assert.equal(parseExamSession(JSON.stringify(session))!.normalSource, "");
});
test("restoring an exam uses the recorded absolute deadline and expires after sleep", () => {
  const session = startExam(
    "normal",
    config(),
    { ...options, minutes: 1 },
    1000,
  );
  session.answer = "saved answer";
  const restored = parseExamSession(JSON.stringify(session))!;
  assert.equal(expireExam(restored, 60999), restored);
  const expired = expireExam(restored, 1000000);
  assert.equal(expired.status, "expired");
  assert.equal(expired.deadline, 61000);
  assert.equal(expired.completedAt, 61000);
  assert.equal(expired.answer, "saved answer");
  assert.deepEqual(expireExam(expired, 2000000), expired);
});
test("submission freezes the current answer and cannot replace the completion timestamp", () => {
  const session = startExam("normal", config(), options, 1000);
  session.answer = "final answer";
  const submitted = submitExam(session, 1100);
  assert.equal(submitted.status, "submitted");
  assert.equal(submitted.completedAt, 1100);
  assert.equal(submitted.answer, "final answer");
  assert.equal(submitExam(submitted, 2000), submitted);
  assert.equal(expireExam(submitted, 10000000), submitted);
});
test("a submission at or after the deadline is an expiry rather than a late submission", () => {
  const session = startExam(
    "normal",
    config(),
    { ...options, minutes: 1 },
    1000,
  );
  const submitted = submitExam(session, session.deadline);
  assert.equal(submitted.status, "expired");
  assert.equal(submitted.completedAt, session.deadline);
});
test("invalid and corrupt exam records do not produce a partly configured session", () => {
  const session = startExam("normal", config(), options, 1000);
  for (const value of [null, "{", "[]", "null", '"string"'])
    assert.equal(parseExamSession(value), null);
  for (const change of [
    { status: "garbage" },
    { answer: 10 },
    { normalSource: null },
    { deadline: 1000 },
    { startedAt: null },
    { savedAt: "today" },
    { config: {} },
    { version: 2 },
    { config: { ...config(), seed: -1 } },
    { config: { ...config(), maxSteps: 1e10 } },
    {
      config: {
        ...config(),
        policies: { ...defaultPolicies, shortCircuit: "false" },
      },
    },
  ])
    assert.equal(
      parseExamSession(JSON.stringify({ ...session, ...change })),
      null,
    );
});
test("exam duration validation rejects fractions and values outside the local supported range", () => {
  for (const minutes of [0, -1, 1.5, 301, NaN, Infinity])
    assert.throws(
      () => startExam("", config(), { ...options, minutes }, 1000),
      /1–300/,
    );
  assert.equal(
    startExam("", config(), { ...options, minutes: 300 }, 1000).deadline,
    18001000,
  );
});
test("the countdown is clamped and derives from deadline instead of counting timer ticks", () => {
  assert.equal(examClock(61000, 1000), "01:00");
  assert.equal(examClock(61000, 1001), "01:00");
  assert.equal(examClock(61000, 60999), "00:01");
  assert.equal(examClock(61000, 61000), "00:00");
  assert.equal(examClock(61000, 100000000), "00:00");
});
test("Insert rules use the actual selected dialect and version", () => {
  const asRules = examRules({
    ...config(),
    dialect: "9618-AS",
    guideVersion: "2027–2029",
  });
  assert.match(asRules.label, /9618-AS.*2027–2029/);
  assert.ok(asRules.profile.builtins.includes("MID"));
  assert.ok(!asRules.profile.builtins.includes("SUBSTRING"));
  const igRules = examRules({ ...config(), guideVersion: "2027–2029" });
  assert.match(igRules.label, /2026–2028-v6/);
  assert.ok(igRules.profile.builtins.includes("SUBSTRING"));
});
test("downloaded exam records include settings and answer but exclude the ordinary source backup", () => {
  const session = startExam("private ordinary draft", config(), options, 1000);
  session.answer = "exam answer";
  const json = exportExamAnswer(submitExam(session, 1100)),
    value = JSON.parse(json);
  assert.equal(value.answer, "exam answer");
  assert.equal(value.status, "submitted");
  assert.equal(value.config.policies.roundHalf, "even");
  assert.ok(!("normalSource" in value));
  assert.ok(!("normalConfig" in value));
  assert.ok(!json.includes("private ordinary draft"));
  assert.match(value.notice, /本地模拟练习/);
});
test("exam storage keys are separate from ordinary source and from the retained last answer", () => {
  assert.notEqual(EXAM_SESSION_KEY, "source");
  assert.notEqual(EXAM_ARCHIVE_KEY, "source");
  assert.notEqual(EXAM_SESSION_KEY, EXAM_ARCHIVE_KEY);
});
