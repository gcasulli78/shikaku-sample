import { expect, test } from "@playwright/test";
import pkg from "../package.json" with { type: "json" };
import { generate } from "../src/generator";
import { encodePuzzle } from "../src/share";
import { drag, open, puzzle, ready } from "./helpers";

test("si carica una griglia con i numeri colorati e la versione", async ({ page }) => {
  await open(page, { size: "8x8", difficulty: "medium" });
  const { clues } = await puzzle(page);
  await expect(page.locator("#board .pill")).toHaveCount(clues.length);
  // Un colore che il browser non capisce lascerebbe la pastiglia trasparente, numero invisibile.
  const background = await page
    .locator("#board .pill")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background).not.toBe("rgba(0, 0, 0, 0)");
  await expect(page.locator("#version")).toHaveText(`Versione ${pkg.version}`);
});

test("risolvendo il puzzle trascinando i rettangoli si vince", async ({ page }) => {
  await open(page, { size: "5x5", difficulty: "easy" });
  const { solution } = await puzzle(page);
  for (const rect of solution) await drag(page, rect);
  await expect(page.locator("#win")).toBeVisible();
  await expect(page.locator("#win-text")).toContainText("senza aiuti");
});

test("dopo una vittoria il record compare nella tabella", async ({ page }) => {
  await open(page, { size: "5x5", difficulty: "easy" });
  const { solution } = await puzzle(page);
  for (const rect of solution) await drag(page, rect);
  await page.locator("#win").getByRole("button", { name: "Chiudi" }).click();
  await page.locator("#records-btn").click();
  const row = page.locator("#records-body tbody tr");
  await expect(row).toHaveCount(1);
  await expect(row.locator("td").first()).toHaveText("5×5 · Facile");
  await expect(row.locator("td").nth(1)).toHaveText("1");
});

test("da tastiera si posa e si toglie un rettangolo", async ({ page, isMobile }) => {
  test.skip(isMobile, "sul telefono non c'è la tastiera fisica");
  await open(page, { size: "8x8", difficulty: "easy" });
  const { solution } = await puzzle(page);
  const rect = solution.find((r) => r.h * r.w > 1)!;
  const board = page.locator("#board");
  await board.focus();
  // Il primo tasto mostra il cursore sulla prima casella senza spostarlo.
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("#board .cursor")).toHaveCount(1);
  const go = async (r: number, c: number, from: [number, number]) => {
    for (let k = from[0]; k < r; k++) await page.keyboard.press("ArrowDown");
    for (let k = from[1]; k < c; k++) await page.keyboard.press("ArrowRight");
  };
  await go(rect.r, rect.c, [0, 0]);
  await page.keyboard.press("Enter");
  await go(rect.r + rect.h - 1, rect.c + rect.w - 1, [rect.r, rect.c]);
  await expect(page.locator("#sr")).toContainText(`selezione ${rect.h}×${rect.w}`);
  await page.keyboard.press("Enter");
  await expect(page.locator("#board .rect.valid")).toHaveCount(1);
  await page.keyboard.press("Delete");
  await expect(page.locator("#board .rect")).toHaveCount(0);
  // Con il mouse il cursore sparisce.
  await page.mouse.move(10, 10);
  await drag(page, { r: 0, c: 0, h: 1, w: 1 });
  await expect(page.locator("#board .cursor")).toHaveCount(0);
});

test("un rettangolo con due numeri è sbagliato e un tocco lo toglie", async ({ page }) => {
  await open(page, { size: "5x5", difficulty: "easy" });
  await drag(page, { r: 0, c: 0, h: 5, w: 5 });
  await expect(page.locator("#board .rect.bad")).toHaveCount(1);
  await drag(page, { r: 2, c: 2, h: 1, w: 1 });
  await expect(page.locator("#board .rect")).toHaveCount(0);
});

test("il suggerimento aiuta a gradi: indizio, motivo, pezzo; a Medio se ne usano 5", async ({ page }) => {
  await open(page, { size: "8x8", difficulty: "medium" });
  const hint = page.locator("#hint");
  await expect(hint).toHaveText("Suggerimento (5)");
  await hint.click();
  await expect(page.locator("#status")).toContainText("Guarda");
  await expect(hint).toHaveText("Perché?");
  await hint.click();
  await expect(hint).toHaveText("Mostra il pezzo");
  await hint.click();
  await expect(page.locator("#board .rect.hinted")).toHaveCount(1);
  // I gradi non contano, il pezzo posato sì.
  await expect(hint).toHaveText("Suggerimento (4)");
});

test("a Maestro il suggerimento si usa due volte, senza spiegazioni", async ({ page }) => {
  // Da un link e con un seed fisso: generando nella pagina, sotto carico il Maestro può non
  // arrivare in tempo e il gioco propone giustamente il livello vicino.
  const master = generate({ rows: 8, cols: 8, difficulty: "master", seed: 1, maxCandidates: 1000 });
  expect(master.difficulty).toBe("master");
  await open(page, { size: "5x5", difficulty: "easy" }, `/#p=${encodePuzzle({ ...master, variant: "classic" })}`);
  await expect(page.locator("#status")).toContainText("Maestro");
  const hint = page.locator("#hint");
  await expect(hint).toHaveText("Suggerimento (2)");
  await hint.click();
  await expect(page.locator("#status")).toHaveText("Ecco un pezzo. Ne resta 1.");
  await hint.click();
  await expect(hint).toHaveText("Suggerimenti finiti");
  await expect(hint).toBeDisabled();
  // A Maestro una verifica sola.
  const check = page.locator("#check");
  await expect(check).toHaveText("Verifica (1)");
  await check.click();
  await expect(page.locator("#status")).toHaveText("Finora è tutto giusto.");
  await expect(check).toHaveText("Verifiche finite");
  await expect(check).toBeDisabled();
});

test("il cronometro parte al caricamento, senza mosse", async ({ page }) => {
  await open(page, { size: "5x5", difficulty: "easy" });
  await expect(page.locator("#timer")).not.toHaveText("0:00", { timeout: 4000 });
});

test("ricaricando la pagina si riprende la partita", async ({ page }) => {
  await open(page, { size: "8x8", difficulty: "easy" });
  const { solution } = await puzzle(page);
  await drag(page, solution[0]!);
  await expect(page.locator("#board .rect.valid")).toHaveCount(1);
  await page.reload();
  await ready(page);
  await expect(page.locator("#board .rect.valid")).toHaveCount(1);
});

test("un link condiviso apre lo stesso puzzle", async ({ page }) => {
  const shared = generate({ rows: 6, cols: 7, seed: 3 });
  const code = encodePuzzle({ ...shared, variant: "classic" });
  await open(page, { size: "5x5", difficulty: "easy" }, `/#p=${code}`);
  const opened = await puzzle(page);
  expect(opened.rows).toBe(6);
  expect(opened.cols).toBe(7);
  expect(opened.clues).toEqual(shared.clues);
  await expect(page.locator("#status")).toContainText("da un link");
});

test("il tutorial si apre e uscendo si torna alla partita", async ({ page }) => {
  await open(page, { size: "8x8", difficulty: "easy" });
  const before = await puzzle(page);
  await page.locator("#tutorial-btn").click();
  await expect(page.locator("#tutorial")).toBeVisible();
  await expect(page.locator("#tutorial-title")).not.toBeEmpty();
  await page.locator("#tutorial-exit").click();
  await expect(page.locator("#tutorial")).toBeHidden();
  await ready(page);
  expect((await puzzle(page)).clues).toEqual(before.clues);
});

test("senza oklch() i colori hanno l'alternativa HSL", async ({ page }) => {
  // Simula un browser vecchio: ogni oklch( nella pagina diventa una funzione sconosciuta,
  // compreso il controllo @supports, così vale il blocco con le tinte HSL.
  await page.route("**/", async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replaceAll("oklch(", "oklch-old(");
    await route.fulfill({ response, body: html });
  });
  await open(page, { size: "5x5", difficulty: "easy" });
  const background = await page
    .locator("#board .pill")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background).toMatch(/^rgb\(/);
  expect(background).not.toBe("rgba(0, 0, 0, 0)");
});
