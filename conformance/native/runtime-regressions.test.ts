import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  transpile,
  type Target,
  type ExportOptions,
} from "../../core/transpile";
import { run } from "../../core/runtime";
import type { DialectId } from "../../core/dialects";
import { toolchains, nativeEnvironment, normalizeOutput } from "./helpers";

function executeTarget(
  target: Target,
  source: string,
  dialect: DialectId,
  options: ExportOptions = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "pseudo-runtime-regression-"));
  const code = transpile(source, dialect, target, options);
  const execute = (cmd: string, args: string[]) =>
    spawnSync(cmd, args, {
      cwd: dir,
      env: nativeEnvironment,
      encoding: "utf8",
      timeout: 60000,
    });
  if (target === "python") {
    writeFileSync(join(dir, "main.py"), code);
    return execute(toolchains.python, ["main.py"]);
  }
  if (target === "java") {
    writeFileSync(join(dir, "Main.java"), code);
    const compiled = execute(toolchains.java, [
      "-jar",
      toolchains.ecj,
      "-17",
      "Main.java",
    ]);
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    return execute(toolchains.java, ["Main"]);
  }
  writeFileSync(join(dir, "Program.vb"), code);
  writeFileSync(
    join(dir, "export.vbproj"),
    '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>',
  );
  const compiled = execute(toolchains.dotnet, [
    "build",
    "export.vbproj",
    "--nologo",
    "-v:q",
    "--ignore-failed-sources",
  ]);
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  return execute(toolchains.dotnet, ["bin/Debug/net8.0/export.dll"]);
}

const operations = `FUNCTION Bound() RETURNS INTEGER
Calls ← Calls+1
RETURN 1
ENDFUNCTION
DECLARE I,Calls:INTEGER
Calls ← 0
FOR I ← 1 TO Bound()
DECLARE N:INTEGER
N ← I
OUTPUT N
NEXT I
OUTPUT Calls
OUTPUT NUM_TO_STR(0.0000001),":",NUM_TO_STR(1000000000000000000000)
OUTPUT STR_TO_NUM(NUM_TO_STR(0.0000001)) = 0.0000001
OUTPUT IS_NUM("${"9".repeat(400)}")
DECLARE R:REAL
R ← 4.0
OPENFILE "out" FOR WRITE
WRITEFILE "out",TRUE
WRITEFILE "out",R
CLOSEFILE "out"
DECLARE S:STRING
OPENFILE "out" FOR READ
READFILE "out",S
OUTPUT S
READFILE "out",S
OUTPUT S
CLOSEFILE "out"`;
const operationsOptions: ExportOptions = {
  policies: {
    forBounds: "eachIteration",
    booleanOutput: "lower",
    realOutput: "preserve",
  },
};

const rounding = `OUTPUT ROUND(10.075,2),":",ROUND(-10.075,2),":",ROUND(1.005,2)
OUTPUT ROUND(1${"0".repeat(307)},15) = 1${"0".repeat(307)}
DECLARE N:INTEGER
N ← 0
REPEAT
N ← N+1
UNTIL N=3
OUTPUT N`;

for (const target of ["python", "java", "vb"] as Target[]) {
  test(`${target} native conversions, FOR bound evaluation and WRITEFILE policies match interpreter`, () => {
    const expected =
      run(operations, "9618-AS", [], operationsOptions).output.join("\n") +
      "\n";
    const result = executeTarget(
      target,
      operations,
      "9618-AS",
      operationsOptions,
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(normalizeOutput(result.stdout), expected);
  });
  test(`${target} native decimal ROUND and exact REPEAT instruction limit match interpreter`, () => {
    const interpreter = run(rounding);
    const result = executeTarget(target, rounding, "0478", {
      maxSteps: interpreter.machine.steps,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(
      normalizeOutput(result.stdout),
      interpreter.output.join("\n") + "\n",
    );
  });
  test(`${target} native numeric conversion rejects overflow as a language diagnostic`, () => {
    const result = executeTarget(
      target,
      `OUTPUT STR_TO_NUM("${"9".repeat(400)}")`,
      "9618-AS",
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /BUILTIN_VALUE/);
  });
}
