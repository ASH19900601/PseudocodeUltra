import { test, expect, type Page } from "@playwright/test";

async function ready(page: Page) {
  await page.goto("/");
  await expect(page.locator(".cm-editor")).toBeVisible();
  await expect(page.locator("#run")).toBeEnabled();
}

function contrast(foreground: string, background: string) {
  const luminance = (color: string) => {
    const rgb = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number);
    return rgb.reduce((sum, channel, index) => {
      const value = channel / 255;
      const linear =
        value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      return sum + linear * [0.2126, 0.7152, 0.0722][index];
    }, 0);
  };
  const a = luminance(foreground),
    b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test("saved dark theme restores readable syntax and switching to light survives reload", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("theme") === null)
      localStorage.setItem("theme", "dark");
    localStorage.setItem(
      "source",
      '// Comment\nDECLARE Count:INTEGER\nCount ← 42\nOUTPUT "Hello"',
    );
  });
  await ready(page);
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator("body")).toHaveClass(/dark/);
  await expect(page.locator("#theme")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#theme")).toHaveAccessibleName(/切换到浅色/);
  const colors = await page.locator(".cm-editor").evaluate((editor) => {
    const background = getComputedStyle(editor).backgroundColor;
    return {
      background,
      text: getComputedStyle(editor).color,
      tokens: ["DECLARE", '"Hello"', "42", "// Comment"].map((token) => {
        const element = Array.from(
          editor.querySelectorAll(".cm-line span"),
        ).find((span) => span.textContent === token);
        return { token, color: element ? getComputedStyle(element).color : "" };
      }),
    };
  });
  expect(colors.background).toBe("rgb(20, 22, 37)");
  expect(contrast(colors.text, colors.background)).toBeGreaterThanOrEqual(4.5);
  for (const token of colors.tokens) {
    expect(
      token.color,
      `${token.token} must have syntax highlighting`,
    ).not.toBe("");
    expect(
      contrast(token.color, colors.background),
      `${token.token} contrast`,
    ).toBeGreaterThanOrEqual(4.5);
  }
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Shift+Home");
  const selection = page.locator(".cm-selectionBackground").first();
  await expect(selection).toBeVisible();
  expect(
    await selection.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    ),
  ).toBe("rgb(51, 67, 106)");
  // drawSelection hides the native caret and paints CodeMirror's cursor layer.
  await page.keyboard.press("ArrowRight");
  const cursor = page.locator(".cm-cursor-primary");
  await expect(cursor).toHaveCount(1);
  const caret = await cursor.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      color: style.borderLeftColor,
      width: parseFloat(style.borderLeftWidth),
    };
  });
  expect(caret.width).toBeGreaterThan(0);
  expect(contrast(caret.color, colors.background)).toBeGreaterThanOrEqual(4.5);
  await page.locator("#theme").click();
  await expect(page.locator("#theme")).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(page.locator("#theme")).toHaveAccessibleName(/切换到暗色/);
  await expect(page.locator("body")).not.toHaveClass(/dark/);
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe(
    "light",
  );
});

test("theme changes retain the source, cursor and undo history", async ({
  page,
}) => {
  const original = 'OUTPUT "original"';
  await page.addInitScript(
    (source) => localStorage.setItem("source", source),
    original,
  );
  await ready(page);
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n// edited");
  await page.keyboard.press("ArrowLeft");
  const cursor = await page.locator("#cursor").textContent();
  await page.locator("#theme").click();
  await page.locator("#theme").click();
  await expect(page.locator(".cm-content")).toContainText("// edited");
  await expect(page.locator("#cursor")).toHaveText(cursor!);
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".cm-content")).toHaveText(original);
});

test("dark completions and search use readable dark surfaces", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem(
      "source",
      "DECLARE Total:INTEGER\nTotal ← 42\nOUTPUT To",
    );
  });
  await ready(page);
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Control+Space");
  const popup = page.locator(".cm-tooltip-autocomplete");
  await expect(popup).toBeVisible();
  await expect(popup).toContainText("Total");
  const popupColors = await popup.evaluate((element) => {
    const selected = element.querySelector('[aria-selected="true"]')!;
    return {
      background: getComputedStyle(element).backgroundColor,
      color: getComputedStyle(element).color,
      selectedBackground: getComputedStyle(selected).backgroundColor,
      selectedColor: getComputedStyle(selected).color,
    };
  });
  expect(popupColors.background).toBe("rgb(32, 36, 58)");
  expect(
    contrast(popupColors.color, popupColors.background),
  ).toBeGreaterThanOrEqual(4.5);
  expect(
    contrast(popupColors.selectedColor, popupColors.selectedBackground),
  ).toBeGreaterThanOrEqual(4.5);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+f");
  const search = page.locator(".cm-panels");
  await expect(search).toBeVisible();
  const searchColors = await search.evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    color: getComputedStyle(element).color,
  }));
  expect(searchColors.background).toBe("rgb(32, 36, 58)");
  expect(
    contrast(searchColors.color, searchColors.background),
  ).toBeGreaterThanOrEqual(4.5);
});

for (const width of [1440, 390]) {
  test(`both themes fit the ${width}px workspace without horizontal page overflow`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await ready(page);
    for (const dark of [false, true]) {
      if (dark) await page.locator("#theme").click();
      await expect(page.locator("#theme")).toBeVisible();
      await expect(page.locator("#run")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
    }
  });
}
