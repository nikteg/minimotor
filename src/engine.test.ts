import { describe, it, expect, beforeEach, vi } from "vitest";
import { Engine, rectsOverlap } from "./engine.js";

// jsdom canvas support
const origGc = HTMLCanvasElement.prototype.getContext;
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = function (type: string) {
    if (type !== "2d") return origGc.call(this, type);
    return { setTransform: vi.fn(), canvas: this } as unknown as CanvasRenderingContext2D;
  };
  vi.stubGlobal("requestAnimationFrame", vi.fn());
  Engine.canvas = null;
  Engine.ctx = null;
  Engine.viewport = null;
  Engine.onUpdate = null;
  Engine.onDraw = null;
  Engine.onKeyDown = undefined;
  Engine.onResize = undefined;
  Engine.lastTime = 0;
  Engine.accumulator = 0;
  Engine.paused = false;
  Engine.frameScale = 1;

  // Restore matchMedia for tests that need it
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
});

describe("Engine", () => {
  describe("rectsOverlap", () => {
    it("overlapping", () => expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true));
    it("edge x", () => expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(false));
    it("edge y", () => expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 10, w: 10, h: 10 })).toBe(false));
    it("separated", () => expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 })).toBe(false));
    it("contained", () => expect(rectsOverlap({ x: 0, y: 0, w: 100, h: 100 }, { x: 25, y: 25, w: 10, h: 10 })).toBe(true));
  });

  describe("init", () => {
    it("binds canvas and ctx", () => {
      const c = document.createElement("canvas");
      Engine.init(c);
      expect(Engine.canvas).toBe(c);
      expect(Engine.ctx).toBeDefined();
    });
  });

  describe("start", () => {
    it("registers callbacks and requests frame", () => {
      Engine.init(document.createElement("canvas"));
      const u = () => {}, d = () => {};
      Engine.start(u, d);
      expect(Engine.onUpdate).toBe(u);
      expect(Engine.onDraw).toBe(d);
    });
  });

  describe("loop", () => {
    it("draws when paused, no update", () => {
      const d = vi.fn(), u = vi.fn();
      Engine.onDraw = d; Engine.onUpdate = u;
      Engine.loop(16);
      Engine.paused = true;
      Engine.loop(32);
      expect(d).toHaveBeenCalledTimes(2);
      expect(u).not.toHaveBeenCalled();
      expect(Engine.frameScale).toBe(0);
    });

    it("caps elapsed at 250ms", () => {
      Engine.onDraw = vi.fn(); Engine.onUpdate = vi.fn();
      Engine.loop(16);
      Engine.loop(1016);
      expect(Engine.onUpdate).toHaveBeenCalledTimes(15);
    });

    it("< one step runs draw only", () => {
      Engine.onDraw = vi.fn(); Engine.onUpdate = vi.fn();
      Engine.loop(16);
      Engine.loop(26);
      expect(Engine.onDraw).toHaveBeenCalledTimes(2);
      expect(Engine.onUpdate).not.toHaveBeenCalled();
      expect(Engine.accumulator).toBe(10);
    });

    it("accumulates across frames", () => {
      Engine.onDraw = vi.fn(); Engine.onUpdate = vi.fn();
      Engine.loop(16);
      Engine.loop(26);
      expect(Engine.accumulator).toBe(10);
      Engine.onUpdate.mockClear();
      Engine.loop(40); // 14ms more = 24 accumulated → 1 step, ~7 remainder
      expect(Engine.onUpdate).toHaveBeenCalledTimes(1);
    });

    it("multiple steps in one frame", () => {
      Engine.onDraw = vi.fn(); Engine.onUpdate = vi.fn();
      Engine.loop(16);
      Engine.loop(66); // 50ms → 2 steps with remainder
      expect(Engine.onUpdate).toHaveBeenCalledTimes(2);
    });
  });

  describe("onKeyDown", () => {
    it("prevents default on space and calls handler", () => {
      Engine.init(document.createElement("canvas"));
      const handler = vi.fn();
      Engine.onKeyDown = handler;
      const e = new KeyboardEvent("keydown", { code: "Space", cancelable: true });
      window.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
      expect(handler).toHaveBeenCalledWith("Space");
    });

    it("calls handler for other keys", () => {
      Engine.init(document.createElement("canvas"));
      const handler = vi.fn();
      Engine.onKeyDown = handler;
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA" }));
      expect(handler).toHaveBeenCalledWith("KeyA");
    });
  });

  describe("pauseOnPortrait", () => {
    it("pauses when matchMedia matches", () => {
      const apply = vi.fn();
      // override: when matchMedia is called, capture the listener
      vi.stubGlobal("matchMedia", vi.fn(() => {
        return {
          get matches() { return true; },
          addEventListener: (_: string, fn: () => void) => { apply.mockImplementation(fn); },
        };
      }));
      Engine.pauseOnPortrait();
      // The initial state check should see matches=true
      expect(Engine.paused).toBe(true);
    });

    it("does not pause when matchMedia does not match", () => {
      vi.stubGlobal("matchMedia", vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
      })));
      Engine.paused = false;
      Engine.pauseOnPortrait();
      expect(Engine.paused).toBe(false);
    });
  });
});
