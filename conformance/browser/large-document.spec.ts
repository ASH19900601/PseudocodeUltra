import { test, expect, type Page } from "@playwright/test";

const source =
  "DECLARE X : INTEGER\n" +
  Array.from({ length: 99998 }, (_, i) => `X ← ${i}`).join("\n") +
  "\nOUTPUT Missing";

async function ready(page: Page) {
  await page.goto("/");
  await expect(page.locator(".cm-editor")).toBeVisible();
  await expect(page.locator("#analysis-state")).toHaveText("完整诊断已更新", {
    timeout: 30000,
  });
  await page.evaluate(() => {
    const data = { last: performance.now(), maxGap: 0, ticks: 0 };
    (window as any).__largeDocumentHeartbeat = data;
    setInterval(() => {
      const now = performance.now();
      data.maxGap = Math.max(data.maxGap, now - data.last);
      data.last = now;
      data.ticks++;
    }, 50);
  });
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+a");
}

test("edits cannot retain a previous document's complete analysis status during debounce", async ({
  page,
}) => {
  await page.clock.install();
  await ready(page);
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await page.keyboard.insertText("OUTPUT Missing");
  await expect(page.locator("#analysis-state")).toContainText(
    "等待分析当前文档",
  );
  await expect(page.locator("#analysis-cancel")).toBeVisible();
  await page.locator("#analysis-cancel").click();
  await expect(page.locator("#analysis-state")).toContainText("分析已取消");
});

test("100000-line real clipboard paste remains responsive, cancellation restores complete diagnostics, and edits/scrolling work", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(90000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await ready(page);
  await page.evaluate((text) => navigator.clipboard.writeText(text), source);
  const start = Date.now();
  await page.keyboard.press("Control+v");
  const pasteMs = Date.now() - start;
  expect(pasteMs).toBeLessThan(2000);
  await expect(page.locator("#cursor")).toContainText("Ln 100000");
  expect(await page.evaluate(() => localStorage.getItem("source"))).toBe(
    source,
  );
  // The UI remains responsive while full analysis is still in a worker.
  await expect(page.locator("#analysis-cancel")).toBeVisible({
    timeout: 10000,
  });
  await page.locator("#analysis-cancel").click();
  await expect(page.locator("#analysis-state")).toContainText("分析已取消");
  await page.locator("#theme").click();
  expect(await page.locator(".cm-line").count()).toBeLessThan(300);
  await page.locator("#analysis-resume").click();
  await expect(page.locator("#analysis-state")).toHaveText("完整诊断已更新", {
    timeout: 45000,
  });
  await page.locator('[data-tab="diagnostics"]').click();
  await expect(page.locator('#diagnostics [data-line="100000"]')).toContainText(
    "UNDECLARED",
  );
  await page.locator('#diagnostics [data-line="100000"]').click();
  await expect(page.locator("#cursor")).toContainText("Ln 100000");
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.insertText("OUTPUT X");
  await expect(page.locator("#diagnostic-count")).toHaveText("0", {
    timeout: 30000,
  });
  await page.keyboard.press("Control+Home");
  await expect(page.locator("#cursor")).toContainText("Ln 1,");
  await page.keyboard.press("Control+End");
  await expect(page.locator("#cursor")).toContainText("Ln 100000");
  const heartbeat = await page.evaluate(
    () => (window as any).__largeDocumentHeartbeat,
  );
  expect(heartbeat.ticks).toBeGreaterThan(3);
  expect(heartbeat.maxGap).toBeLessThan(2000);
  await testInfo.attach("large-document-timing", {
    body: JSON.stringify({ pasteMs, ...heartbeat }),
    contentType: "application/json",
  });
});

test("100000-line native insertText input bypasses Chromium's unbounded DOM expansion", async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  await ready(page);
  const start = Date.now();
  await page.keyboard.insertText(source);
  const insertMs = Date.now() - start;
  expect(insertMs).toBeLessThan(2000);
  await expect(page.locator("#cursor")).toContainText("Ln 100000");
  expect(await page.evaluate(() => localStorage.getItem("source"))).toBe(
    source,
  );
  expect(await page.locator(".cm-line").count()).toBeLessThan(300);
  await expect(page.locator("#analysis-state")).toHaveText("完整诊断已更新", {
    timeout: 45000,
  });
  await page.locator('[data-tab="diagnostics"]').click();
  await expect(page.locator('#diagnostics [data-line="100000"]')).toContainText(
    "UNDECLARED",
  );
  await testInfo.attach("large-native-input-timing", {
    body: JSON.stringify({ insertMs }),
    contentType: "application/json",
  });
});
