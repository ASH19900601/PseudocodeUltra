import { spawn } from "node:child_process";
import { readdirSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, dirname, resolve } from "node:path";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
process.chdir(root);
const noBuild = process.argv.includes("--no-build");
const skipSpecs = process.argv.includes("--skip-specs");
const outputArgument = process.argv.find((arg) => arg.startsWith("--output="));
const output = resolve(
  root,
  outputArgument?.slice("--output=".length) || "docs/validation",
);
mkdirSync(output, { recursive: true });
function files(dir) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(dir + "/" + e.name) : [dir + "/" + e.name],
  );
}
const digest = createHash("sha256");
for (const path of [
  ...files("core"),
  ...files("web"),
  ...files("conformance"),
  ...files("scripts"),
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "playwright.config.ts",
  "docs/spec-sources.json",
].sort()) {
  digest.update(path);
  digest.update(readFileSync(path));
}
const summary = {
  schemaVersion: 1,
  startedAt: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }),
  timezone: "Asia/Shanghai",
  sourceSha256: digest.digest("hex"),
  node: process.version,
  scope: noBuild ? "source-and-development-browser" : "full",
  checks: [],
  status: "running",
};
let ownedServer;
function command(name, cmd, args, filename) {
  return new Promise((resolve, reject) => {
    const started = performance.now(),
      proc = spawn(cmd, args, {
        cwd: root,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    let stdout = "",
      stderr = "";
    proc.stdout.on("data", (x) => (stdout += x));
    proc.stderr.on("data", (x) => (stderr += x));
    proc.on("error", reject);
    proc.on("exit", (code) => {
      writeFileSync(
        join(output, filename),
        stdout + (filename.endsWith(".json") ? "" : "\n" + stderr),
      );
      if (filename.endsWith(".json"))
        writeFileSync(join(output, name + "-stderr.log"), stderr);
      const row = {
        name,
        exitCode: code,
        durationMs: performance.now() - started,
        status: code === 0 ? "passed" : "failed",
      };
      const count = /^# tests (\d+)/m.exec(stdout),
        pass = /^# pass (\d+)/m.exec(stdout),
        fail = /^# fail (\d+)/m.exec(stdout);
      if (count)
        Object.assign(row, {
          tests: Number(count[1]),
          passed: Number(pass?.[1]),
          failed: Number(fail?.[1]),
        });
      summary.checks.push(row);
      console.log(
        name +
          ": " +
          row.status +
          (row.tests ? " (" + row.passed + "/" + row.tests + ")" : ""),
      );
      if (code === 0) resolve(stdout);
      else reject(new Error(name + " failed; see " + join(output, filename)));
    });
  });
}
try {
  if (!skipSpecs)
    await command(
      "specifications",
      "python",
      ["scripts/fetch-specs.py"],
      "specifications.log",
    );
  else
    summary.checks.push({
      name: "specifications",
      status: "skipped",
      reason:
        "--skip-specs: external PDF retrieval was not verified in this run",
    });
  const tests = (dir) =>
    readdirSync(dir)
      .filter((n) => n.endsWith(".test.ts"))
      .map((n) => dir + "/" + n);
  await command(
    "core",
    process.execPath,
    [
      "--import",
      "tsx",
      "--test",
      "--test-reporter=tap",
      ...tests("conformance"),
    ],
    "core.tap",
  );
  await command(
    "native",
    process.execPath,
    [
      "--import",
      "tsx",
      "--test",
      "--test-reporter=tap",
      ...tests("conformance/native"),
    ],
    "native.tap",
  );
  const browser = JSON.parse(
    await command(
      "browser",
      process.execPath,
      ["node_modules/@playwright/test/cli.js", "test", "--reporter=json"],
      "browser.json",
    ),
  );
  Object.assign(summary.checks.at(-1), {
    tests:
      browser.stats.expected + browser.stats.unexpected + browser.stats.skipped,
    passed: browser.stats.expected,
    failed: browser.stats.unexpected,
    skipped: browser.stats.skipped,
  });
  if (browser.stats.skipped || browser.stats.unexpected)
    throw new Error("Browser acceptance contains skipped or failed tests");
  await command(
    "typecheck",
    process.execPath,
    ["node_modules/typescript/bin/tsc", "--noEmit"],
    "typecheck.log",
  );
  if (!noBuild) {
    await command(
      "build",
      process.execPath,
      ["node_modules/vite/bin/vite.js", "build"],
      "build.log",
    );
  } else {
    summary.checks.push({
      name: "build",
      status: "skipped",
      reason: "--no-build: no build requested",
    });
  }
  summary.performance = JSON.parse(
    await command(
      "performance",
      process.execPath,
      ["--import", "tsx", "scripts/benchmark.ts"],
      "performance.json",
    ),
  );
  if (!noBuild) {
    const url = process.env.SMOKE_URL || "http://127.0.0.1:4173";
    let reachable = false;
    try {
      reachable = (await fetch(url)).ok;
    } catch {}
    if (!reachable) {
      ownedServer = spawn(
        process.execPath,
        [
          "node_modules/vite/bin/vite.js",
          "preview",
          "--host",
          "127.0.0.1",
          "--port",
          "4173",
        ],
        { cwd: root, env: process.env, stdio: "ignore" },
      );
      for (let i = 0; i < 100; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        try {
          if ((await fetch(url)).ok) {
            reachable = true;
            break;
          }
        } catch {}
      }
      if (!reachable) throw new Error("Production preview did not start");
    }
    await command(
      "production",
      process.execPath,
      ["scripts/smoke-production.mjs"],
      "production.log",
    );
  } else {
    summary.checks.push({
      name: "production",
      status: "skipped",
      reason: "Requires a production build; --no-build selected",
    });
  }
  summary.status = summary.checks.some((check) => check.status === "skipped")
    ? "passed-with-skips"
    : "passed";
  summary.finishedAt = new Date().toLocaleString("sv-SE", {
    timeZone: "Asia/Shanghai",
  });
} catch (error) {
  summary.status = "failed";
  summary.error = error.message;
  process.exitCode = 1;
  console.error(error.message);
} finally {
  if (ownedServer) ownedServer.kill("SIGTERM");
  writeFileSync(
    join(output, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
}
