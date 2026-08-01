import { describe, expect, it, vi } from "vitest";
import {
  createTilesetSkin,
  createTilesetSkinFromManifest,
  inspectTilesetSkin,
  setTheme,
  _reset,
} from "../api.js";
import { drawBox, drawNineSlice } from "../core/theme.js";

function mockContext() {
  const images: unknown[][] = [];
  const ctx = {
    imageSmoothingEnabled: true,
    drawImage: (...args: unknown[]) => images.push(args),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    rect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    arcTo: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, images };
}

const image = { width: 48, height: 48 } as unknown as CanvasImageSource;
const frame = {
  sx: 0,
  sy: 0,
  sw: 16,
  sh: 16,
  insets: { left: 4, top: 4, right: 4, bottom: 4 },
};

describe("tileset UI skins", () => {
  it("validates and freezes a typed skin manifest", () => {
    const skin = createTilesetSkin(image, {
      tileSize: { w: 4, h: 4 },
      frames: { panel: frame },
    });

    expect(skin.tileSize).toEqual({ w: 4, h: 4 });
    expect(skin.frames.panel).toEqual(frame);
    expect(Object.isFrozen(skin)).toBe(true);
    expect(Object.isFrozen(skin.frames)).toBe(true);
  });

  it("allows each frame to use its own source image", () => {
    const buttonImage = { width: 96, height: 22 } as unknown as CanvasImageSource;
    const button = {
      image: buttonImage,
      sx: 0,
      sy: 0,
      sw: 96,
      sh: 22,
      insets: { left: 8, top: 4, right: 8, bottom: 4 },
    };
    const skin = createTilesetSkin(image, {
      tileSize: { w: 16, h: 16 },
      frames: { button },
    });
    expect(skin.frames.button?.image).toBe(buttonImage);
  });

  it("rejects regions outside the source image and invalid insets", () => {
    expect(() =>
      createTilesetSkin(image, {
        tileSize: { w: 4, h: 4 },
        frames: { panel: { ...frame, sx: 40 } },
      }),
    ).toThrow(/outside its image/);

    expect(() =>
      createTilesetSkin(image, {
        tileSize: { w: 4, h: 4 },
        frames: { panel: { ...frame, insets: { left: 8, top: 4, right: 8, bottom: 4 } } },
      }),
    ).toThrow(/leave a positive center/);
  });

  it("tiles nine-slice edges and center at native scale", () => {
    const { ctx, images } = mockContext();
    drawNineSlice(ctx, image, frame, 10, 20, 23, 19);

    expect(images.length).toBeGreaterThan(4);
    for (const args of images) {
      const [, , , , , , , dw, dh] = args;
      expect(dw).toBeGreaterThan(0);
      expect(dh).toBeGreaterThan(0);
      expect(dw).toBeLessThanOrEqual(8);
      expect(dh).toBeLessThanOrEqual(8);
    }
    expect(ctx.imageSmoothingEnabled).toBe(true);
  });

  it("uses the role-specific frame and falls back after skin removal", () => {
    const skin = createTilesetSkin(image, {
      tileSize: { w: 4, h: 4 },
      frames: {
        button: frame,
        buttonHover: { ...frame, sx: 16 },
      },
    });
    const themed = mockContext();
    setTheme({ skin });
    drawBox(themed.ctx, 0, 0, 24, 20, { role: "button", state: "hover", fill: "#000" });
    expect(themed.images.length).toBeGreaterThan(0);
    expect(themed.images[0][1]).toBe(16);

    const fallback = mockContext();
    setTheme({});
    drawBox(fallback.ctx, 0, 0, 24, 20, { fill: "#000" });
    expect(fallback.images).toEqual([]);
    _reset();
  });

  it("uses optional semantic button frames without borrowing the default frame", () => {
    const skin = createTilesetSkin(image, {
      tileSize: { w: 4, h: 4 },
      frames: { button: frame },
      buttonVariants: { primary: { default: { ...frame, sx: 16 } } },
    });
    const primary = mockContext();
    setTheme({ skin });
    drawBox(primary.ctx, 0, 0, 24, 20, {
      role: "button",
      variant: "primary",
      fill: "#000",
    });
    expect(primary.images[0][1]).toBe(16);

    const danger = mockContext();
    drawBox(danger.ctx, 0, 0, 24, 20, {
      role: "button",
      variant: "danger",
      fill: "#000",
    });
    expect(danger.images).toEqual([]);
    _reset();
  });

  it("supports panel, title, bar, and tab roles", () => {
    const skin = createTilesetSkin(image, {
      tileSize: { w: 4, h: 4 },
      frames: {
        panel: frame,
        panelTitle: { ...frame, sx: 32 },
        tab: { ...frame, sx: 16 },
        tabActive: { ...frame, sx: 32 },
        barTrack: { ...frame, sx: 0, sy: 16 },
        barFill: { ...frame, sx: 16, sy: 16 },
      },
    });
    const panel = mockContext();
    setTheme({ skin });
    drawBox(panel.ctx, 0, 0, 24, 20, { role: "panel" });
    expect(panel.images[0][1]).toBe(0);

    const tab = mockContext();
    drawBox(tab.ctx, 0, 0, 24, 20, { role: "tab", state: "active" });
    expect(tab.images[0][1]).toBe(32);

    const bar = mockContext();
    drawBox(bar.ctx, 0, 0, 24, 8, { role: "barFill" });
    expect(bar.images[0][1]).toBe(16);
    _reset();
  });

  it("builds a JSON-friendly manifest and extracts automatic atlas debug entries", () => {
    const skin = createTilesetSkinFromManifest(image, {
      tileSize: { w: 4, h: 4 },
      frames: {
        panel: { x: 0, y: 0, w: 12, h: 12, insets: { left: 4, top: 4, right: 4, bottom: 4 } },
      },
      sprites: { icons: { selectArrow: { x: 16, y: 0, w: 4, h: 4 } } },
    });
    expect(skin.frames.panel?.sx).toBe(0);
    const debug = inspectTilesetSkin(skin);
    expect(debug.entries.map((entry) => entry.label)).toEqual([
      "frame.panel",
      "sprite.selectArrow",
    ]);
    expect(debug.entries[0].split).toEqual({ cols: 3, rows: 3 });
    expect(debug.entries[0].mapping).toBe("nine-slice");
    expect(debug.entries[0].insets).toEqual({ left: 4, top: 4, right: 4, bottom: 4 });
    expect(debug.entries[1].split).toBeUndefined();
    expect(debug.entries[1].mapping).toBe("sprite");
  });
});
