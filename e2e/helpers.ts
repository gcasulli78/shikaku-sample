import { expect, type Page } from "@playwright/test";
import type { Difficulty, Rect, Variant } from "../src/types";

export interface Choice {
  size: "5x5" | "8x8" | "10x10" | "15x15";
  difficulty: Difficulty;
  variant?: Variant;
}

/**
 * Opens the game with clean settings (only once: a reload keeps the saved data) and waits for the
 * grid to be in play. Any JavaScript error fails the test.
 */
export async function open(page: Page, { size, difficulty, variant = "classic" }: Choice, path = "/"): Promise<void> {
  const [rows, cols] = size.split("x").map(Number);
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.addInitScript(
    (settings) => {
      if (sessionStorage.getItem("e2e")) return;
      sessionStorage.setItem("e2e", "1");
      localStorage.clear();
      localStorage.setItem("shikaku:settings", JSON.stringify(settings));
    },
    { sizeId: size, rows, cols, difficulty, variant, theme: "light" },
  );
  await page.goto(path);
  await ready(page);
}

/** Waits for a grid in play: numbers present and loading animation finished. */
export async function ready(page: Page): Promise<void> {
  await expect(page.locator("#board .pill").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#board")).not.toHaveClass(/loading|busy/);
}

/** The puzzle in play with its solution, from the game saved in the browser. */
export async function puzzle(page: Page): Promise<{ rows: number; cols: number; clues: unknown[]; solution: Rect[] }> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("shikaku:game")!).puzzle);
}

/** Drags from one corner of rect to the other, like with the mouse (or a tap if it is 1×1). */
export async function drag(page: Page, rect: Rect): Promise<void> {
  const { rows, cols } = await puzzle(page);
  const box = (await page.locator("#board").boundingBox())!;
  const at = (r: number, c: number) => ({
    x: box.x + ((c + 0.5) * box.width) / cols,
    y: box.y + ((r + 0.5) * box.height) / rows,
  });
  const from = at(rect.r, rect.c);
  const to = at(rect.r + rect.h - 1, rect.c + rect.w - 1);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
}
