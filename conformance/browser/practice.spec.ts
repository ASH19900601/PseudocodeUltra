import { test, expect, type Page } from "@playwright/test";
import { practiceSolutions } from "../practice-solutions";
import { practiceExercises } from "../../core/practice";

async function ready(page: Page) {
  await page.goto("/");
  await expect(page.locator(".cm-editor")).toBeVisible();
  await page.locator('[data-tab="practice"]').click();
  await expect(page.locator("#practice-select")).toBeVisible();
}
async function code(page: Page, source: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+a");
  if (source) await page.keyboard.insertText(source);
  else await page.keyboard.press("Backspace");
}
async function load(page: Page, id: string) {
  await page.locator("#practice-select").selectOption(id);
  await page.locator("#practice-load").click();
}

test("all ten original exercises grade real reference programs in a dedicated Worker", async ({
  page,
}) => {
  await ready(page);
  await expect(page.locator("#practice-select option")).toHaveCount(10);
  for (const exercise of practiceExercises) {
    await load(page, exercise.id);
    await expect(page.locator(".practice-sample")).toHaveCount(2);
    await expect(page.locator(".cm-content")).toContainText("TODO");
    await code(page, practiceSolutions[exercise.id]);
    await page.locator("#practice-submit").click();
    await expect(page.locator("#practice-score")).toHaveText(
      "当前答卷：100 / 100",
    );
    await expect(page.locator("#practice-results li")).toHaveCount(5);
    await expect(page.locator("#practice-results details")).toHaveCount(2);
    await expect(page.locator(".cm-tooltip-autocomplete")).toHaveCount(0);
  }
});

test("partial scores, stale-result notice, per-question drafts/history, redo and original source restore", async ({
  page,
}) => {
  await ready(page);
  await code(page, 'OUTPUT "original draft"');
  await page.locator("#dialect").selectOption("9618-A2");
  await page.locator('[data-tab="reference"]').click();
  await page.locator("#guide-version").selectOption("2027–2029");
  await page.locator("#strictness").selectOption("learning");
  await page.locator("#policy-divNegative").selectOption("floor");
  await page.locator('[data-tab="practice"]').click();
  await load(page, "temperature");
  const partial = practiceSolutions.temperature.replace(
    "Temperature <= 0",
    "Temperature < 0",
  );
  await code(page, partial);
  await page.locator("#practice-submit").click();
  await expect(page.locator("#practice-score")).toHaveText(
    "当前答卷：80 / 100",
  );
  await code(page, partial + "\n// saved working draft");
  await expect(page.locator("#practice-results")).toContainText("请重新提交");
  await load(page, "sum-two");
  await load(page, "temperature");
  await expect(page.locator(".cm-content")).toContainText(
    "saved working draft",
  );
  await page.reload();
  await page.locator('[data-tab="practice"]').click();
  await expect(page.locator("#practice-history")).toContainText("80 / 100");
  await expect(page.locator(".cm-content")).toContainText(
    "saved working draft",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator('[data-practice-restore="0"]').click();
  await expect(page.locator(".cm-content")).not.toContainText(
    "saved working draft",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#practice-redo").click();
  await expect(page.locator(".cm-content")).toContainText("TODO");
  await expect(page.locator("#practice-history")).toContainText("80 / 100");
  await page.locator("#practice-return").click();
  await expect(page.locator(".cm-content")).toContainText(
    'OUTPUT "original draft"',
  );
  await expect(page.locator("#dialect")).toHaveValue("9618-A2");
  await page.locator('[data-tab="reference"]').click();
  await expect(page.locator("#guide-version")).toHaveValue("2027–2029");
  await expect(page.locator("#strictness")).toHaveValue("learning");
  await expect(page.locator("#policy-divNegative")).toHaveValue("floor");
});

test("ordinary Run remains interactive and cannot substitute grading inputs", async ({
  page,
}) => {
  await ready(page);
  await load(page, "sum-two");
  await code(page, practiceSolutions["sum-two"]);
  await page.locator("#run").click();
  await expect(page.locator("#input-form")).toBeVisible();
  await expect(page.locator("#practice-score")).toHaveCount(0);
  await page.locator("#runtime-input").fill("40");
  await page.locator("#input-form button").click();
  await page.locator("#runtime-input").fill("2");
  await page.locator("#input-form button").click();
  await expect(page.locator("#console-output")).toContainText("42");
  await page.locator('[data-tab="practice"]').click();
  await expect(page.locator("#practice-history")).toBeEmpty();
});

test("an intentionally empty practice draft survives switching exercises and continuing after reload", async ({
  page,
}) => {
  await ready(page);
  await load(page, "sum-two");
  await code(page, "");
  await expect(page.locator(".cm-content")).toHaveText("");
  await load(page, "temperature");
  await page.locator("#practice-select").selectOption("sum-two");
  await expect(page.locator("#practice-load")).toHaveText("继续作答");
  await page.locator("#practice-load").click();
  await expect(page.locator(".cm-content")).toHaveText("");
  await page.reload();
  await page.locator('[data-tab="practice"]').click();
  await expect(page.locator(".cm-content")).toHaveText("");
  await load(page, "temperature");
  await load(page, "sum-two");
  await expect(page.locator(".cm-content")).toHaveText("");
});

async function blockingGradingWorker(page: Page) {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    (window as any).__practiceTerminations = 0;
    window.Worker = function (url: string | URL, options?: WorkerOptions) {
      if (!String(url).includes("grading.worker"))
        return new NativeWorker(url, options);
      const worker = new NativeWorker(
        URL.createObjectURL(
          new Blob(
            ["postMessage({type:'ready'});onmessage=()=>{while(true){}}"],
            { type: "text/javascript" },
          ),
        ),
      );
      const terminate = worker.terminate.bind(worker);
      worker.terminate = () => {
        (window as any).__practiceTerminations++;
        terminate();
      };
      return worker;
    } as unknown as typeof Worker;
    window.Worker.prototype = NativeWorker.prototype;
  });
}

test("a truly blocked grading Worker is terminated on cancel, source edit and exercise change", async ({
  page,
}) => {
  await blockingGradingWorker(page);
  await ready(page);
  await load(page, "sum-two");
  await code(page, practiceSolutions["sum-two"]);
  await page.locator("#practice-submit").click();
  await expect(page.locator("#practice-status")).toContainText("正在判分");
  await page.locator("#practice-cancel").click();
  await expect(page.locator("#practice-status")).toContainText("已取消判分");
  await page.locator("#practice-submit").click();
  await expect(page.locator("#practice-status")).toContainText("正在判分");
  await code(page, practiceSolutions["sum-two"] + "\n// edited");
  await expect(page.locator("#practice-status")).toContainText("旧判分已取消");
  await page.locator("#practice-submit").click();
  await expect(page.locator("#practice-status")).toContainText("正在判分");
  await page.locator("#practice-select").selectOption("temperature");
  await expect(page.locator("#practice-submit")).toBeDisabled();
  await expect(page.locator("#practice-history")).toBeEmpty();
  expect(
    await page.evaluate(() => (window as any).__practiceTerminations),
  ).toBe(3);
});

test("a blocked Worker hits the wall-clock timeout without freezing the editor", async ({
  page,
}) => {
  await blockingGradingWorker(page);
  await ready(page);
  await load(page, "sum-two");
  await code(page, practiceSolutions["sum-two"]);
  await page.locator("#practice-submit").click();
  await expect(page.locator("#practice-status")).toContainText("正在判分");
  await expect(page.locator("#practice-score")).toHaveText(
    "当前答卷：0 / 100",
    { timeout: 10000 },
  );
  await expect(page.locator("#practice-results")).toContainText(
    "执行超过 4 秒",
  );
  await expect(page.locator("#practice-submit")).toBeEnabled();
  expect(
    await page.evaluate(() => (window as any).__practiceTerminations),
  ).toBe(1);
});

test("practice remains usable at phone width with visible question, controls and no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await load(page, "record-winner");
  await expect(page.locator("#practice-submit")).toBeVisible();
  await expect(page.locator(".practice-content")).toContainText("并列");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("exam editing and refresh cannot overwrite an active practice draft", async ({
  page,
}) => {
  await ready(page);
  await load(page, "sum-two");
  await code(
    page,
    practiceSolutions["sum-two"] + "\n// practice draft before exam",
  );
  if ((await page.locator("#exam-details").getAttribute("open")) === null)
    await page.locator("#exam-details > summary").click();
  await page.locator("#exam-start").click();
  await code(page, 'OUTPUT "unrelated exam answer"');
  await page.reload();
  await expect(page.locator("#exam-state")).toHaveText("考试进行中");
  if ((await page.locator("#exam-details").getAttribute("open")) === null)
    await page.locator("#exam-details > summary").click();
  await page.locator("#exam-submit").click();
  await page.locator("#exam-finish").click();
  await page.locator('[data-tab="practice"]').click();
  await expect(page.locator(".cm-content")).toContainText(
    "practice draft before exam",
  );
  await load(page, "temperature");
  await load(page, "sum-two");
  await expect(page.locator(".cm-content")).toContainText(
    "practice draft before exam",
  );
});
