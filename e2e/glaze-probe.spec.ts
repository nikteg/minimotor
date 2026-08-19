import { expect, test, type Page } from "@playwright/test";

// `Glaze.environment` on a real GPU: a cube probe captured by `cubeProbeViews` and
// read back by the shader's `glazeEnvUv`.
//
// **Why a browser, and why six colours.** A cube probe is ONE convention split
// across two places — the six cameras that write the atlas and the lookup that
// reads it — and a mismatch in either half looks exactly like a bug in the other.
// Nothing about it is visible in a screenshot: a reflection with two faces swapped
// is still a plausible reflection, and a reflection that ignored the probe
// entirely is the faked gradient, which is a perfectly nice grey. So the harness
// puts a different flat colour on each of the room's six sides and asks a question
// with one right answer per direction. Both faults were REAL and both were found
// here: the atlas's rows arrive flipped relative to a GL sampler, and one of these
// cameras had its yaw's sign wrong.
//
// **WebGL2 only**, the same measurement `glaze.spec.ts` and `render-target.spec.ts`
// record: the headless Chromium Playwright drives here has no `navigator.gpu`.
// `render-target.test.ts` holds the WebGPU path to the same shape as text,
// including the row flip that is deliberately NOT in it.

test.use({ viewport: { width: 320, height: 320 }, deviceScaleFactor: 1 });

type Harness = NonNullable<Window["__glazeProbe"]>;

async function harness(page: Page): Promise<Harness> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/glaze-probe/?backend=webgl2");
  await expect
    .poll(async () => page.evaluate(() => window.__glazeProbe?.ready === true), { timeout: 5000 })
    .toBe(true);
  expect(errors, "the harness ran clean").toEqual([]);
  return page.evaluate(() => window.__glazeProbe!);
}

/** Colours as SHAPES rather than bytes, the way `render-target.spec.ts` reads its
 *  background: the glaze adds a white light lobe on top of the probe — with no
 *  lights in the scene its direction defaults to straight up, so a floor
 *  reflecting the ceiling gets one — and the tone curve moves absolute values
 *  around. Which channels lead is what says which wall was sampled. */
function leads(pixel: number[], channels: ("r" | "g" | "b")[]): void {
  const at = { r: pixel[0]!, g: pixel[1]!, b: pixel[2]! };
  const lead = channels.map((c) => at[c]);
  const rest = (["r", "g", "b"] as const).filter((c) => !channels.includes(c)).map((c) => at[c]);
  const lowest = Math.min(...lead);
  const highest = rest.length > 0 ? Math.max(...rest) : 0;
  expect(lowest, `${channels.join("+")} should lead ${JSON.stringify(pixel)}`).toBeGreaterThan(80);
  expect(highest, `and the rest trail ${JSON.stringify(pixel)}`).toBeLessThan(lowest * 0.75);
  // Two leading channels must agree, or "cyan" is really "a bit of green".
  if (lead.length === 2) expect(Math.abs(lead[0]! - lead[1]!)).toBeLessThan(24);
}

test("the probe's six faces land in the atlas in the documented order", async ({ page }) => {
  // The CAPTURE side on its own, with no shader in it: the middle of each of the
  // six rectangles `cubeProbeViews` filled, against the wall that face looks at.
  // A wrong face order, a wrong yaw, or a face rendered into the wrong rectangle
  // all show up here rather than as a strange reflection three tests later.
  const { atlas, cells } = await harness(page);
  expect(atlas.width).toBe(144);
  expect(atlas.height).toBe(96);
  expect(atlas.bytes).toBe(144 * 96 * 4);

  leads(cells[0]!, ["r"]); // +X red
  leads(cells[1]!, ["r", "g"]); // -X yellow
  leads(cells[2]!, ["g", "b"]); // +Y cyan
  leads(cells[3]!, ["g"]); // -Y green
  leads(cells[4]!, ["b"]); // +Z blue
  leads(cells[5]!, ["r", "b"]); // -Z magenta
});

test("a glazed floor reflects the wall the ray actually points at", async ({ page }) => {
  // The two halves agreeing, which is the whole point of the feature. Four
  // directions and four different walls: one reading cannot tell a correct lookup
  // from one stuck on a single face, and each axis is a separate mistake to make.
  const { floor } = await harness(page);

  // Low over the floor looking along -Z. The reflected ray carries on in the
  // direction of view and tilts upward, so it leaves towards -Z: MAGENTA, and the
  // whole column agrees because every point on a flat floor reflects that way.
  for (const pixel of floor.column) leads(pixel, ["r", "b"]);

  // **The reading that caught the row flip.** Nearly straight down, so the ray
  // goes nearly straight up at the CYAN ceiling. Before the flip this came back
  // cyan's neighbour in the atlas — the row below it — which is what the two rows
  // being swapped looks like from here.
  leads(floor.steep, ["g", "b"]);

  // Both signs of one axis, because a mirrored axis passes any test that only
  // looks one way down it.
  leads(floor.sideways, ["r", "g"]); // towards -X, YELLOW
  leads(floor.sidewaysBack, ["r"]); // towards +X, RED
});

test("the faked gradient is what a floor with no probe still gets", async ({ page }) => {
  // The control, and the reason none of the six walls is white or grey: the term
  // the probe REPLACES is the tint times a scalar, so with a white tint it is
  // grey. Without this, "the probe was read" and "the probe was ignored" would be
  // the same reading on a floor reflecting a white ceiling — which is exactly what
  // the first version of this harness measured, and it passed.
  const { gradient } = await harness(page);
  const [r, g, b] = gradient;
  expect(r!, "grey: no channel leads").toBeGreaterThan(40);
  expect(Math.abs(r! - g!)).toBeLessThan(12);
  expect(Math.abs(g! - b!)).toBeLessThan(12);
});
