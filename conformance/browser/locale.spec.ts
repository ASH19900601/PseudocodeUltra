import { test, expect, type Page } from "@playwright/test";
import { practiceSolutions } from "../practice-solutions";

// A new browser profile must use the application's English default.
test.use({ storageState: { cookies: [], origins: [] } });

async function ready(page: Page) {
  await page.goto("/");
  await expect(page.locator("#run")).toBeEnabled();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
}
async function code(page: Page, source: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(source);
}
async function englishInterface(page: Page) {
  return page.evaluate(() => {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    const found: string[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (
        !parent ||
        parent.closest(
          "#locale,.cm-editor,#source-name,#file-title,script,style",
        ) ||
        !parent.getClientRects().length
      )
        continue;
      if (/\p{Script=Han}/u.test(node.nodeValue || ""))
        found.push(node.nodeValue!.trim());
    }
    return found;
  });
}

test("fresh profiles start in English, all main views are translated, and Chinese preference persists", async ({
  page,
}) => {
  await ready(page);
  await expect(page.locator("#locale")).toHaveValue("en");
  await expect(page.locator("#run")).toContainText("Run");
  expect(await englishInterface(page)).toEqual([]);
  for (const tab of ["reference", "diagnostics", "practice"]) {
    await page.locator(`[data-tab="${tab}"]`).click();
    expect(await englishInterface(page)).toEqual([]);
  }
  await page.locator("#exam-open").click();
  expect(await englishInterface(page)).toEqual([]);
  await page.locator("#locale").selectOption("zh-CN");
  await expect(page.locator("#run")).toContainText("运行");
  await expect(page.locator("#exam-start")).toHaveText("开始考试");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.locator("#locale")).toHaveValue("zh-CN");
  await page.locator("#locale").selectOption("en");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("#run")).toContainText("Run");
});

test("nested watch values translate runtime labels and preserve user strings", async ({
  page,
}) => {
  await ready(page);
  await code(
    page,
    'DECLARE Entries : ARRAY[1:2] OF STRING\nEntries[2] ← "未初始化"\nOUTPUT "ready"',
  );
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("Completed");
  await page.locator("#watch-input").fill("Entries");
  await page.locator("#watch-form button").click();
  await expect(page.locator("#watches")).toContainText(
    "[Uninitialized, 未初始化]",
  );
  await page.locator("#locale").selectOption("zh-CN");
  await expect(page.locator("#watches")).toContainText("[未初始化, 未初始化]");
  await page.locator("#locale").selectOption("en");
  await expect(page.locator("#watches")).toContainText(
    "[Uninitialized, 未初始化]",
  );
});

test("switching languages preserves edits, cursor, undo and an active INPUT request", async ({
  page,
}) => {
  await ready(page);
  const source =
    'DECLARE Name : STRING\nOUTPUT "中文用户数据"\nINPUT Name\nOUTPUT Name';
  await code(page, source);
  const cursor = await page.locator("#cursor").textContent();
  await page.locator("#locale").selectOption("zh-CN");
  await page.locator("#locale").selectOption("en");
  await expect(page.locator("#cursor")).toHaveText(cursor!);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("source")))
    .toBe(source);
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("Waiting for input");
  await page.locator("#locale").selectOption("zh-CN");
  await expect(page.locator("#input-form")).toBeVisible();
  await expect(page.locator("#status")).toHaveText("等待输入");
  await page.locator("#runtime-input").fill("中文姓名");
  await page.locator("#input-form button").click();
  await expect(page.locator("#status")).toHaveText("执行完成");
  await expect(page.locator("#console-output")).toHaveText(
    "中文用户数据中文姓名",
  );
  await page.locator("#locale").selectOption("en");
  await expect(page.locator("#console-output")).toHaveText(
    "中文用户数据中文姓名",
  );
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".cm-content")).not.toHaveText(source);
});

test("all ten exercise tasks, grading feedback and history switch without changing the answer", async ({
  page,
}) => {
  await ready(page);
  await page.locator("#practice-open").click();
  const options = await page
    .locator("#practice-select option")
    .evaluateAll((elements) =>
      elements.map((e) => (e as HTMLOptionElement).value),
    );
  expect(options).toHaveLength(10);
  for (const id of options) {
    await page.locator("#practice-select").selectOption(id);
    expect(await englishInterface(page)).toEqual([]);
  }
  await page.locator("#practice-select").selectOption("sum-two");
  await page.locator("#practice-load").click();
  await code(page, practiceSolutions["sum-two"]);
  await page.locator("#practice-submit").click();
  await expect(page.locator("#practice-score")).toHaveText(
    "Current answer: 100 / 100",
  );
  expect(await englishInterface(page)).toEqual([]);
  await page.locator("#locale").selectOption("zh-CN");
  await expect(page.locator("#practice-score")).toHaveText(
    "当前答卷：100 / 100",
  );
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("source")))
    .toBe(practiceSolutions["sum-two"]);
  await page.locator("#locale").selectOption("en");
  await expect(page.locator("#practice-score")).toHaveText(
    "Current answer: 100 / 100",
  );
  expect(await englishInterface(page)).toEqual([]);
});

test("a running exam retains the same answer and deadline while switching languages", async ({
  page,
}) => {
  await ready(page);
  await page.locator("#exam-open").click();
  await page.locator("#exam-start").click();
  await code(page, 'OUTPUT "Exam answer"');
  await expect(page.locator("#exam-save-state")).toContainText(
    "saved on this device",
  );
  const deadline = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("pseudocode-ultra-exam-v1")!).deadline,
  );
  await page.locator("#locale").selectOption("zh-CN");
  await expect(page.locator("#exam-state")).toContainText("考试进行中");
  await expect(page.locator(".cm-content")).toHaveText('OUTPUT "Exam answer"');
  await page.locator("#locale").selectOption("en");
  await expect(page.locator("#exam-state")).toContainText("Exam in progress");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("pseudocode-ultra-exam-v1")!).deadline,
    ),
  ).toBe(deadline);
  await page.locator("#exam-submit").click();
  await expect(page.locator(".cm-content")).toHaveAttribute(
    "contenteditable",
    "false",
  );
  expect(await englishInterface(page)).toEqual([]);
});

test("diagnostics and fixes use English, then retranslate when Chinese is selected", async ({
  page,
}) => {
  await ready(page);
  await code(page, "OUTPUT Missing");
  await page.locator('[data-tab="diagnostics"]').click();
  await expect(page.locator("#diagnostics")).toContainText(
    "Undeclared Missing",
  );
  expect(await englishInterface(page)).toEqual([]);
  await page.locator("#locale").selectOption("zh-CN");
  await expect(page.locator("#diagnostics")).toContainText("未声明变量");
  await page.locator("#locale").selectOption("en");
  await expect(page.locator("#diagnostics")).toContainText(
    "Undeclared Missing",
  );
});

test("English controls and language switching fit the narrow workspace", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  for (const locale of ["en", "zh-CN", "en"]) {
    await page.locator("#locale").selectOption(locale);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(page.locator("#locale")).toBeVisible();
    await expect(page.locator("#run")).toBeVisible();
  }
});
