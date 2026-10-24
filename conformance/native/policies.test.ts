import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { transpile, type Target } from "../../core/transpile";
import { run } from "../../core/runtime";
import type { RuntimePolicies } from "../../core/policies";
const source =
  'DECLARE I,N:INTEGER\nN ← 4\nFOR I ← 1 TO N\nN ← N-1\nNEXT I\nDECLARE R:REAL\nR ← 4.0\nOUTPUT -7 DIV 3, -7 MOD 3,INT(-2.9),R,TRUE,N\nDECLARE S:STRING\nOPENFILE "data.txt" FOR WRITE\nWRITEFILE "DATA.TXT","hello"\nCLOSEFILE "Data.Txt"\nOPENFILE "DATA.TXT" FOR READ\nREADFILE "data.txt",S\nOUTPUT S\nCLOSEFILE "DATA.TXT"';
const policies: Partial<RuntimePolicies> = {
  divNegative: "floor",
  intNegative: "floor",
  forBounds: "eachIteration",
  realOutput: "preserve",
  booleanOutput: "lower",
  filenameCase: "insensitive",
};
for (const target of ["python", "java", "vb"] as Target[])
  test(`native ${target} preserves selected semantic policies`, () => {
    const dir = mkdtempSync(join(tmpdir(), "policy-export-")),
      expected =
        run(source, "9618-AS", [], { policies }).output.join("\n") + "\n",
      code = transpile(source, "9618-AS", target, {
        policies,
        seed: 4294967295,
      });
    const exec = (cmd: string, args: string[]) => {
      const r = spawnSync(cmd, args, {
        cwd: dir,
        encoding: "utf8",
        timeout: 60000,
        env: {
          ...process.env,
          DOTNET_CLI_HOME: "/tmp/dotnet-home",
          DOTNET_CLI_TELEMETRY_OPTOUT: "1",
        },
      });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      return r.stdout;
    };
    if (target === "python") {
      writeFileSync(join(dir, "main.py"), code);
      assert.equal(exec("python", ["main.py"]), expected);
    } else if (target === "java") {
      writeFileSync(join(dir, "Main.java"), code);
      exec("java", [
        "-jar",
        process.env.ECJ_JAR || "/workspace/.tools/ecj.jar",
        "-17",
        "Main.java",
      ]);
      assert.equal(exec("java", ["Main"]), expected);
    } else {
      writeFileSync(join(dir, "Program.vb"), code);
      writeFileSync(
        join(dir, "export.vbproj"),
        '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>',
      );
      const dotnet =
        process.env.DOTNET_BIN || "/workspace/.tools/dotnet/dotnet";
      exec(dotnet, ["build", "-v:q", "--nologo", "--ignore-failed-sources"]);
      assert.equal(exec(dotnet, ["bin/Debug/net8.0/export.dll"]), expected);
    }
  });
