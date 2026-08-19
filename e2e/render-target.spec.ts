import { expect, test, type Page } from "@playwright/test";

// `Renderer3D.createTarget` on a real GPU.
//
// **Why a browser and not a source comparison.** The rest of this repo settles
// WebGPU-vs-WebGL2 questions by reading the two shader sources as text, and for
// a shading term that is the right tool. A render target is not a shading term:
// it is a framebuffer binding, and its failure modes are all invisible to text
// and to a screenshot of the page — a target that is never cleared, a pass that
// is never unbound so every later frame in the app lands offscreen, a target
// with no depth attachment, a projection built from the canvas's aspect instead
// of the target's. Each of those still typechecks, still draws something, and
// three of the four still put a perfectly good picture on the canvas.
//
// The harness is `samples/render-target/`, which runs one fixed sequence —
// canvas, then target, then canvas again — and exposes what it read as numbers.
// See its header for how the two boxes in the scene are arranged.
//
// **WebGL2 only, and that is a measurement rather than an omission**, the same
// one `glaze.spec.ts` records: `navigator.gpu` is absent from the headless
// Chromium Playwright drives here, so there is no WebGPU frame on this machine
// to compare against. What holds the WebGPU path to this one is
// `render-target.test.ts`, which reads both backends' target code as text.

test.use({ viewport: { width: 320, height: 320 }, deviceScaleFactor: 1 });

type Harness = NonNullable<Window["__renderTarget"]>;

async function harness(page: Page): Promise<Harness> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/render-target/?backend=webgl2");
  await expect
    .poll(async () => page.evaluate(() => window.__renderTarget?.ready === true), { timeout: 5000 })
    .toBe(true);
  expect(errors, "the harness ran clean").toEqual([]);
  return page.evaluate(() => window.__renderTarget!);
}

test("the target comes back with the scene in it", async ({ page }) => {
  const { target } = await harness(page);
  expect(target.width).toBe(128);
  expect(target.height).toBe(64);
  // RGBA8, one row per line: the readback's own size is the first thing that
  // would betray a target allocated at the canvas's size instead of its own.
  expect(target.bytes).toBe(128 * 64 * 4);

  const [r, g, b, a] = target.center;
  expect(g!, "the near box is green, and it is in the middle").toBeGreaterThan(200);
  expect(r!).toBeLessThan(60);
  expect(a!, "opaque, so the clear wrote alpha too").toBe(255);
  // Blue in the middle would be the far box, drawn second in node order,
  // painting over the near one — a pass whose depth attachment is missing or
  // not bound with the colour.
  expect(b!, "and the depth buffer kept the far box behind it").toBeLessThan(60);
});

test("the readback's first row is the TOP of the frame", async ({ page }) => {
  // `RenderTarget3D.readPixels` promises top row first and GL hands back bottom
  // row first, so one backend flips and the other does not — which makes this
  // the one claim in the file that a symmetric frame could never make. The
  // marker box sits above the other two in the world; nothing else in the scene
  // is red.
  const { target } = await harness(page);
  const marker = target.marker;
  expect(marker, "the marker is in the frame").not.toBeNull();
  expect(marker!.y + marker!.h, "wholly inside the top half").toBeLessThan(target.height / 2);
  // Above the near box, not merely near the top — a frame flipped AND
  // recentred would still be wrong in the same direction.
  expect(marker!.y + marker!.h).toBeLessThanOrEqual(target.green!.y);
});

test("the target was cleared, not handed back whatever was in the memory", async ({ page }) => {
  const { target } = await harness(page);
  const [r, g, b, a] = target.corner;
  // The scene's background, which no box reaches: [0.1, 0.05, 0.2] in linear-ish
  // 0..1, so a low red, a lower green and a middling blue. Read as a shape
  // rather than as exact bytes, because the backends' colour handling is not
  // what this test is about.
  expect(a!).toBe(255);
  expect(b!, "the background's blue").toBeGreaterThan(g!);
  expect(r!, "and its red sits between").toBeGreaterThan(g!);
  expect(b!).toBeGreaterThan(r!);
});

test("drawing into a target does not touch the canvas", async ({ page }) => {
  const { canvas } = await harness(page);
  // Nothing was drawn to the canvas between these two readings; the only thing
  // that happened was a render into the target. A digest that moved is a pass
  // that wrote to the screen as well as to the target.
  expect(canvas.afterTarget.digest).toBe(canvas.beforeTarget.digest);
});

test("the pass leaves the context on the default framebuffer", async ({ page }) => {
  // The failure this whole file exists for — measured at the BINDING, which is
  // a correction worth writing down. The obvious version of this test renders
  // into a target and then checks that the next canvas frame still arrives; it
  // passes with the unbind deleted, verified by deleting it, because `render`
  // also rebinds the default framebuffer on the way IN. Nothing inside the
  // renderer can see a leaked binding. Everything else sharing the context can:
  // the app's own GL calls, a library stacked on the same canvas, a `readPixels`
  // that would silently read the target instead of the screen.
  const { unboundAfterTargetRender } = await harness(page);
  expect(unboundAfterTargetRender).toBe(true);
});

test("the next canvas frame after a target render is the new one", async ({ page }) => {
  // Weaker than the test above and kept for a different reason: it is the
  // end-to-end shape of the sequence the app actually performs, and it fails on
  // a whole class of state left behind — a viewport, a depth mask, a bound
  // attachment — that a binding check alone would not notice.
  const { canvas } = await harness(page);
  expect(canvas.beforeTarget.center[1], "the frame before was green").toBeGreaterThan(200);
  expect(canvas.afterUnbind.center[0], "and the frame after is red").toBeGreaterThan(200);
  expect(canvas.afterUnbind.center[1]).toBeLessThan(60);
  expect(canvas.afterUnbind.digest).not.toBe(canvas.beforeTarget.digest);
});

test("the projection takes the TARGET's aspect, not the canvas's", async ({ page }) => {
  const { target, canvasSize } = await harness(page);
  // The canvas is square and the target is 2:1, so this is a claim the harness
  // can only make because the two disagree.
  expect(canvasSize).toBe(128);
  expect(target.width / target.height).toBe(2);

  const green = target.green;
  expect(green, "the near box is somewhere in the frame").not.toBeNull();
  // Its silhouette is a cube's front face seen square on: a square in the
  // world. With the target's own aspect that is a square in pixels; with the
  // canvas's square aspect applied to a 2:1 target it is stretched to twice as
  // wide as it is tall. One pixel of slack for the edge landing between samples.
  expect(Math.abs(green!.w - green!.h), `green was ${green!.w}×${green!.h}`).toBeLessThanOrEqual(1);

  // The control: the far box is bigger and further away, so it must surround
  // the near one. If it did not, the frame is not the scene this test thinks
  // it is measuring and the square above proves nothing.
  const blue = target.blue;
  expect(blue).not.toBeNull();
  expect(blue!.w).toBeGreaterThan(green!.w);
  expect(blue!.x).toBeLessThan(green!.x);
});

test("an ATLAS: two views in one target, one clear between them", async ({ page }) => {
  // The shape a probe wants and the reason `RenderOptions.viewport` exists — six
  // faces from one point in one texture, so a material binds one sampler rather
  // than six. Measured here with two, because two is where every failure of it
  // already shows.
  const { atlas } = await harness(page);
  expect(atlas.width).toBe(128);
  expect(atlas.height).toBe(64);

  // The LEFT face was rendered square on to the boxes; the right was turned away
  // from them. Two different pictures out of the same scene, in one texture.
  expect(atlas.leftCenter[1]!, "the left face saw the green box").toBeGreaterThan(200);
  expect(atlas.rightCenter[1]!, "and the right face was turned away from it").toBeLessThan(80);

  // **The second face did not wipe the first**, which is `clear: false` plus a
  // viewport doing what `RenderOptions.viewport` promises. A backend that ignored
  // either would leave the left face showing the background it cleared to.
  const green = atlas.leftGreen;
  expect(green, "the green box is still in the left face").not.toBeNull();

  // And the projection took the FACE's aspect, not the atlas's: the atlas is 2:1
  // and the face is square, so a face built from the atlas's aspect would stretch
  // this silhouette to twice as wide as it is tall.
  expect(Math.abs(green!.w - green!.h), `green was ${green!.w}x${green!.h}`).toBeLessThanOrEqual(1);
});
