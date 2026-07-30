// End-to-end multiplayer against the REAL relay and the REAL room server that
// the dev server mounts (/ws-signal and /ws-rooms — see vite.config.ts). Two
// live browser pages join one room and have to actually see each other:
// WebRTC negotiation, the wire frame, the packed body codec, interpolation and
// host-authoritative items are all genuinely exercised.
//
// Each topology gets a fresh room name so parallel runs never share state.
import { test, expect, type Page } from "@playwright/test";

// Two page loads, an ICE handshake, a clock sync and a 3-second respawn do not
// fit the suite's 10s default.
test.describe.configure({ timeout: 60000 });

/** What the sample exposes on `window.netroom` for exactly this purpose. */
interface RoomView {
  id: string;
  online: boolean;
  count: number;
  hosting: boolean;
  topology: "p2p" | "server";
  me: { x: number; y: number; color: string };
  others: Array<{ id: string; x: number; y: number; color: string }>;
  coins: number;
  score: number;
}

/** The non-serializable half of the same hook: the engine's layout recorder,
 *  which is how a test finds a canvas widget it needs to click. */
interface Hook {
  stage: { w: number; h: number };
  layoutCapture(on: boolean): void;
  layoutTree(): Array<{ id?: string; screenRect: { x: number; y: number; w: number; h: number } }>;
}

const read = (page: Page): Promise<RoomView> =>
  page.evaluate(() =>
    JSON.parse(JSON.stringify((window as never as { netroom: unknown }).netroom)),
  );

async function openRoom(page: Page, room: string, server: boolean): Promise<void> {
  await page.goto(`/netroom/?room=${room}${server ? "&server" : ""}`);
  await expect(page.locator("canvas#game")).toBeVisible();
  // The room resolves before the loop starts; wait for it to report itself.
  await expect.poll(async () => (await read(page)).id, { timeout: 8000 }).not.toBe("");
}

/** Wait until `page` can see `count` other players. */
async function seesOthers(page: Page, count: number): Promise<void> {
  await expect.poll(async () => (await read(page)).others.length, { timeout: 15000 }).toBe(count);
}

for (const server of [false, true]) {
  const topology = server ? "client/server" : "peer-to-peer";

  test.describe(`netroom over ${topology}`, () => {
    test(`two players see each other and each other's movement`, async ({ browser }) => {
      const room = `e2e-${server ? "srv" : "p2p"}-${Date.now()}`;
      const first = await browser.newContext();
      const second = await browser.newContext();
      const a = await first.newPage();
      const b = await second.newPage();

      try {
        await openRoom(a, room, server);
        await openRoom(b, room, server);

        // Both are online, in the same room, and know the room holds two.
        for (const page of [a, b]) {
          const view = await read(page);
          expect(view.online).toBe(true);
          expect(view.topology).toBe(server ? "server" : "p2p");
        }
        await expect.poll(async () => (await read(a)).count, { timeout: 15000 }).toBe(2);

        // Exactly one of them relays/owns shared state, whoever it is.
        const hosts = [(await read(a)).hosting, (await read(b)).hosting].filter(Boolean);
        expect(hosts).toHaveLength(1);

        // Each sees the other's blob.
        await seesOthers(a, 1);
        await seesOthers(b, 1);
        expect((await read(a)).others[0].id).toBe((await read(b)).id);
        // Distinct player slots mean distinct colors.
        expect((await read(a)).me.color).not.toBe((await read(b)).me.color);

        // Movement crosses the wire: drive A right, watch B's copy of A follow.
        const startX = (await read(b)).others[0].x;
        await a.locator("canvas#game").click();
        await a.keyboard.down("ArrowRight");
        await expect
          .poll(async () => (await read(b)).others[0]?.x ?? startX, { timeout: 8000 })
          .toBeGreaterThan(startX + 20);
        await a.keyboard.up("ArrowRight");

        // …and the position B renders is A's own, not a stale guess.
        await a.waitForTimeout(400);
        const mine = (await read(a)).me.x;
        const theirs = (await read(b)).others[0].x;
        expect(Math.abs(mine - theirs)).toBeLessThan(30);
      } finally {
        await first.close();
        await second.close();
      }
    });

    test(`a coin taken by one player disappears for the other`, async ({ browser }) => {
      const room = `e2e-coin-${server ? "srv" : "p2p"}-${Date.now()}`;
      const first = await browser.newContext();
      const second = await browser.newContext();
      const a = await first.newPage();
      const b = await second.newPage();

      try {
        await openRoom(a, room, server);
        await openRoom(b, room, server);
        await seesOthers(a, 1);
        await seesOthers(b, 1);
        expect((await read(a)).coins).toBe(3);

        // Walk A rightwards along the coin row. Whoever hosts has to confirm
        // the take, and the OTHER page has to lose the same coin.
        await a.locator("canvas#game").click();
        await a.keyboard.down("ArrowRight");
        await expect.poll(async () => (await read(a)).score, { timeout: 10000 }).toBeGreaterThan(0);
        await expect.poll(async () => (await read(b)).coins, { timeout: 10000 }).toBeLessThan(3);

        // Step off the row so nothing is re-collected, and watch every coin
        // come back for both players after respawnMs.
        await a.keyboard.up("ArrowRight");
        await a.keyboard.down("ArrowDown");
        await a.waitForTimeout(500);
        await a.keyboard.up("ArrowDown");
        await expect.poll(async () => (await read(b)).coins, { timeout: 10000 }).toBe(3);
        await expect.poll(async () => (await read(a)).coins, { timeout: 10000 }).toBe(3);
      } finally {
        await first.close();
        await second.close();
      }
    });

    test(`a player leaving is dropped from the room`, async ({ browser }) => {
      const room = `e2e-leave-${server ? "srv" : "p2p"}-${Date.now()}`;
      const first = await browser.newContext();
      const second = await browser.newContext();
      const a = await first.newPage();
      const b = await second.newPage();

      try {
        await openRoom(a, room, server);
        await openRoom(b, room, server);
        await seesOthers(b, 1);

        await first.close();
        await seesOthers(b, 0);
        await expect.poll(async () => (await read(b)).count, { timeout: 15000 }).toBe(1);
        // The survivor owns shared state now, whichever side it was on.
        await expect.poll(async () => (await read(b)).hosting, { timeout: 15000 }).toBe(true);
      } finally {
        await second.close();
      }
    });
  });
}

test("rooms with different names never see each other", async ({ browser }) => {
  const stamp = Date.now();
  const first = await browser.newContext();
  const second = await browser.newContext();
  const a = await first.newPage();
  const b = await second.newPage();
  try {
    await openRoom(a, `e2e-here-${stamp}`, true);
    await openRoom(b, `e2e-there-${stamp}`, true);
    await a.waitForTimeout(1500);
    expect((await read(a)).others).toEqual([]);
    expect((await read(b)).others).toEqual([]);
    expect((await read(a)).count).toBe(1);
    // Each isolated room elects its own owner.
    expect((await read(a)).hosting && (await read(b)).hosting).toBe(true);
  } finally {
    await first.close();
    await second.close();
  }
});

test("the TRANSPORT button reloads the same room onto the server", async ({ page }) => {
  const room = `e2e-switch-${Date.now()}`;
  await openRoom(page, room, false);
  expect((await read(page)).topology).toBe("p2p");

  // The HUD button is a canvas widget, so ask the engine where it landed:
  // UI.layoutCapture records every resolved rect, UI.layoutTree reports them.
  // The rects are in logical stage px, letterboxed (uniform scale, centered)
  // into the canvas — map that to CSS px and click the real thing.
  await page.evaluate(() => {
    (window as never as { netroom: Hook }).netroom.layoutCapture(true);
  });
  await expect
    .poll(() =>
      page.evaluate(() => (window as never as { netroom: Hook }).netroom.layoutTree().length),
    )
    .toBeGreaterThan(0);
  const at = await page.evaluate(() => {
    const netroom = (window as never as { netroom: Hook }).netroom;
    const tree = netroom.layoutTree();
    const button = tree.find((entry) => entry.id === "mode-server");
    if (!button) throw new Error(`no mode-server widget in ${tree.map((e) => e.id).join()}`);
    const stage = netroom.stage;
    const rect = (
      document.querySelector("canvas#game") as HTMLCanvasElement
    ).getBoundingClientRect();
    const scale = Math.min(rect.width / stage.w, rect.height / stage.h);
    const { x, y, w, h } = button.screenRect;
    return {
      x: rect.x + (rect.width - stage.w * scale) / 2 + (x + w / 2) * scale,
      y: rect.y + (rect.height - stage.h * scale) / 2 + (y + h / 2) * scale,
    };
  });
  await page.mouse.click(at.x, at.y);

  await page.waitForURL(new RegExp(`server`));
  await expect.poll(async () => (await read(page)).topology, { timeout: 8000 }).toBe("server");
  expect(new URL(page.url()).searchParams.get("room")).toBe(room);
  // Clicking the world must not steal the arrow keys from the game.
  await page.locator("canvas#game").click({ position: { x: 60, y: 400 } });
  const before = (await read(page)).me.x;
  await page.keyboard.down("ArrowRight");
  await expect
    .poll(async () => (await read(page)).me.x, { timeout: 5000 })
    .toBeGreaterThan(before + 20);
  await page.keyboard.up("ArrowRight");
});

test("one player alone still runs the full host-authoritative path", async ({ page }) => {
  await openRoom(page, `e2e-alone-${Date.now()}`, true);
  const view = await read(page);
  expect(view.others).toEqual([]);
  expect(view.count).toBe(1);
  expect(view.hosting).toBe(true);
  expect(view.coins).toBe(3);

  await page.locator("canvas#game").click();
  await page.keyboard.down("ArrowRight");
  await expect.poll(async () => (await read(page)).score, { timeout: 10000 }).toBeGreaterThan(0);
  await page.keyboard.up("ArrowRight");
});
