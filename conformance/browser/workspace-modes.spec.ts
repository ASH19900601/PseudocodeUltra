import { test, expect, type Page } from "@playwright/test";

async function ready(page: Page) {
  await page.goto("/");
  await expect(page.locator("#run")).toBeEnabled();
  await page.locator("#exam-details > summary").click();
}
async function code(page: Page, source: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(source);
}

test("Undo cannot cross exam document boundaries and ordinary editing still has history", async ({
  page,
}) => {
  await ready(page);
  await code(page, 'OUTPUT "normal-boundary"');
  await page.locator("#exam-start").click();
  await page.locator(".cm-content").click();
  for (const key of ["Control+z", "Control+y"]) {
    await page.keyboard.press(key);
    await expect(page.locator(".cm-content")).toHaveText("");
  }
  await code(page, 'OUTPUT "answer-boundary"');
  await page.locator("#exam-submit").click();
  await page.locator("#exam-finish").click();
  await page.locator(".cm-content").click();
  for (const key of ["Control+z", "Control+y"]) {
    await page.keyboard.press(key);
    await expect(page.locator(".cm-content")).toHaveText(
      'OUTPUT "normal-boundary"',
    );
  }
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n// normal edit");
  await expect(page.locator(".cm-content")).toContainText("normal edit");
  await page.keyboard.press("Control+z");
  await expect(page.locator(".cm-content")).not.toContainText("normal edit");
});

test("the first keystroke after a suspended deadline locks and rolls back without nested editor updates", async ({
  page,
}) => {
  await page.clock.install();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await ready(page);
  await page.locator("#exam-minutes").fill("1");
  await page.locator("#exam-start").click();
  await code(page, 'OUTPUT "timely answer"');
  await page.evaluate(() =>
    document.querySelector<HTMLElement>(".cm-content")!.focus(),
  );
  const deadline = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("pseudocode-ultra-exam-v1")!).deadline,
  );
  // Date changes while timers remain suspended, as after a sleeping tab resumes.
  await page.clock.setSystemTime(deadline + 1000);
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n// too late");
  await expect(page.locator("#exam-state")).toContainText("时间已到");
  await expect(page.locator(".cm-content")).toHaveText(
    'OUTPUT "timely answer"',
  );
  expect(errors).toEqual([]);
});

test("exam execution cannot overwrite the ordinary workspace files", async ({
  page,
}) => {
  await ready(page);
  await page
    .locator("#file-upload")
    .setInputFiles({
      name: "keep.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("ordinary file"),
    });
  await expect(page.locator("#files")).toContainText("keep.txt");
  await page.locator("#exam-start").click();
  await expect(page.locator("#import-file")).toBeDisabled();
  await code(
    page,
    'OPENFILE "keep.txt" FOR WRITE\nWRITEFILE "keep.txt", "exam file"\nCLOSEFILE "keep.txt"',
  );
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("执行完成");
  await page.locator("#exam-submit").click();
  await page.locator("#exam-finish").click();
  await page.reload();
  await page.locator('[data-file="keep.txt"]').click();
  await expect(page.locator("#file-text")).toHaveValue("ordinary file");
});
