import { expect, test, type Page } from "@playwright/test";

// `Material.glaze` on a real GPU, measured rather than looked at.
//
// **Why this exists when `src/render3d/__tests__/glaze.test.ts` already pins the
// two shader sources against each other.** Because a source comparison cannot
// see a term that is wrong the SAME way in both backends, and the claim a faked
// reflection makes is a claim about a DIRECTION: the coat brightens on the side
// of a surface that mirrors the key light towards the eye, and it changes sides
// when the camera goes round. Reverse the sign inside `reflect()` in both
// backends and every text assertion still passes, every screenshot still shows
// a shiny floor, and the glint sits on the wrong side of the world for ever.
// That is the billboard-drawn-a-half-turn-round fault: invisible to a test that
// reads extents, catchable only by measuring the direction.
//
// The harness is `samples/glaze/`, which draws one deterministic frame and
// exposes `window.__glaze.patch()` and `.digest()`. See its header for how the
// scene is arranged so that exactly one thing varies.
//
// **WebGL2 only, and that is a measurement rather than an omission.**
// `navigator.gpu` is absent from the headless Chromium Playwright drives here —
// checked with and without `--enable-unsafe-webgpu`, `requestAdapter` null both
// times — so there is no WebGPU frame on this machine to compare against. What
// keeps the two backends together is `glaze.test.ts`, which compares the ripple
// coefficient for coefficient; what THIS file adds is the half no text can
// reach.

test.use({ viewport: { width: 320, height: 320 }, deviceScaleFactor: 1 });

/** The patch every reading is taken over: the middle of the 256² frame, which
 *  is deck at every yaw the scene is arranged for. Neither an edge of the deck,
 *  nor the background, nor the control post is ever inside it. */
const PATCH = [96, 96, 64, 64] as const;

interface Frame {
  luma: number;
  digest: string;
}

async function frame(page: Page, yaw: number, strength: number): Promise<Frame> {
  const errors: string[] = [];
  const onError = (error: Error) => errors.push(error.message);
  page.on("pageerror", onError);
  await page.goto(`/glaze/?backend=webgl2&yaw=${yaw}&strength=${strength}`);
  await expect
    .poll(async () => page.evaluate(() => window.__glaze?.ready === true), { timeout: 5000 })
    .toBe(true);
  expect(await page.evaluate(() => window.__glaze?.backend)).toBe("webgl2");
  expect(errors).toEqual([]);
  page.off("pageerror", onError);
  return page.evaluate(
    ([x, y, w, h]) => ({
      luma: window.__glaze!.patch(x, y, w, h),
      digest: window.__glaze!.digest(),
    }),
    PATCH,
  );
}

/** One reading per yaw, in sequence. Deliberately not `Promise.all`: they share
 *  one page, and two concurrent navigations abort each other. */
async function sweep(page: Page, yaws: readonly number[], strength: number): Promise<Frame[]> {
  const out: Frame[] = [];
  for (const yaw of yaws) out.push(await frame(page, yaw, strength));
  return out;
}

test("the same parameters draw the same frame", async ({ page }) => {
  // Everything below is a difference between two frames, so a frame that was
  // not reproducible would make every one of them meaningless — including the
  // ones that passed.
  const a = await frame(page, 0, 1);
  const b = await frame(page, 0, 1);
  expect(a.digest).toBe(b.digest);
  expect(a.luma).toBe(b.luma);
});

test("the camera really turns, coat or no coat", async ({ page }) => {
  // The harness's own control, and the thing that stops the next test from
  // passing for the wrong reason. The deck is a flat square and is deliberately
  // identical at every yaw, so on the deck alone "the patch did not change"
  // would be indistinguishable from a camera that never moved. The post is what
  // tells those apart: unglazed, off to one side, and obliged to swap sides
  // whether or not there is a coat.
  const [flat0, flat180] = await sweep(page, [0, 180], 0);
  expect(flat0!.digest).not.toBe(flat180!.digest);
  const [lit0, lit180] = await sweep(page, [0, 180], 1);
  expect(lit0!.digest).not.toBe(lit180!.digest);
});

test("an unglazed deck does not change at all as the camera goes round", async ({ page }) => {
  // The frozen control. A flat square under a fixed directional light is the
  // same colour from everywhere, so with the coat off the patch reads ONE
  // number at every yaw.
  //
  // MEASURED, headless Chromium/WebGL2, the patch above: 21.830 at every one of
  // 0/45/90/135/180/225/270 — equal in every digit the readback carries, which
  // is why this is asserted as equality rather than as a tolerance. Any drift
  // here is the scene ceasing to be a controlled experiment, and it would show
  // up next door as a direction reading that was never about the coat.
  const flat = await sweep(page, [0, 45, 90, 135, 180, 225, 270], 0);
  // Guard the guard, and this one has already earned its place. An equality
  // over a sweep is satisfied perfectly by a frame that is entirely black, and
  // a black frame is exactly what a harness returns when the readback lands
  // outside a canvas — which happened here the moment a fourth URL parameter
  // was added, because an absent one read as 0 and shrank the canvas to 16
  // pixels square. Three of these four tests passed through it.
  expect(flat[0]!.luma).toBeGreaterThan(5);
  for (const f of flat) expect(f.luma).toBeCloseTo(flat[0]!.luma, 3);
});

test("the coat lays a ridge of light on the side that mirrors the key light", async ({ page }) => {
  // THE measurement, and the reason the harness exists.
  //
  // The key light comes out of the +Z sky and is held still while the camera
  // orbits. At yaw 0 the camera is on the +Z side: the ray bouncing off the
  // deck towards the eye points away from the light and picks up none of it. At
  // yaw 180 the camera is on the far side, the bounce points into the light,
  // and the deck lights up. In between, a ridge.
  //
  // MEASURED, same rig as above — patch luminance by yaw at strength 1:
  //
  //     0    45    90    135    180    225    270
  //   67.38 67.38 67.49 86.21 149.19 86.21 67.49
  //
  // against a flat 21.83 with the coat off. Three separate claims are asserted
  // from that, and a reversed `reflect()` breaks all three at once:
  //
  //   1. the peak is at 180 and not at 0;
  //   2. the ridge is symmetric about the light's axis, which is the only
  //      asymmetry the scene has;
  //   3. it falls away monotonically from the peak.
  const yaws = [0, 45, 90, 135, 180, 225, 270] as const;
  const lit = await sweep(page, yaws, 1);
  const at = new Map(yaws.map((yaw, i) => [yaw, lit[i]!.luma]));
  const luma = (yaw: number): number => at.get(yaw)!;

  // The coat adds light everywhere — a faked sky is still a sky, and the
  // gradient term does not need a grazing angle to show. So the claim is never
  // "dark head-on"; it is "much brighter on the far side".
  expect(luma(0)).toBeGreaterThan(30);

  // 1. The peak, and which side it is on. ~82 above the head-on reading.
  expect(luma(180) - luma(0)).toBeGreaterThan(40);
  for (const yaw of [0, 45, 90, 135, 225, 270]) {
    expect(luma(180), `yaw ${yaw}`).toBeGreaterThan(luma(yaw));
  }

  // 2. Symmetric about the light's axis. A ridge that leaned would mean the
  // bounce was being taken against something other than the surface normal.
  expect(luma(135)).toBeCloseTo(luma(225), 1);
  expect(luma(90)).toBeCloseTo(luma(270), 1);

  // 3. And it falls away rather than switching on at one angle.
  expect(luma(135)).toBeGreaterThan(luma(90) + 10);
  expect(luma(90)).toBeGreaterThanOrEqual(luma(0));
});

declare global {
  interface Window {
    __glaze?: {
      ready: boolean;
      backend: "webgl2" | "webgpu";
      patch(x: number, y: number, w: number, h: number): number;
      digest(): string;
    };
  }
}
