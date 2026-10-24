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
  for (const [index, text] of [
    ["2", "Alex · 2008 · 90"],
    ["6", "12"],
  ]) {
    await page.locator("#examples").selectOption(index);
    await page.locator("#run").click();
    await page.waitForFunction(
      () => document.querySelector("#status")?.textContent === "执行完成",
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
    () => document.querySelector("#status")?.textContent === "执行完成",
  );
  if (process.env.SCREENSHOT_PATH)
    await page.screenshot({
      path: process.env.SCREENSHOT_PATH,
      fullPage: true,
    });
  console.log(
    "PASS: production HTML, bundled language/execution Workers, AS and A2 execution; no page/network errors",
  );
} finally {
  await browser.close();
}
