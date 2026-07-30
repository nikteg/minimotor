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
  const playerRegion = () => page.screenshot({ clip: { x: 0, y: 250, width: 520, height: 200 } });
  const beforeMove = await playerRegion();
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(250);
  const afterMove = await playerRegion();
  expect(afterMove.equals(beforeMove)).toBe(false);
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(80);
  const jumping = await playerRegion();
  expect(jumping.equals(afterMove)).toBe(false);
  await page.keyboard.up("ArrowRight");

  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  const paused = await canvas.screenshot();
  await page.keyboard.press("Escape"); // modal dismissal must not re-pause on the next fixed step
  await page.waitForTimeout(100);
  const resumed = await canvas.screenshot();
  expect(resumed.equals(paused)).toBe(false);

  // Escape remains a reliable toggle after the modal-owned key has been
  // released; exercise another complete pause/resume cycle.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  const pausedAgain = await canvas.screenshot();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  const resumedAgain = await canvas.screenshot();
  expect(resumedAgain.equals(pausedAgain)).toBe(false);
  const afterEscapeResume = await playerRegion();
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(250);
  const movedAfterEscape = await playerRegion();
  await page.keyboard.up("ArrowLeft");
  expect(movedAfterEscape.equals(afterEscapeResume)).toBe(false);
  await context.close();
});

test("API Lab pixel art has continuous tile boundaries", async ({ browser }) => {
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  await page.goto("/api-lab/");
  const canvas = page.locator("canvas#game");
  await page.waitForTimeout(300);
  await canvas.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);

  const sampleUrl = "/api-lab/main.ts";
  const seams = await page.evaluate(async (url) => {
    const { game, Camera } = await import(/* @vite-ignore */ url);
    const { Draw } = game;
    const ctx = Draw.ctx;
    const frame = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    const pixel = (x: number, y: number) => {
      const i = (y * frame.width + x) * 4;
      return frame.data.subarray(i, i + 4);
    };
    const dpr = game.viewport.dpr;

    // A repeated source edge creates a full-height vertical color change. No
    // adjacent columns in the single-blit background may differ on every row.
    const backgroundTop = 80 * dpr;
    const backgroundBottom = 330 * dpr;
    let maxBackgroundColumnMismatches = 0;
    for (let x = 1; x < game.viewport.w * dpr; x++) {
      let mismatches = 0;
      for (let y = backgroundTop; y < backgroundBottom; y++) {
        const left = pixel(x - 1, y);
        const right = pixel(x, y);
        if (left.some((channel, i) => channel !== right[i])) mismatches++;
      }
      maxBackgroundColumnMismatches = Math.max(maxBackgroundColumnMismatches, mismatches);
    }

    // The commons is solid from x=0..128, y=288..304. A seam here exposes
    // blue ocean pixels between adjacent tile blits.
    const top = Math.round(Camera.toScreen({ x: 0, y: 288 }).y * dpr);
    const bottom = Math.round(Camera.toScreen({ x: 0, y: 304 }).y * dpr);
    let terrainBackdropPixels = 0;
    for (const worldX of Array.from({ length: 7 }, (_, i) => (i + 1) * 16)) {
      const x = Math.round(Camera.toScreen({ x: worldX, y: 0 }).x * dpr);
      for (let y = top; y < bottom; y++) {
        for (const sx of [x - 1, x]) {
          const [r, g, b] = pixel(sx, y);
          if (b > r && b > g) terrainBackdropPixels++;
        }
      }
    }
    return {
      backgroundRows: backgroundBottom - backgroundTop,
      maxBackgroundColumnMismatches,
      terrainRows: bottom - top,
      terrainBackdropPixels,
    };
  }, sampleUrl);

  expect(seams.maxBackgroundColumnMismatches).toBeLessThan(seams.backgroundRows);
  // auto9 edge art has a few deliberately transparent detail pixels; a seam
  // would expose the backdrop for a complete tile-height boundary.
  expect(seams.terrainBackdropPixels).toBeLessThan(seams.terrainRows);

  await page.evaluate(async (url) => {
    const { Camera } = await import(/* @vite-ignore */ url);
    Camera.follow({ x: 344, y: 256 }, { deadzone: null, damping: 1 });
    Camera.snap();
  }, sampleUrl);
  await page.waitForTimeout(100);
  const ladderMismatches = await page.evaluate(async (url) => {
    const { game, Camera } = await import(/* @vite-ignore */ url);
    const { Draw } = game;
    const ctx = Draw.ctx;
    const frame = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    const dpr = game.viewport.dpr;
    const same = (a: number, b: number) => {
      const ai = (a + b * frame.width) * 4;
      const bi = (a + (b - 1) * frame.width) * 4;
      return (
        frame.data[ai] === frame.data[bi] &&
        frame.data[ai + 1] === frame.data[bi + 1] &&
        frame.data[ai + 2] === frame.data[bi + 2] &&
        frame.data[ai + 3] === frame.data[bi + 3]
      );
    };
    let mismatches = 0;
    const left = Math.round(Camera.toScreen({ x: 336, y: 0 }).x * dpr);
    const right = Math.round(Camera.toScreen({ x: 352, y: 0 }).x * dpr);
    for (const worldY of [240, 256, 272]) {
      const y = Math.round(Camera.toScreen({ x: 0, y: worldY }).y * dpr);
      for (let x = left; x < right; x++) if (!same(x, y)) mismatches++;
    }
    return mismatches;
  }, sampleUrl);
  expect(ladderMismatches).toBe(0);
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
