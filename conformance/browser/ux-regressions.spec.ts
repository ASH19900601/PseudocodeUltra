import { test, expect, type Page } from "@playwright/test";

async function code(page: Page, source: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+a");
  if (source) await page.keyboard.insertText(source);
  else await page.keyboard.press("Backspace");
}
async function ready(page: Page) {
  await page.goto("/");
  await expect(page.locator(".cm-editor")).toBeVisible();
  await expect(page.locator("#run")).toBeEnabled();
}
async function uploadFile(page: Page, name: string, text: string) {
  await page
    .locator("#file-upload")
    .setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
  await expect(page.locator("#files")).toContainText(name);
}
test("an intentionally empty source survives page reload", async ({ page }) => {
  await ready(page);
  await code(page, "");
  await page.reload();
  await expect(page.locator(".cm-content")).toHaveText("");
});
test("blocked storage leaves an editable runnable app with a visible backup warning", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Blocked", "SecurityError");
      },
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await ready(page);
  await code(page, 'OUTPUT "session still works"');
  await expect(page.locator("#storage-warning")).toBeVisible();
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("执行完成");
  await expect(page.locator("#console-output")).toContainText(
    "session still works",
  );
  expect(errors).toEqual([]);
});
test("quota errors do not break source edits or execution", async ({
  page,
}) => {
  await ready(page);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Full", "QuotaExceededError");
    };
  });
  await code(page, 'OUTPUT "quota"');
  await expect(page.locator("#save-state")).toContainText("未保存");
  await page.locator("#run").click();
  await expect(page.locator("#console-output")).toContainText("quota");
});
test("invalid persisted numeric and semantic settings fall back to valid defaults", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("maxSteps", "NaN");
    localStorage.setItem("seed", "-99");
    localStorage.setItem("strictness", "broken");
    localStorage.setItem("logicalPrecedence", "broken");
    localStorage.setItem(
      "policies",
      '{"shortCircuit":"false","roundHalf":"wrong"}',
    );
  });
  await ready(page);
  await page.locator("#help-nav").click();
  await expect(page.locator("#max-steps")).toHaveValue("100000");
  await expect(page.locator("#random-seed")).toHaveValue("42");
  await expect(page.locator("#strictness")).toHaveValue("exam");
  await expect(page.locator("#policy-shortCircuit")).toHaveValue("true");
  await page.locator("#max-steps").fill("");
  await page.locator("#max-steps").blur();
  await expect(page.locator("#max-steps")).toHaveValue("100000");
});
test("execution waits for persisted virtual files to finish loading", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...args: Parameters<typeof open>) {
      const request = open.apply(this, args);
      Object.defineProperty(request, "onsuccess", {
        set(handler) {
          request.addEventListener("success", (event) =>
            setTimeout(() => handler?.call(request, event), 600),
          );
        },
      });
      return request;
    };
  });
  await page.goto("/");
  await expect(page.locator(".cm-editor")).toBeVisible();
  await expect(page.locator("#run")).toBeDisabled();
  await expect(page.locator("#run")).toBeEnabled();
});
test("completed programs evaluate newly added pure watches and source edits clear old state", async ({
  page,
}) => {
  await ready(page);
  await code(page, "DECLARE Total:INTEGER\nTotal ← 7\nOUTPUT Total");
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("执行完成");
  await page.locator("#watch-input").fill("Total + 1");
  await page.locator("#watch-form button").click();
  await expect(page.locator("#watches .watch span")).toHaveText("8");
  await code(page, 'OUTPUT "new"');
  await expect(page.locator("#variables")).not.toContainText("TOTAL");
  await expect(page.locator("#watches")).not.toContainText("8");
  await page.locator('[data-tab="trace"]').click();
  await expect(page.locator("#trace-table tbody tr")).toHaveCount(0);
});
test("runtime errors keep prior file writes and show the current variables", async ({
  page,
}) => {
  await ready(page);
  await page.locator("#dialect").selectOption("9618-AS");
  await code(
    page,
    'OPENFILE "before-error.txt" FOR WRITE\nWRITEFILE "before-error.txt", "saved before failure"\nCLOSEFILE "before-error.txt"\nDECLARE Zero:INTEGER\nZero ← 0\nOUTPUT 1 / Zero',
  );
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("执行错误");
  await expect(page.locator("#files")).toContainText("before-error.txt");
  await expect(page.locator("#variables")).toContainText("ZERO");
  await page.locator('[data-file="before-error.txt"]').click();
  await expect(page.locator("#file-text")).toHaveValue(
    "saved before failure\n",
  );
  await page.locator('#file-dialog button[value="cancel"]').click();
  await page.reload();
  await expect(page.locator("#files")).toContainText("before-error.txt");
});
test("changing source or target invalidates generated code downloads", async ({
  page,
}) => {
  await ready(page);
  await code(page, 'OUTPUT "one"');
  await page.locator('[data-tab="export"]').click();
  await page.locator("#convert").click();
  await expect(page.locator("#export-download")).toBeEnabled();
  await page.locator("#target").selectOption("java");
  await expect(page.locator("#export-download")).toBeDisabled();
  await page.locator("#convert").click();
  await expect(page.locator("#export-download")).toBeEnabled();
  await code(page, 'OUTPUT "two"');
  await expect(page.locator("#export-download")).toBeDisabled();
});
test("virtual text files can be downloaded and the same upload can be selected twice", async ({
  page,
}) => {
  await ready(page);
  await uploadFile(page, "notes.txt", "hello");
  await uploadFile(page, "notes.txt", "hello");
  await expect(page.locator("#files")).toContainText("notes.txt (2)");
  const download = page.waitForEvent("download");
  await page.locator('[data-export-file="notes.txt"]').click();
  expect((await download).suggestedFilename()).toBe("notes.txt");
});
test("new virtual files cannot silently overwrite an existing file", async ({
  page,
}) => {
  await ready(page);
  await uploadFile(page, "keep.txt", "original");
  page.once("dialog", (dialog) => dialog.accept("keep.txt"));
  const warning = page.waitForEvent("dialog", {
    predicate: (dialog) => dialog.type() === "alert",
  });
  const click = page.locator("#add-file").click();
  await (await warning).accept();
  await click;
  await expect(page.locator("#file-dialog")).not.toBeVisible();
  await page.locator('[data-file="keep.txt"]').click();
  await expect(page.locator("#file-text")).toHaveValue("original");
});
test("editing a file while execution waits for input prevents old snapshots overwriting it", async ({
  page,
}) => {
  await ready(page);
  await uploadFile(page, "edit.txt", "old");
  await code(page, "DECLARE S:STRING\nINPUT S\nOUTPUT S");
  await page.locator("#run").click();
  await expect(page.locator("#input-form")).toBeVisible();
  await page.locator('[data-file="edit.txt"]').click();
  await page.locator("#file-text").fill("new");
  await page.locator("#file-save").click();
  await expect(page.locator("#status")).toHaveText("已停止");
  await expect(page.locator("#input-form")).not.toBeVisible();
  await page.reload();
  await page.locator('[data-file="edit.txt"]').click();
  await expect(page.locator("#file-text")).toHaveValue("new");
});
test("random records survive editing a virtual file's text", async ({
  page,
}) => {
  await ready(page);
  await page.locator("#dialect").selectOption("9618-A2");
  const defs = "TYPE R\nDECLARE X:INTEGER\nENDTYPE\nDECLARE A:R\n";
  await code(
    page,
    defs +
      'A.X ← 17\nOPENFILE "records" FOR RANDOM\nPUTRECORD "records", A\nCLOSEFILE "records"',
  );
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("执行完成");
  await page.locator('[data-file="records"]').click();
  await expect(page.locator("#file-record-note")).toBeVisible();
  await page.locator("#file-text").fill("text metadata");
  await page.locator("#file-save").click();
  await code(
    page,
    defs +
      'OPENFILE "records" FOR RANDOM\nGETRECORD "records", A\nCLOSEFILE "records"\nOUTPUT A.X',
  );
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("执行完成");
  await expect(page.locator("#console-output")).toHaveText("17");
});
test("trace answers reset when column filters change the meaning of displayed rows", async ({
  page,
}) => {
  await ready(page);
  await code(page, "DECLARE A,B:INTEGER\nA ← 1\nB ← 2\nA ← 3\nOUTPUT A,B");
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("执行完成");
  await page.locator('[data-tab="trace"]').click();
  await page.locator("#trace-filter").selectOption("changes");
  await page.locator("#trace-blank").check();
  await page.locator(".trace-answer").first().fill("old row answer");
  await page.locator("#trace-columns").fill("A");
  await page.locator("#trace-columns").blur();
  await expect(page.locator(".trace-answer").first()).toHaveValue("");
});
test("manual, edit-triggered and blur-triggered execution modes work and persist", async ({
  page,
}) => {
  await ready(page);
  await page.locator("#run-mode").selectOption("change");
  await code(page, 'OUTPUT "automatic"');
  await expect(page.locator("#console-output")).toContainText("automatic");
  await page.locator("#run-mode").selectOption("blur");
  await code(page, 'OUTPUT "after blur"');
  await page.locator("#watch-input").focus();
  await expect(page.locator("#console-output")).toContainText("after blur");
  await page.reload();
  await expect(page.locator("#run-mode")).toHaveValue("blur");
});
test("opening source retains its filename and supports reopening the same file", async ({
  page,
}) => {
  await ready(page);
  const input = page.locator("#source-upload"),
    file = {
      name: "lesson.pseudo",
      mimeType: "text/plain",
      buffer: Buffer.from('OUTPUT "lesson"'),
    };
  await input.setInputFiles(file);
  await expect(page.locator("#source-name")).toHaveText("lesson.pseudo");
  await code(page, 'OUTPUT "changed"');
  await input.setInputFiles(file);
  await expect(page.locator(".cm-content")).toContainText('OUTPUT "lesson"');
  const download = page.waitForEvent("download");
  await page.locator("#download").click();
  expect((await download).suggestedFilename()).toBe("lesson.pseudo");
});
test("output tabs expose keyboard navigation and mobile reference remains visible", async ({
  page,
}) => {
  await ready(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-tab="console"]').focus();
  await page.keyboard.press("End");
  await expect(page.locator('[data-tab="practice"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator('[data-tab="reference"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#reference")).toBeVisible();
  const bounds = await page.locator('[data-tab="reference"]').boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
