// Module-local asset store tests.
import { describe, it, expect, expectTypeOf, vi, beforeEach, afterEach } from "vitest";
import { createAssetStore as createAssets } from "@src/assets/index.js";
import { createClockHandle } from "@src/clock/index.js";

// Wrap real jsdom images so `instanceof HTMLImageElement` still holds, but make
// setting `src` resolve (or reject) the load asynchronously.
const RealImage = globalThis.Image;
function stubImages(mode: "ok" | "fail") {
  vi.stubGlobal("Image", function () {
    const img = new RealImage();
    Object.defineProperty(img, "src", {
      configurable: true,
      set() {
        queueMicrotask(() => img.dispatchEvent(new Event(mode === "ok" ? "load" : "error")));
      },
    });
    return img;
  } as unknown as typeof Image);
}

beforeEach(() => stubImages("ok"));
afterEach(() => vi.unstubAllGlobals());

describe("Assets", () => {
  it("loads images and serves them by name", async () => {
    const a = createAssets();
    await a.load({ hero: "hero.png", tiles: "tiles.webp" });
    expect(a.has("hero")).toBe(true);
    expect(a.image("hero")).toBeInstanceOf(HTMLImageElement);
    expect(a.get("tiles")).toBeInstanceOf(HTMLImageElement);
  });

  it("routes data: URIs by MIME type (bundlers inline small assets)", async () => {
    // A `new URL("./x.png", import.meta.url)` can resolve to a `data:image/…`
    // URI once the bundler inlines it — no `.png` extension to route on. It must
    // still load as an image (this broke ascent/pixel-adventure once BUILT while
    // working under `vite` dev, where the URL kept its extension).
    const a = createAssets();
    await a.load({ hero: "data:image/png;base64,iVBORw0KGgo=" });
    expect(a.has("hero")).toBe(true);
    expect(a.image("hero")).toBeInstanceOf(HTMLImageElement);
  });

  it("loads and parses JSON via fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ level: 1 }) })),
    );
    const a = createAssets();
    await a.load({ map: "level1.json" });
    expect(a.json<{ level: number }>("map")).toEqual({ level: 1 });
  });

  it("recognizes Tiled and LDtk JSON extensions", async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetch);
    const a = createAssets();
    await a.load({ map: "level.tmj", tiles: "terrain.tsj", project: "world.ldtk" });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("reports progress as each asset resolves", async () => {
    const a = createAssets();
    const seen: Array<[number, number]> = [];
    await a.load({ one: "a.png", two: "b.png", three: "c.png" }, (l, t) => seen.push([l, t]));
    expect(seen).toHaveLength(3);
    expect(seen.at(-1)).toEqual([3, 3]);
    // total is constant; loaded is monotonic
    expect(seen.map(([l]) => l).sort()).toEqual([1, 2, 3]);
  });

  it("get/image/json throw for a missing asset", () => {
    const a = createAssets();
    expect(() => a.get("nope")).toThrow(/not loaded/);
    expect(() => a.image("nope")).toThrow(/not loaded/);
  });

  it("image() rejects a non-image asset", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => [1, 2, 3] })),
    );
    const a = createAssets();
    await a.load({ data: "x.json" });
    expect(() => a.image("data")).toThrow(/not an image/);
  });

  it("rejects unknown extensions", async () => {
    const a = createAssets();
    await expect(a.load({ weird: "file.xyz" })).rejects.toThrow(/unknown asset type/);
  });

  it("propagates image load failures", async () => {
    stubImages("fail");
    const a = createAssets();
    await expect(a.load({ broken: "nope.png" })).rejects.toThrow(/failed to load image/);
  });

  it("propagates a non-ok JSON response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
    );
    const a = createAssets();
    await expect(a.load({ map: "missing.json" })).rejects.toThrow(/404/);
  });

  it("clear empties the cache", async () => {
    const a = createAssets();
    await a.load({ hero: "hero.png" });
    a.clear();
    expect(a.has("hero")).toBe(false);
  });

  it("returns composed resources keyed by manifest key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ level: 3 }) })),
    );
    const a = createAssets();
    const res = await a.load({
      hero: {
        src: "hero.png",
        sheet: { frame: { w: 32, h: 32 }, states: { idle: { row: 0, frames: 4 } } },
      },
      terrain: "terrain.png",
      map: "level.json",
    });
    // sheet spec → a named-state Sheet (typed per-key: no casts needed)
    expect(typeof res.hero.play).toBe("function");
    expect(res.hero.rect("idle", 0).sw).toBe(32);
    // plain URL → the image; .json → parsed data
    expect(res.terrain).toBeInstanceOf(HTMLImageElement);
    expect(res.map).toEqual({ level: 3 });
  });

  it("loads an Aseprite image and JSON as a typed animation sheet", async () => {
    const data = {
      frames: [{ frame: { x: 0, y: 0, w: 16, h: 16 }, duration: 100 }],
      meta: { frameTags: [{ name: "idle", from: 0, to: 0 }] },
    } as const;
    const a = createAssets();
    const result = await a.load({
      hero: {
        src: "hero.png",
        aseprite: data,
      },
    });
    expectTypeOf(result.hero.play).parameter(0).toEqualTypeOf<"idle">();
    expect(result.hero.play("idle", { clock: createClockHandle(1000 / 60) }).rect).toEqual({
      sx: 0,
      sy: 0,
      sw: 16,
      sh: 16,
    });
    expect(a.image("hero")).toBeInstanceOf(HTMLImageElement);
  });

  it("fetches an external Aseprite JSON atlas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          frames: [{ frame: { x: 0, y: 0, w: 8, h: 8 }, duration: 80 }],
          meta: { frameTags: [{ name: "spin", from: 0, to: 0 }] },
        }),
      })),
    );
    const a = createAssets();
    const result = await a.load({
      gem: { src: "gem.png", aseprite: "gem.json" },
    });
    expect(result.gem.states).toEqual(["spin"]);
  });

  it("still caches the raw image for a composed spec", async () => {
    const a = createAssets();
    await a.load({
      hero: {
        src: "hero.png",
        sheet: { frame: { w: 16, h: 16 }, states: { idle: { row: 0, frames: 1 } } },
      },
    });
    // the by-name cache holds the raw image, not the Sheet
    expect(a.image("hero")).toBeInstanceOf(HTMLImageElement);
  });

  it("exposes live progress and loading state", async () => {
    const a = createAssets();
    expect(a.loading).toBe(false);
    expect(a.progress).toBe(1);
    const p = a.load({ one: "a.png", two: "b.png" });
    expect(a.loading).toBe(true); // pending set synchronously, before the awaits
    await p;
    expect(a.loading).toBe(false);
    expect(a.progress).toBe(1);
  });

  it("clears loading state even when a load fails", async () => {
    stubImages("fail");
    const a = createAssets();
    await expect(a.load({ broken: "nope.png" })).rejects.toThrow();
    expect(a.loading).toBe(false); // counters reset on settle, not just success
    expect(a.progress).toBe(1);
  });
});
