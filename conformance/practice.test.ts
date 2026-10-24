import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluatePracticeCase,
  practiceExercises,
  normalizePracticeOutput,
  PRACTICE_LIMITS,
} from "../core/practice";
import { practiceSolutions } from "./practice-solutions";

for (const exercise of practiceExercises) {
  test(`original practice ${exercise.id}: independent reference passes all public and non-public cases`, () => {
    assert.ok(exercise.cases.length >= 5);
    assert.ok(exercise.cases.some((item) => item.public));
    assert.ok(exercise.cases.some((item) => !item.public));
    assert.equal(
      exercise.cases.reduce((sum, item) => sum + item.points, 0),
      100,
    );
    assert.match(exercise.starter, /TODO/);
    for (let i = 0; i < exercise.cases.length; i++) {
      const result = evaluatePracticeCase(
        practiceSolutions[exercise.id],
        exercise,
        i,
      );
      assert.equal(
        result.passed,
        true,
        `${exercise.id} case ${i + 1}: ${result.feedback}`,
      );
      assert.equal(result.score, exercise.cases[i].points);
      assert.equal("actual" in result, exercise.cases[i].public);
    }
  });
}
test("practice has 10 original distinct topics, stable ids and no answer as a starter", () => {
  assert.equal(practiceExercises.length, 10);
  assert.equal(new Set(practiceExercises.map((e) => e.id)).size, 10);
  assert.ok(practiceExercises.some((e) => e.dialect === "0478"));
  assert.ok(practiceExercises.some((e) => e.dialect === "9618-AS"));
  for (const e of practiceExercises)
    assert.notEqual(e.starter, practiceSolutions[e.id]);
});
test("practice awards partial credit and actionable boundary feedback", () => {
  const e = practiceExercises[1];
  const source = practiceSolutions.temperature.replace(
    "Temperature <= 0",
    "Temperature < 0",
  );
  const results = e.cases.map((_, i) => evaluatePracticeCase(source, e, i));
  assert.equal(
    results.reduce((sum, r) => sum + r.score, 0),
    80,
  );
  assert.equal(results[2].passed, false);
  assert.match(results[2].feedback, /0/);
});
test("practice limits infinite loops, additional input, unused input and output floods", () => {
  const e = practiceExercises[0];
  const forever = evaluatePracticeCase("WHILE TRUE DO\nENDWHILE", e, 0);
  assert.equal(forever.passed, false);
  assert.match(forever.code!, /LIMIT/);
  const extra = evaluatePracticeCase(
    "DECLARE A : INTEGER\nINPUT A\nINPUT A\nINPUT A",
    e,
    0,
  );
  assert.equal(extra.code, "INPUT_EXCESS");
  const unused = evaluatePracticeCase("OUTPUT 12", e, 0);
  assert.equal(unused.code, "INPUT_UNUSED");
  const flood = evaluatePracticeCase(
    "DECLARE I : INTEGER\nFOR I ← 1 TO 101\nOUTPUT I\nNEXT I",
    e,
    0,
  );
  assert.equal(flood.code, "OUTPUT_LIMIT");
  const huge = evaluatePracticeCase(
    " ".repeat(PRACTICE_LIMITS.source + 1),
    e,
    0,
  );
  assert.equal(huge.code, "SOURCE_LIMIT");
});
test("practice output ignores trailing whitespace, preserves case/blank lines, and rejects prompts", () => {
  assert.deepEqual(normalizePracticeOutput(["1 \t", "2\r\n"]), ["1", "2", ""]);
  const e = practiceExercises[0];
  const result = evaluatePracticeCase(
    practiceSolutions["sum-two"].replace(
      "OUTPUT A + B",
      'OUTPUT "Enter numbers"\nOUTPUT A + B',
    ),
    e,
    0,
  );
  assert.equal(result.passed, false);
  const lower = evaluatePracticeCase(
    practiceSolutions.temperature.replace("FREEZING", "freezing"),
    practiceExercises[1],
    0,
  );
  assert.equal(lower.passed, false);
});
test("practice runs use isolated state and never leak non-public input/output through results", () => {
  const e = practiceExercises[0];
  const first = evaluatePracticeCase(practiceSolutions[e.id], e, 0);
  const later = evaluatePracticeCase(practiceSolutions[e.id], e, 2);
  assert.equal(first.passed, true);
  assert.equal(later.passed, true);
  assert.equal("actual" in later, false);
  assert.equal("input" in later, false);
  assert.equal("output" in later, false);
  const wrong = evaluatePracticeCase(
    "DECLARE A,B : INTEGER\nINPUT A\nINPUT B\nOUTPUT -1",
    e,
    2,
  );
  assert.equal(wrong.passed, false);
  assert.equal("actual" in wrong, false);
});
