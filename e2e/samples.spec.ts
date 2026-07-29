import { test, expect } from "@playwright/test";

test("minimal sample loads and renders square", async ({ page }) => {
  await page.goto("/minimal/");
  await expect(page.locator("canvas#game")).toBeVisible();
  await page.waitForTimeout(500);
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(300);
  await page.keyboard.up("ArrowRight");
  await expect(page.locator("canvas#game")).toBeVisible();
});

test("API Lab starts from the virtual JUMP button", async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 800, height: 450 },
  });
  const page = await context.newPage();
  await page.goto("/api-lab/");

  const canvas = page.locator("canvas#game");
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(300);
  const title = await canvas.screenshot();

  // The button is anchored 78px from the right and 82px from the bottom.
  // Hold through at least one fixed step, as a real touch does.
  const jump = { clientX: 800 - 78, clientY: 450 - 82, pointerId: 1, pointerType: "touch" };
  await canvas.dispatchEvent("pointerdown", jump);
  await page.waitForTimeout(50);
  await canvas.dispatchEvent("pointerup", jump);
  await page.waitForTimeout(300);
  const playing = await canvas.screenshot();

  expect(playing.equals(title)).toBe(false);
  await context.close();
});

test("server browser supports canvas Tab focus and native editors", async ({ page }) => {
  await page.goto("/serverbrowser/");
  await expect(page.locator("canvas#game")).toBeVisible();
  await page.keyboard.press("Tab"); // enter the canvas; mode tabs receive logical focus
  await expect(page.locator("canvas#game")).toBeFocused();
  await page.keyboard.press("Tab"); // filters button
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("INPUT");
  await page.keyboard.type("Neon");
  await page.keyboard.press("Tab");
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("SELECT");
});

for (const sample of ["netgame", "road-rivals"]) {
  test(`${sample} opens two live clients`, async ({ page }) => {
    await page.goto(`/${sample}/`);
    await expect(page.locator("iframe")).toHaveCount(2);
    await expect(page.frameLocator("iframe").first().locator("canvas#game")).toBeVisible();
    await expect(page.frameLocator("iframe").nth(1).locator("canvas#game")).toBeVisible();
  });
}

test("breakout sample loads and plays", async ({ page }) => {
  await page.goto("/breakout/");
  await expect(page.locator("canvas#game")).toBeVisible();
  await page.waitForTimeout(1000);
  // Press space to launch ball
  await page.keyboard.press("Space");
  await page.waitForTimeout(2000);
  await expect(page.locator("canvas#game")).toBeVisible();
});

test("snake sample loads and runs", async ({ page }) => {
  await page.goto("/snake/");
  await expect(page.locator("canvas#game")).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(page.locator("canvas#game")).toBeVisible();
});

test("particles sample spawns on click", async ({ page }) => {
  await page.goto("/particles/");
  await expect(page.locator("canvas#game")).toBeVisible();
  await page.waitForTimeout(500);
  const canvas = page.locator("canvas#game");
  await canvas.click({ position: { x: 200, y: 200 } });
  await page.waitForTimeout(500);
  await expect(canvas).toBeVisible();
});

for (const sample of ["guild-trader", "dungeon-scout", "lead-defender", "checkpoint-rally"]) {
  test(`${sample} Goodies sample loads`, async ({ page }) => {
    await page.goto(`/${sample}/`);
    await expect(page.locator("canvas#game")).toBeVisible();
    await page.waitForTimeout(400);
  });
}

test("synth sample loads and starts audio", async ({ page }) => {
  await page.goto("/synth/");
  await expect(page.locator("canvas#game")).toBeVisible();
  await page.waitForTimeout(500);
  const canvas = page.locator("canvas#game");
  await canvas.click({ position: { x: 400, y: 300 } });
  await page.waitForTimeout(2000);
  await expect(canvas).toBeVisible();
});

test("physics sample: a body follows a pointer drag", async ({ page }) => {
  // Physics2D.drag through real pointer events: press on a settled crate, pull
  // it across the canvas, and check the body came along.
  await page.goto("/physics/");
  await expect(page.locator("canvas#game")).toBeVisible();
  await page.waitForFunction(() => (window.__phys?.bodies().length ?? 0) > 0);
  await page.waitForTimeout(2500); // let the pile settle so nothing is in free fall

  const start = await page.evaluate(() => {
    // The lowest body has landed; grab that one.
    const bodies = window.__phys!.bodies();
    return bodies.sort((a, b) => b.y - a.y)[0];
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expect.poll(() => page.evaluate(() => window.__phys!.grabbed())).toBe(true);

  const target = { x: start.x, y: start.y - 200 };
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(start.x + ((target.x - start.x) * i) / 10, start.y - 20 * i);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(300);
  const lifted = await page.evaluate(() => {
    const bodies = window.__phys!.bodies();
    return Math.min(...bodies.map((b) => b.y));
  });
  await page.mouse.up();
  expect(lifted).toBeLessThan(start.y - 100); // it was dragged up the screen
  await expect.poll(() => page.evaluate(() => window.__phys!.grabbed())).toBe(false);
});
