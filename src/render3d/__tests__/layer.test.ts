import { beforeEach, describe, expect, it, vi } from "vitest";
import { attachSceneLayer } from "../layer.js";
import type { App } from "@src/engine/app.js";
import type { Renderer3D } from "../renderer.js";

// The regression this file exists for: `attachSceneLayer` used to put the scene
// canvas at `z-index: -1`. That does NOT mean "one layer further back" — a
// negative z-index drops an element behind its stacking context's own
// BACKGROUND, so any page with `body { background }` (which is every sample, to
// stop the pre-script flash) paints straight over the 3D. The scene renders
// perfectly and is never seen, and switching backend changes nothing because
// both are equally hidden.

function fixture(css: Partial<CSSStyleDeclaration> = {}) {
  document.body.innerHTML = "";
  const target = document.createElement("canvas");
  target.id = "game";
  Object.assign(target.style, { position: "absolute", top: "0", left: "0" }, css);
  document.body.append(target);

  const layer = document.createElement("canvas");
  const resize = vi.fn();
  const renderer = { canvas: layer, resize } as unknown as Renderer3D;

  const handlers: (() => void)[] = [];
  const app = {
    canvas: target,
    viewport: { w: 800, h: 600, dpr: 2, canvas: target },
    onResize: (fn: () => void) => {
      handlers.push(fn);
      return () => handlers.splice(handlers.indexOf(fn), 1);
    },
  } as unknown as App;

  return { app, renderer, target, layer, resize, fire: () => handlers.forEach((h) => h()) };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("attachSceneLayer stacking", () => {
  it("never gives the scene a negative z-index", () => {
    const { app, renderer, layer } = fixture();
    attachSceneLayer(app, renderer);
    expect(Number(layer.style.zIndex)).toBeGreaterThanOrEqual(0);
  });

  it("puts the scene UNDER the app canvas by raising the app canvas", () => {
    const { app, renderer, target, layer } = fixture();
    attachSceneLayer(app, renderer);
    expect(Number(layer.style.zIndex)).toBeLessThan(Number(target.style.zIndex));
  });

  it("stacks above an explicitly z-indexed app canvas rather than under it", () => {
    const { app, renderer, target, layer } = fixture({ zIndex: "5" });
    attachSceneLayer(app, renderer);
    // Both must clear whatever the page put beneath at z 0..4.
    expect(Number(layer.style.zIndex)).toBeGreaterThanOrEqual(5);
    expect(Number(target.style.zIndex)).toBeGreaterThan(Number(layer.style.zIndex));
  });

  it("gives a statically positioned canvas a position, or z-index is ignored", () => {
    const { app, renderer, target } = fixture({ position: "static" });
    attachSceneLayer(app, renderer);
    expect(target.style.position).not.toBe("static");
  });

  it("inserts the scene canvas before the app canvas and stops it taking input", () => {
    const { app, renderer, target, layer } = fixture();
    attachSceneLayer(app, renderer);
    expect(layer.nextSibling).toBe(target);
    expect(layer.style.pointerEvents).toBe("none");
  });

  it("restores the app canvas on detach, so a backend switch does not ratchet", () => {
    const { app, renderer, target } = fixture();
    // A switch is detach + attach; three rounds must land where one did.
    const first = attachSceneLayer(app, renderer);
    const afterOne = target.style.zIndex;
    first.detach();
    expect(target.style.zIndex).toBe("");
    for (let i = 0; i < 3; i++) attachSceneLayer(app, renderer).detach();
    attachSceneLayer(app, renderer);
    expect(target.style.zIndex).toBe(afterOne);
  });
});

describe("attachSceneLayer sizing", () => {
  it("renders at the app's LOGICAL size, scaling only the backing store", () => {
    const { app, renderer, resize } = fixture();
    attachSceneLayer(app, renderer, { resolutionScale: 0.5 });
    // Logical 800×600 either way — the camera's aspect must not move with the
    // quality knob — with the device pixel ratio carrying the reduction.
    expect(resize).toHaveBeenLastCalledWith(800, 600, 1);
  });

  it("re-syncs when the scale changes and when the app resizes", () => {
    const { app, renderer, resize, fire } = fixture();
    const handle = attachSceneLayer(app, renderer);
    expect(resize).toHaveBeenLastCalledWith(800, 600, 2);
    handle.setResolutionScale(0.75);
    expect(handle.resolutionScale).toBe(0.75);
    expect(resize).toHaveBeenLastCalledWith(800, 600, 1.5);
    resize.mockClear();
    fire();
    expect(resize).toHaveBeenCalledWith(800, 600, 1.5);
  });

  it("clamps a nonsense scale rather than rendering a zero-pixel target", () => {
    const { app, renderer, resize } = fixture();
    const handle = attachSceneLayer(app, renderer);
    handle.setResolutionScale(0);
    expect(handle.resolutionScale).toBeGreaterThan(0);
    expect(resize.mock.lastCall![2]).toBeGreaterThan(0);
  });

  it("stops syncing once detached", () => {
    const { app, renderer, resize, fire, layer } = fixture();
    attachSceneLayer(app, renderer).detach();
    expect(layer.isConnected).toBe(false);
    resize.mockClear();
    fire();
    expect(resize).not.toHaveBeenCalled();
  });
});
