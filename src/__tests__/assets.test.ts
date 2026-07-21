import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAssets } from "../assets.js";

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

  it("loads and parses JSON via fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ level: 1 }) })),
    );
    const a = createAssets();
    await a.load({ map: "level1.json" });
    expect(a.json<{ level: number }>("map")).toEqual({ level: 1 });
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
      hero: { src: "hero.png", sheet: { fw: 32, fh: 32, fps: 8 } },
      terrain: "terrain.png",
      map: "level.json",
    });
    // sheet spec → an Animation (has update() + a source rect)
    expect(typeof (res.hero as { update: unknown }).update).toBe("function");
    expect((res.hero as { rect: { sw: number } }).rect.sw).toBe(32);
    // plain URL → the image; .json → parsed data
    expect(res.terrain).toBeInstanceOf(HTMLImageElement);
    expect(res.map).toEqual({ level: 3 });
  });

  it("still caches the raw image for a composed spec", async () => {
    const a = createAssets();
    await a.load({ hero: { src: "hero.png", sheet: { fw: 16, fh: 16 } } });
    // the by-name cache holds the raw image, not the Animation
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
