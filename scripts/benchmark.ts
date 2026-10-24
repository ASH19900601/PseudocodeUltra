import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import { run } from "../core/runtime";
import { LanguageService } from "../core/language-service";
const program =
  "DECLARE I, Total:INTEGER\nTotal ← 0\nFOR I ← 1 TO 10000000\nTotal ← Total+1\nNEXT I\nOUTPUT Total";
// Warm the JavaScript optimizer with the same operations before timing acceptance.
run(program.replace("10000000", "1000"), "0478", [], {
  fast: true,
  trace: false,
  maxSteps: 30000000,
});
const start = performance.now();
const result = run(program, "0478", [], {
  fast: true,
  trace: false,
  maxSteps: 30000000,
});
const executionMs = performance.now() - start;
assert.deepEqual(result.output, ["10000000"]);
assert.ok(executionMs < 1000, `10^7 loops took ${executionMs}ms`);
const source = [
  "DECLARE Total:INTEGER",
  "Total ← 0",
  ...Array.from({ length: 99998 }, () => "Total ← Total + 1"),
].join("\n");
const service = new LanguageService();
const cold = performance.now();
service.update(source, "0478");
const coldMs = performance.now() - cold;
const index = source.lastIndexOf("1");
const edited = source.slice(0, index) + "2" + source.slice(index + 1);
const editStart = performance.now();
const answer = service.update(edited, "0478");
const incrementalMs = performance.now() - editStart;
assert.ok(answer.incremental);
assert.deepEqual(answer.diagnostics, []);
assert.ok(
  incrementalMs < 100,
  `Incremental 100k-line edit took ${incrementalMs}ms`,
);
console.log(
  JSON.stringify(
    {
      loops: 10000000,
      executionMs,
      lines: 100000,
      coldMs,
      incrementalMs,
      node: process.version,
      mode: "fast execution without trace; one nonstructural edit after cold analysis",
    },
    null,
    2,
  ),
);
