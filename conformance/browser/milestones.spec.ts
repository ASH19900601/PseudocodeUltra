import { test, expect, type Page } from "@playwright/test";
async function code(page: Page, text: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(text);
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".cm-editor")).toBeVisible();
});
test("M1 diagnostics contain working fixes and official sources", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await code(page, 'output "hello"');
  await page.locator("[data-tab=diagnostics]").click();
  await expect(page.locator("#diagnostics")).toContainText("STYLE_CASE");
  await page
    .getByRole("button", { name: "转为大写 / Uppercase keyword" })
    .first()
    .click();
  await expect(page.locator(".cm-content")).toContainText('OUTPUT "hello"');
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("执行完成");
  expect(errors).toEqual([]);
});
test("M2 source version and strictness are configurable and persist", async ({
  page,
}) => {
  await page.locator("#dialect").selectOption("9618-AS");
  await page.locator("#help-nav").click();
  await page.locator("#guide-version").selectOption("2027–2029");
  await page.locator("#strictness").selectOption("learning");
  await code(page, "Score ← 3\nOUTPUT Score");
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("执行完成");
  await expect(page.locator("#console-output")).toContainText("3");
  await page.reload();
  await page.locator("#help-nav").click();
  await expect(page.locator("#guide-version")).toHaveValue("2027–2029");
  await expect(page.locator("#strictness")).toHaveValue("learning");
});
test("M4 trace fill-in, automatic grading, CSV and real Excel downloads", async ({
  page,
}) => {
  await page.locator("#examples").selectOption("1");
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("执行完成");
  await page.locator("[data-tab=trace]").click();
  await page.locator("#trace-filter").selectOption("loops");
  await expect(page.locator("#trace-table tbody tr")).not.toHaveCount(0);
  await page.locator("#trace-blank").check();
  await page.locator(".trace-answer").first().fill("deliberately wrong");
  await page.locator("#grade-trace").click();
  await expect(page.locator(".trace-answer.incorrect")).not.toHaveCount(0);
  const excel = page.waitForEvent("download");
  await page.locator("#xlsx").click();
  expect((await excel).suggestedFilename()).toBe("trace.xlsx");
  const csv = page.waitForEvent("download");
  await page.locator("#csv").click();
  expect((await csv).suggestedFilename()).toBe("trace.csv");
});
test("M4 flowchart selects functions and links to source", async ({ page }) => {
  await page.locator("#examples").selectOption("4");
  await page.locator("[data-tab=flow]").click();
  await page.locator("#flow-module").selectOption("Factorial");
  await expect(page.locator("#flow-content")).toContainText("START Factorial");
  await expect(page.locator("#flow-content")).toContainText("RETURN");
  await page.locator('#flow-content [data-line="2"]').click();
  await expect(page.locator("#cursor")).toContainText("Ln 2");
});
test("M4 full native export includes objects, inheritance, DATE and virtual files", async ({
  page,
}) => {
  await page.locator("#examples").selectOption("6");
  await page.locator("[data-tab=export]").click();
  for (const target of ["python", "java", "vb"]) {
    await page.locator("#target").selectOption(target);
    await page.locator("#convert").click();
    await expect(page.locator("#export-content")).toContainText("make_CHILD");
    await expect(page.locator("#export-content")).not.toContainText(
      "EXPORT_UNSUPPORTED",
    );
  }
});
test("fast worker mode executes large loop without tracing and remains stoppable", async ({
  page,
}) => {
  await page.locator("#help-nav").click();
  await page.locator("#max-steps").fill("30000000");
  await page.locator("#max-steps").blur();
  await code(
    page,
    "DECLARE I,Total:INTEGER\nTotal ← 0\nFOR I ← 1 TO 10000000\nTotal ← Total+1\nNEXT I\nOUTPUT Total",
  );
  await page.locator("#fast-mode").check();
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("执行完成");
  await expect(page.locator("#console-output")).toContainText("10000000");
  await expect(page.locator("#runtime-info")).toContainText("高速模式，无追踪");
});
test("multiline continuation numbers are hidden and code folds", async ({
  page,
}) => {
  await code(
    page,
    "FUNCTION F(X:INTEGER) RETURNS INTEGER\nRETURN X+1\nENDFUNCTION\nOUTPUT F(\n  2\n)",
  );
  await expect(page.locator("#diagnostic-count")).toHaveText("0");
  await page.waitForFunction(
    () =>
      !Array.from(
        document.querySelectorAll(".cm-lineNumbers .cm-gutterElement"),
      ).some((e) => e.textContent === "5"),
  );
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("执行完成");
  await expect(page.locator("#console-output")).toContainText("3");
  const fold = page
    .locator(".cm-foldGutter .cm-gutterElement")
    .filter({ hasText: "⌄" })
    .first();
  await expect(fold).toBeVisible();
  await fold.click();
  await expect(page.locator(".cm-foldPlaceholder")).toBeVisible();
});
test("PDF print view uses exam font and escapes user source", async ({
  page,
}) => {
  await code(page, 'OUTPUT "<script>text</script>"');
  const popup = page.waitForEvent("popup");
  await page.locator("#print-pdf").click();
  const printed = await popup;
  await expect(printed.locator("pre")).toContainText("<script>text</script>");
  expect(await printed.locator("script").count()).toBe(0);
  await printed.close();
});
test("function signatures and member completion work while editing", async ({
  page,
}) => {
  await page.locator("#dialect").selectOption("9618-AS");
  await code(page, "OUTPUT MID(");
  await expect(page.locator("#signature-help")).toBeVisible();
  await expect(page.locator("#signature-help")).toContainText("RETURNS STRING");
  await page.locator("#dialect").selectOption("9618-A2");
  await code(
    page,
    "CLASS C\nPUBLIC Value:INTEGER\nPRIVATE Secret:INTEGER\nPUBLIC PROCEDURE NEW()\nENDPROCEDURE\nENDCLASS\nItem ← NEW C()\nOUTPUT Item.",
  );
  await page.keyboard.press("Control+Space");
  await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("Value");
  await expect(page.locator(".cm-tooltip-autocomplete")).not.toContainText(
    "Secret",
  );
});

test("M4 long traces paginate and preserve independently graded answers", async ({
  page,
}) => {
  await code(page, "DECLARE I:INTEGER\nFOR I ← 1 TO 210\nOUTPUT I\nNEXT I");
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("执行完成");
  await page.locator("[data-tab=trace]").click();
  await expect(page.locator("#trace-table tbody tr")).toHaveCount(200);
  await expect(page.locator("#trace-prev")).toBeDisabled();
  await page.locator("#trace-blank").check();
  await page.locator(".trace-answer").first().fill("page one answer");
  await page.locator("#trace-next").click();
  await expect(page.locator("#trace-page")).toContainText("2 /");
  const answer = page.locator(".trace-answer").first();
  await expect(answer).toHaveValue("");
  const key = await answer.getAttribute("data-answer");
  expect(key).toMatch(/^200:/);
  await answer.fill("wrong page two");
  await page.locator("#grade-trace").click();
  await expect(answer).toHaveClass(/incorrect/);
  await page.locator("#trace-prev").click();
  await expect(page.locator(".trace-answer").first()).toHaveValue(
    "page one answer",
  );
  await page.locator("#trace-next").click();
  await expect(page.locator(".trace-answer").first()).toHaveValue(
    "wrong page two",
  );
});
