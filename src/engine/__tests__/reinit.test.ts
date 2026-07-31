// App lifecycle reinitialization tests.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "@src/engine/index.js";

let rafCallback: ((time: number) => void) | null = null;
const originalGetContext = HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = function (type: string) {
    if (type !== "2d") return originalGetContext.call(this, type);
    return {
      setTransform: vi.fn(),
      fillRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      canvas: this,
    } as unknown as CanvasRenderingContext2D;
  };
  rafCallback = null;
  vi.stubGlobal("requestAnimationFrame", (callback: (time: number) => void) => {
    rafCallback = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});

function tick(time: number): void {
  const callback = rafCallback;
  rafCallback = null;
  callback?.(time);
}

describe("explicit game lifecycles", () => {
  it("keeps clocks and handlers isolated between games", () => {
    const a = createApp(document.createElement("canvas"));
    const b = createApp(document.createElement("canvas"));
    expect(a.Clock.world).not.toBe(b.Clock.world);
    expect(a.Draw.ctx).not.toBe(b.Draw.ctx);
    expect(a.Keys).not.toBe(b.Keys);
  });

  it("destroy drops every handler set, including frame handlers", () => {
    const game = createApp(document.createElement("canvas"));
    let steps = 0;
    let frames = 0;
    let stepStarts = 0;
    game.Loop.onStep(() => steps++);
    game.Loop.onStepStart(() => stepStarts++);
    game.Loop.onFrame(() => frames++);
    game.Loop.run({ update() {}, draw() {} });
    tick(16);
    tick(400);
    expect(steps).toBeGreaterThan(0);
    expect(stepStarts).toBeGreaterThan(0);
    expect(frames).toBeGreaterThan(0);

    game.destroy();
    const after = { steps, frames, stepStarts };
    tick(800);
    expect({ steps, frames, stepStarts }).toEqual(after);
  });
});
