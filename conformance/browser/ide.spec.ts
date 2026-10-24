import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".cm-editor")).toBeVisible();
});
test("run with INPUT and produce output", async ({ page }) => {
  await page.locator("#run").click();
  await expect(page.locator("#input-form")).toBeVisible();
  await page.locator("#runtime-input").fill("5");
  await page.locator("#input-form button").click();
  await expect(page.locator("#status")).toHaveText("执行完成");
  await expect(page.locator("#console-output")).toContainText("Total = 15");
  await page.locator("[data-tab=trace]").click();
  await expect(page.locator("#trace-table tbody tr")).not.toHaveCount(0);
});
test("step actually pauses before execution, then resume", async ({ page }) => {
  await page.locator("#examples").selectOption("1");
  await page.locator("#step").click();
  await expect(page.locator("#status")).toHaveText("已暂停");
  await expect(page.locator(".execution-line")).toHaveCount(1);
  await page.locator("#step").click();
  await expect(page.locator("#status")).toHaveText("已暂停");
  await expect(page.locator("#variables")).toContainText("SCORES");
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("执行完成");
  await expect(page.locator("#console-output")).toContainText("Highest: 35");
});
test("all AS and A2 examples run in worker", async ({ page }) => {
  for (const [n, expected] of [
    ["2", "Alex · 2008 · 90"],
    ["3", "Hello Cambridge"],
    ["4", "720"],
    ["5", "99 · {1, 2, 3}"],
    ["6", "12"],
  ]) {
    await page.locator("#examples").selectOption(n);
    await page.locator("#run").click();
    await expect(page.locator("#status")).toHaveText("执行完成");
    await expect(page.locator("#console-output")).toContainText(expected);
  }
});
test("file persistence and source restore", async ({ page }) => {
  await page.locator("#examples").selectOption("3");
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("执行完成");
  await expect(page.locator("#files")).toContainText("notes.txt");
  await page.reload();
  await expect(page.locator("#files")).toContainText("notes.txt");
  await expect(page.locator(".cm-content")).toContainText("OPENFILE");
});
test("AST, flowchart, native export and reference", async ({ page }) => {
  await page.locator("[data-tab=ast]").click();
  await expect(page.locator("#ast-content")).toContainText("declare");
  await page.locator("[data-tab=flow]").click();
  await expect(page.locator("#flow svg")).toBeVisible();
  await page.locator("[data-tab=export]").click();
  await page.locator("#convert").click();
  await expect(page.locator("#export-content")).toContainText("class Cell");
  await page.locator("#help-nav").click();
  await expect(page.locator("#reference")).toContainText("negativeDIV");
});
test("responsive layout and no uncaught page errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#run")).toBeVisible();
  await page.locator("#examples").selectOption("4");
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("执行完成");
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
test("breakpoint hits line, pure watch and step-over work", async ({
  page,
}) => {
  await page.locator("#examples").selectOption("4");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("F9");
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("已暂停");
  await page.locator("#watch-input").fill("1 + 2");
  await page.locator("#watch-form button").click();
  await expect(page.locator("#watches")).toContainText("3");
  await page.locator("#clear-breakpoints").click();
  await page.locator("#over").click();
  await expect(page.locator("#status")).toHaveText("执行完成");
  await expect(page.locator("#console-output")).toContainText("720");
});
test("stop cancels a running worker", async ({ page }) => {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("WHILE TRUE DO\nENDWHILE");
  await page.locator("#run").click();
  await page.locator("#stop").click();
  await expect(page.locator("#status")).toHaveText("已停止");
  await expect(page.locator("#run")).toBeEnabled();
});
test("step into recursion and step out restores caller", async ({ page }) => {
  await page.locator("#examples").selectOption("4");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("F9");
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("已暂停");
  await page.locator("#clear-breakpoints").click();
  await page.locator("#step").click();
  await expect(page.locator("#stack")).toContainText("Factorial");
  await page.locator("#out").click();
  await expect(page.locator("#status")).toHaveText("执行完成");
  await expect(page.locator("#console-output")).toContainText("720");
});
