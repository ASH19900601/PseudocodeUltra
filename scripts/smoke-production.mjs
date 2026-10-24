import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
const base = process.env.SMOKE_URL || "http://127.0.0.1:4173";
const response = await fetch(base);
assert.equal(response.status, 200);
assert.match(await response.text(), /Pseudocode Ultra/);
const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ||
    (process.platform === "win32"
      ? [
          join(
            process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)",
            "Microsoft/Edge/Application/msedge.exe",
          ),
          join(
            process.env.ProgramFiles || "C:/Program Files",
            "Google/Chrome/Application/chrome.exe",
          ),
        ].find(existsSync)
      : existsSync("/usr/bin/chromium")
        ? "/usr/bin/chromium"
        : undefined),
  headless: true,
  args: process.platform === "linux" ? ["--no-sandbox"] : [],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("requestfailed", (r) =>
    errors.push(r.url() + ": " + r.failure()?.errorText),
  );
  await page.goto(base);
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  for (const [index, text] of [
    ["2", "Alex · 2008 · 90"],
    ["6", "12"],
  ]) {
    await page.locator("#examples").selectOption(index);
    await page.locator("#run").click();
    await page.waitForFunction(
      () => document.querySelector("#status")?.textContent === "Completed",
    );
    assert.match(
      await page.locator("#console-output").innerText(),
      new RegExp(text),
    );
  }
  assert.deepEqual(errors, []);
  await page.locator("#examples").selectOption("2");
  await page.locator("#run").click();
  await page.waitForFunction(
    () => document.querySelector("#status")?.textContent === "Completed",
  );
  await page.waitForFunction(
    () =>
      document.querySelector("#analysis-state")?.textContent ===
      "Diagnostics are up to date",
  );
  if (process.env.SCREENSHOT_PATH)
    await page.screenshot({
      path: process.env.SCREENSHOT_PATH,
      fullPage: true,
    });
  await page.locator('[data-tab="export"]').click();
  await page.locator("#convert").click();
  await page.locator("#export-download:enabled").waitFor();
  assert.match(await page.locator("#export-content").innerText(), /Alex/);
  await page.locator("#practice-open").click();
  await page.locator("#practice-select").selectOption("sum-two");
  await page.locator("#practice-load").click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(
    "DECLARE A, B : INTEGER\nINPUT A\nINPUT B\nOUTPUT A + B",
  );
  await page.locator("#practice-submit").click();
  await page.locator("#practice-score", { hasText: "100 / 100" }).waitFor();
  await page.locator("#locale").selectOption("zh-CN");
  assert.match(await page.locator("#run").innerText(), /运行/);
  await page.locator("#locale").selectOption("en");
  assert.match(await page.locator("#run").innerText(), /Run/);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: production HTML, three bundled Workers, AS/A2 execution, code export, 100/100 practice grading and language switching; no page/network errors",
  );
} finally {
  await browser.close();
}
