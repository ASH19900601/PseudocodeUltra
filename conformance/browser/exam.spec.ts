import { test, expect, type Page } from "@playwright/test";

async function ready(page: Page) {
  await page.goto("/");
  await expect(page.locator(".cm-editor")).toBeVisible();
  await expect(page.locator("#run")).toBeEnabled();
  await page.locator("#exam-details > summary").click();
}
async function code(page: Page, source: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+a");
  if (source) await page.keyboard.insertText(source);
  else await page.keyboard.press("Backspace");
}
test("exam locks settings and learning aids, submits a separate answer, and restores the normal draft", async ({
  page,
}) => {
  await ready(page);
  await code(page, 'OUTPUT "ordinary draft"');
  await page.locator("#exam-dialect").selectOption("9618-AS");
  await page.locator("#exam-guide").selectOption("2027–2029");
  await page.locator("#exam-start").click();
  await expect(page.locator("#exam-state")).toHaveText("考试进行中");
  await expect(page.locator("#exam-rules")).toContainText(
    "9618-AS · 2027–2029",
  );
  await expect(page.locator("#dialect")).toBeDisabled();
  await expect(page.locator("#format")).toBeDisabled();
  await expect(page.locator("#run-mode")).toBeDisabled();
  await expect(page.locator("#examples")).toBeDisabled();
  await expect(page.locator('[data-tab="trace"]')).toBeDisabled();
  await expect(page.locator('[data-tab="export"]')).toBeDisabled();
  await expect(page.locator("#step")).toBeDisabled();
  await expect(page.locator("#run")).toBeEnabled();
  await expect(page.locator(".cm-content")).toHaveText("");
  await code(page, 'OUTPUT "exam answer"');
  await page.keyboard.press("Control+Space");
  await expect(page.locator(".cm-tooltip-autocomplete")).toHaveCount(0);
  await expect(page.locator("#signature-help")).toBeHidden();
  await page.locator("#exam-insert > summary").click();
  await expect(page.locator("#exam-insert-content")).toContainText("MID(");
  await expect(page.locator("#exam-insert-content")).toContainText(
    "并非官方原卷",
  );
  await page.locator("#exam-details > summary").click();
  await expect(page.locator("#exam-summary")).toContainText(/\d+:\d\d/);
  await page.locator("#exam-details > summary").click();
  await page.locator("#exam-submit").click();
  await expect(page.locator("#exam-state")).toContainText("已提交");
  await expect(page.locator("#run")).toBeDisabled();
  await expect(page.locator("#exam-submit")).toBeDisabled();
  const downloadEvent = page.waitForEvent("download");
  await page.locator("#exam-download").click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.pseudo$/);
  await page.locator("#exam-finish").click();
  await expect(page.locator(".cm-content")).toContainText(
    'OUTPUT "ordinary draft"',
  );
  await expect(page.locator("#dialect")).toHaveValue("0478");
  await expect(page.locator("#dialect")).toBeEnabled();
  await expect(page.locator("#exam-archive")).toBeVisible();
});
test("exam answer, version and ordinary backup survive refresh until explicit exit", async ({
  page,
}) => {
  await ready(page);
  await code(page, 'OUTPUT "normal before exam"');
  await page.locator("#exam-start").click();
  await code(page, 'OUTPUT "saved exam"');
  await expect(page.locator("#exam-save-state")).toContainText("已保存本机");
  await page.reload();
  await expect(page.locator("#exam-state")).toHaveText("考试进行中");
  await expect(page.locator(".cm-content")).toContainText(
    'OUTPUT "saved exam"',
  );
  await page.locator("#exam-submit").click();
  await page.reload();
  await expect(page.locator("#exam-state")).toContainText("已提交");
  await expect(page.locator("#run")).toBeDisabled();
  await page.locator("#exam-finish").click();
  await expect(page.locator(".cm-content")).toContainText(
    'OUTPUT "normal before exam"',
  );
  await page.reload();
  await expect(page.locator(".cm-content")).toContainText(
    'OUTPUT "normal before exam"',
  );
});
test("an absolute countdown expires and locks the answer after elapsed browser time", async ({
  page,
}) => {
  await page.clock.install();
  await ready(page);
  await page.locator("#exam-minutes").fill("1");
  await page.locator("#exam-start").click();
  await code(page, 'OUTPUT "before deadline"');
  await page.clock.fastForward(61000);
  await expect(page.locator("#exam-state")).toContainText("时间已到");
  await expect(page.locator("#exam-countdown")).toHaveText("00:00");
  await expect(page.locator("#run")).toBeDisabled();
  await expect(page.locator("#exam-submit")).toBeDisabled();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("late modification");
  await expect(page.locator(".cm-content")).toContainText(
    'OUTPUT "before deadline"',
  );
  await page.reload();
  await expect(page.locator("#exam-state")).toContainText("时间已到");
  await page.locator("#exam-finish").click();
  await expect(page.locator("#run")).toBeEnabled();
});
