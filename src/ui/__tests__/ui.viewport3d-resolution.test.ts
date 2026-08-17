import { afterEach, describe, expect, it, vi } from "vitest";
import { createCamera } from "@src/render3d/camera.js";
import { createScene } from "@src/render3d/scene.js";
import { _reset, layoutCapture } from "@src/ui/api.js";
import { selectUiApp } from "@src/ui/core/state.js";
import { viewport3d } from "@src/ui/widgets/viewport3d.js";
import type { Renderer3D } from "@src/render3d/renderer.js";
import { createTestUiApp } from "./app-fixture.js";

function fixture() {
  const ctx = {
    canvas: { width: 320, height: 240 },
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  const app = createTestUiApp(ctx);
  selectUiApp(app);
  const resize = vi.fn();
  const renderer = {
    canvas: document.createElement("canvas"),
    renderWidth: 80,
    renderHeight: 40,
    resize,
    render: vi.fn(),
  } as unknown as Renderer3D;
  return { resize, renderer };
}

afterEach(() => {
  _reset();
});

describe("viewport3d resolution scale", () => {
  it("scales the backing store without changing the logical rect", () => {
    const { resize, renderer } = fixture();
    const scene = createScene();
    const camera = createCamera();

    layoutCapture(true);
    const half = viewport3d({
      id: "half",
      x: 10,
      y: 20,
      w: 80,
      h: 40,
      renderer,
      scene,
      camera,
      resolutionScale: 0.5,
    });
    const full = viewport3d({
      id: "full",
      x: 10,
      y: 20,
      w: 80,
      h: 40,
      renderer,
      scene,
      camera,
      resolutionScale: 1,
    });

    expect(half.rect).toEqual(full.rect);
    expect(resize).toHaveBeenNthCalledWith(1, 80, 40, 0.5, { retainBackingStore: true });
    expect(resize).toHaveBeenNthCalledWith(2, 80, 40, 1, { retainBackingStore: true });
  });

  it("does not allow a preview scale below the renderer floor", () => {
    const { resize, renderer } = fixture();
    layoutCapture(true);
    viewport3d({
      id: "clamped",
      x: 0,
      y: 0,
      w: 80,
      h: 40,
      renderer,
      scene: createScene(),
      camera: createCamera(),
      resolutionScale: 0,
    });

    expect(resize).toHaveBeenCalledWith(80, 40, 0.1, { retainBackingStore: true });
  });
});
