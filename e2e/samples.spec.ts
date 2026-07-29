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

test("API Lab starts from its modal PLAY button", async ({ browser }) => {
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

  await canvas.focus(); // focuses the modal's first interactive widget: PLAY
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const playing = await canvas.screenshot();

  expect(playing.equals(title)).toBe(false);
  const playerBox = (color?: [number, number, number]) =>
    canvas.evaluate((node, target) => {
      const ctx = node.getContext("2d")!;
      const data = ctx.getImageData(0, 0, node.width, node.height).data;
      if (!target) {
        const colors = new Map<string, number>();
        for (let y = node.height / 2; y < node.height; y++)
          for (let x = 0; x < node.width / 3; x++) {
            const i = (Math.floor(y) * node.width + x) * 4;
            const [r, g, b] = data.slice(i, i + 3);
            if (Math.max(r, g, b) - Math.min(r, g, b) < 60) continue;
            const key = `${r},${g},${b}`;
            colors.set(key, (colors.get(key) ?? 0) + 1);
          }
        target = [...colors]
          .sort((a, b) => b[1] - a[1])[0][0]
          .split(",")
          .map(Number) as [number, number, number];
      }
      const [r, g, b] = target;
      let minX = node.width;
      let minY = node.height;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < node.height; y++)
        for (let x = 0; x < node.width; x++) {
          const i = (y * node.width + x) * 4;
          if (data[i] !== r || data[i + 1] !== g || data[i + 2] !== b) continue;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      return { color: target, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    }, color);

  const beforeMove = await playerBox();
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(250);
  const afterMove = await playerBox(beforeMove.color);
  expect(afterMove.x).toBeGreaterThan(beforeMove.x);
  await page.keyboard.press("Space");
  await page.waitForTimeout(50);
  const dashing = await playerBox(beforeMove.color);
  expect(dashing.h).toBeLessThan(afterMove.h);
  await page.keyboard.up("ArrowRight");

  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  const paused = await canvas.screenshot();
  await page.keyboard.press("Enter"); // modal focus is trapped on Resume
  await page.waitForTimeout(100);
  const resumed = await canvas.screenshot();
  expect(resumed.equals(paused)).toBe(false);
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
