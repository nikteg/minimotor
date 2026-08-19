import { expect, test, type Page } from "@playwright/test";

// `Glaze.screen` on a real GPU: a surface reflecting what stands in front of it
// out of `Renderer3D.captureFrame`'s copy of the last frame.
//
// **Why a browser, and why two scenes.** The feature is two conventions meeting —
// which way a reflected ray runs across the screen, and which way up the snapshot
// is stored — and both failures look like something else. A mirrored x is still a
// plausible reflection; a flipped v taps somewhere else in the frame and reads as
// a duller one. The harness builds a scene per convention so that its own wrong
// answer lands on a different COLOUR, and the layout of each is measured rather
// than reasoned about: an earlier version passed under both mutations, because a
// floor's reflected ray is nearly vertical on screen and its two pillars were tall
// enough that a flipped tap hit the same one.
//
// **WebGL2 only**, the same measurement the other GPU specs record: the headless
// Chromium Playwright drives here has no `navigator.gpu`. The WebGPU path samples
// a copy of the CANVAS rather than a render target and therefore flips v where
// this one does not; `glaze.test.ts` holds that asymmetry as text.

test.use({ viewport: { width: 320, height: 320 }, deviceScaleFactor: 1 });

type Harness = NonNullable<Window["__glazeScreen"]>;

async function harness(page: Page): Promise<Harness> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/glaze-screen/?backend=webgl2");
  await expect
    .poll(async () => page.evaluate(() => window.__glazeScreen?.ready === true), { timeout: 5000 })
    .toBe(true);
  expect(errors, "the harness ran clean").toEqual([]);
  return page.evaluate(() => window.__glazeScreen!);
}

/** Whether a reading is grey: no channel leading the others.
 *
 *  This is what the faked gradient looks like, and it is the reason nothing in
 *  either scene is grey — see the harness. */
function grey(pixel: number[]): boolean {
  const [r, g, b] = [pixel[0]!, pixel[1]!, pixel[2]!];
  const span = Math.max(r, g, b) - Math.min(r, g, b);
  return span < 18;
}

/** Which channel pair leads, or null for grey. Magenta is r+b and green is g, so
 *  one name per panel and no third answer. */
function lead(pixel: number[]): "magenta" | "green" | null {
  if (grey(pixel)) return null;
  const [r, g, b] = [pixel[0]!, pixel[1]!, pixel[2]!];
  if (g > r && g > b) return "green";
  if (r > g && b > g) return "magenta";
  return null;
}

test("a glazed floor reflects the pillar standing on THAT side of it", async ({ page }) => {
  // The claim the whole feature exists for, and the one a cube probe of a room
  // cannot make: a thing appears in the surface under itself.
  const { cells } = await harness(page);
  expect(cells.length).toBeGreaterThan(20);

  // A cell counts only where the CONTROL is grey. That is what says the pixel is
  // floor rather than pillar — a pillar reads its own colour in both frames — so
  // nothing here has to predict where a silhouette ends on screen.
  const floorCells = cells.filter((cell) => grey(cell.without));
  expect(floorCells.length, "the whole grid is floor in the control").toBe(cells.length);

  // **Every column under a pillar answers that pillar's colour**, and the two
  // middle columns — which have only more floor above them — answer neither. The
  // reach is measured to land inside the pillars' band; a tap that fell short
  // would leave all 24 cells grey, and one that overshot would land in the blue
  // sky above them. Both of those were real states of this harness.
  const coloured = floorCells.filter((cell) => lead(cell.with) !== null);
  expect(coloured.length, "the floor picked the pillars up").toBeGreaterThan(15);
  for (const cell of coloured) {
    const side = cell.x < 0.5 ? "magenta" : "green";
    expect(lead(cell.with), `at (${cell.x}, ${cell.y})`).toBe(side);
  }
  // And BLUE is nowhere on the floor. That is the reading that catches a flipped
  // v: the tap then starts in the mirrored half of the frame and lands in the
  // sky, which is a plausible-looking reflection and the wrong one.
  for (const cell of cells) {
    const [r, g, b] = [cell.with[0]!, cell.with[1]!, cell.with[2]!];
    expect(b < 200 || r > 100, `blue sky at (${cell.x}, ${cell.y})`).toBe(true);
    expect(g, "and nothing bright that is neither pillar nor floor").toBeLessThanOrEqual(
      cell.x > 0.5 ? 255 : 120,
    );
  }
});

test("a glazed WALL reflects sideways, in the direction the ray runs", async ({ page }) => {
  // The lateral convention, which the floor cannot measure: a reflected ray off a
  // flat floor is nearly vertical on screen, so mirroring its x moves the tap by
  // a couple of pixels and changes no reading. This wall's ray is nearly all
  // lateral. A mirror keeps a lateral direction and flips only the one it faces
  // along, so the wall's left half must answer the panel on its LEFT.
  const { wall } = await harness(page);
  expect(wall.length).toBe(6);
  for (const point of wall) {
    // The control says the pixel is the wall's own dark face rather than a panel.
    expect(grey(point.without), `wall at (${point.x}, ${point.y})`).toBe(true);
    expect(point.without[0]!, "and dark, not the gradient").toBeLessThan(80);
    expect(lead(point.with), `at (${point.x}, ${point.y})`).toBe(
      point.x < 0.5 ? "magenta" : "green",
    );
  }
});

test("a tap that walks off the frame falls back to the probe's half", async ({ page }) => {
  // The other half of the blend, which fails independently of the direction: a
  // reach of four screen widths cannot land anywhere in the picture, so every
  // cell has to return to the gradient it would have had with no snapshot at
  // all. Without this fade the horizon of any iced surface goes black.
  const { cells, farReach } = await harness(page);
  const strays = farReach.filter((pixel, at) => grey(cells[at]!.without) && !grey(pixel));
  expect(strays.length, `off-frame taps stayed off: ${JSON.stringify(strays.slice(0, 3))}`).toBe(0);
});

test("screenStrength decides how much of the reflection shows", async ({ page }) => {
  // The one number the feature exposes to a player, and it has to move the
  // picture. It is asserted at the SAME pixels at two strengths rather than
  // against an absolute, because the coat also carries a Fresnel that varies down
  // the frame — a threshold would be measuring the camera as much as the setting.
  //
  // The failure this catches is real and was in the first draft: the shader took
  // the larger of this weight and the faked sky's own 0.25 head-on floor, so every
  // strength below a quarter was indistinguishable from a quarter.
  const { cells, dim } = await harness(page);
  const bright = cells.map((cell) => cell.with);
  let compared = 0;
  for (const [at, full] of bright.entries()) {
    if (lead(full) === null) continue;
    compared++;
    const strongest = Math.max(full[0]!, full[1]!, full[2]!);
    const dimmest = Math.max(dim[at]![0]!, dim[at]![1]!, dim[at]![2]!);
    expect(dimmest, `cell ${at} dimmed`).toBeLessThan(strongest * 0.75);
    // And the colour survives: a strength turns the reflection down, it does not
    // replace it with the faked sky.
    expect(lead(dim[at]!), `cell ${at} kept its hue`).toBe(lead(full));
  }
  expect(compared, "there were reflections to compare").toBeGreaterThan(15);
});

test("the snapshot is the whole canvas, at the canvas's size", async ({ page }) => {
  // The primitive under the feature, and the reason the reflection is one copy
  // rather than a second render of the world. A snapshot at any other size is a
  // resolve that scaled, which a multisampled read buffer cannot do — see
  // captureFrame.
  const { snapshot, backend } = await harness(page);
  expect(backend).toBe("webgl2");
  expect(snapshot).toEqual({ width: 128, height: 128 });
});
