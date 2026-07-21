import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { wireButton, preventTouchFocus, vibrate, actions, createGamepadTracker } from "../index.js";
import { Stage } from "../../engine/index.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("Input", () => {
  describe("wireButton", () => {
    it("returns element when found", () => {
      document.body.innerHTML = '<button id="b">X</button>';
      expect(wireButton("b", vi.fn())?.textContent).toBe("X");
    });
    it("returns null when missing", () => {
      expect(wireButton("x", vi.fn())).toBeNull();
    });
    it("fires action on click", () => {
      document.body.innerHTML = '<button id="b">X</button>';
      const fn = vi.fn();
      wireButton("b", fn);
      document.getElementById("b")!.click();
      expect(fn).toHaveBeenCalledOnce();
    });
    it("prevents mousedown default", () => {
      document.body.innerHTML = '<button id="b">X</button>';
      wireButton("b", vi.fn());
      const e = new MouseEvent("mousedown", { cancelable: true });
      document.getElementById("b")!.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
    });
    it("fires on touchstart", () => {
      document.body.innerHTML = '<button id="b">X</button>';
      const fn = vi.fn();
      wireButton("b", fn);
      const e = new TouchEvent("touchstart", { cancelable: true });
      document.getElementById("b")!.dispatchEvent(e);
      expect(fn).toHaveBeenCalledOnce();
    });
    it("blurs after click", () => {
      document.body.innerHTML = '<button id="b">X</button>';
      wireButton("b", vi.fn());
      const btn = document.getElementById("b")!;
      const spy = vi.spyOn(btn, "blur");
      btn.click();
      expect(spy).toHaveBeenCalled();
    });
  });

  describe("preventTouchFocus", () => {
    it("prevents touchstart on canvas", () => {
      const c = document.createElement("canvas");
      preventTouchFocus(c);
      const e = new TouchEvent("touchstart", { cancelable: true });
      c.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
    });
  });

  describe("actions", () => {
    it("maps named actions to any of their bound key codes", () => {
      // The actions helper reads the default game's Keys — build one.
      const origGc = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type: string) {
        if (type !== "2d") return origGc.call(this, type);
        return { setTransform: vi.fn(), canvas: this } as unknown as CanvasRenderingContext2D;
      };
      try {
        Stage.init(document.createElement("canvas"));
        const input = actions({ left: ["ArrowLeft", "KeyA"], jump: ["Space"] });
        expect(input.down("left")).toBe(false);
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA" }));
        expect(input.down("left")).toBe(true); // alternate binding counts
        expect(input.pressed("left")).toBe(true);
        expect(input.down("jump")).toBe(false);
        window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyA" }));
        expect(input.down("left")).toBe(false);
        expect(input.released("left")).toBe(true);
      } finally {
        HTMLCanvasElement.prototype.getContext = origGc;
      }
    });
  });

  describe("gamepad", () => {
    function fakePad(overrides: Partial<Gamepad> = {}): Gamepad {
      return {
        connected: true,
        buttons: [{ pressed: false }, { pressed: false }],
        axes: [0, 0],
        ...overrides,
      } as unknown as Gamepad;
    }

    it("tracks down/pressed/released with per-poll edge semantics", () => {
      let pad = fakePad();
      const t = createGamepadTracker(() => pad);
      t.poll();
      expect(t.down(0)).toBe(false);

      pad = fakePad({ buttons: [{ pressed: true }, { pressed: false }] } as Partial<Gamepad>);
      t.poll();
      expect(t.down(0)).toBe(true);
      expect(t.pressed(0)).toBe(true);

      t.poll(); // still held: the edge lasts exactly one poll
      expect(t.down(0)).toBe(true);
      expect(t.pressed(0)).toBe(false);

      pad = fakePad();
      t.poll();
      expect(t.down(0)).toBe(false);
      expect(t.released(0)).toBe(true);
    });

    it("applies a deadzone to axes and is neutral out of range", () => {
      const t = createGamepadTracker(() => fakePad({ axes: [0.05, -0.6] } as Partial<Gamepad>));
      t.poll();
      expect(t.axis(0)).toBe(0); // inside the deadzone
      expect(t.axis(1)).toBe(-0.6);
      expect(t.axis(9)).toBe(0); // no such axis
    });

    it("reports disconnect and releases held buttons exactly once", () => {
      let pad: Gamepad | null = fakePad({ buttons: [{ pressed: true }] } as Partial<Gamepad>);
      const t = createGamepadTracker(() => pad);
      t.poll();
      expect(t.connected).toBe(true);
      expect(t.down(0)).toBe(true);

      pad = null; // unplugged mid-hold
      t.poll();
      expect(t.connected).toBe(false);
      expect(t.down(0)).toBe(false);
      expect(t.released(0)).toBe(true);

      t.poll();
      expect(t.released(0)).toBe(false);
    });
  });

  describe("vibrate", () => {
    const original = Object.getOwnPropertyDescriptor(navigator, "vibrate");
    afterEach(() => {
      if (original) Object.defineProperty(navigator, "vibrate", original);
      else delete (navigator as { vibrate?: unknown }).vibrate;
    });

    it("forwards the pattern to navigator.vibrate and returns its result", () => {
      const spy = vi.fn(() => true);
      Object.defineProperty(navigator, "vibrate", { value: spy, configurable: true });
      expect(vibrate([10, 20, 10])).toBe(true);
      expect(spy).toHaveBeenCalledWith([10, 20, 10]);
    });

    it("no-ops to false where the Vibration API is unavailable", () => {
      Object.defineProperty(navigator, "vibrate", { value: undefined, configurable: true });
      expect(vibrate(50)).toBe(false);
    });

    it("swallows a throwing implementation", () => {
      Object.defineProperty(navigator, "vibrate", {
        value: () => {
          throw new Error("blocked");
        },
        configurable: true,
      });
      expect(vibrate(50)).toBe(false);
    });
  });
});
