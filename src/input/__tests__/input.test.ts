import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  wireButton,
  preventTouchFocus,
  vibrate,
  map,
  createGamepadTracker,
  navigation,
} from "../index.js";

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

  describe("Input.map", () => {
    // Fake, injectable sources — the map is a pure fusion layer over them.
    function fakeKeys(held: Set<string>, edges: { pressed: Set<string>; released: Set<string> }) {
      return {
        down: (c: string) => held.has(c),
        pressed: (c: string) => edges.pressed.has(c),
        released: (c: string) => edges.released.has(c),
      };
    }
    function fakeStickPad(axes: number[], downs = new Set<number>()) {
      return {
        connected: true,
        axis: (i: number) => axes[i] ?? 0,
        down: (b: number) => downs.has(b),
        pressed: () => false,
        released: () => false,
      };
    }

    it("fuses key bindings: any binding activates the action", () => {
      const held = new Set<string>();
      const edges = { pressed: new Set<string>(), released: new Set<string>() };
      const input = map(
        { left: ["ArrowLeft", "KeyA"], jump: ["Space"] },
        { keys: fakeKeys(held, edges), pad: null, steps: () => 0 },
      );
      expect(input.left.down).toBe(false);
      held.add("KeyA");
      edges.pressed.add("KeyA");
      expect(input.left.down).toBe(true); // alternate binding counts
      expect(input.left.pressed).toBe(true);
      expect(input.jump.down).toBe(false);
    });

    it("pad buttons and stick directions activate actions, with per-step edges", () => {
      let step = 0;
      const axes = [0, 0];
      const downs = new Set<number>();
      const input = map(
        { right: ["pad:dpad-right", "pad:lstick-right"], jump: ["pad:a"] },
        {
          keys: fakeKeys(new Set(), { pressed: new Set(), released: new Set() }),
          pad: fakeStickPad(axes, downs),
          steps: () => step,
        },
      );
      expect(input.jump.down).toBe(false);
      downs.add(0); // Buttons.A
      step += 1;
      expect(input.jump.down).toBe(true);
      expect(input.jump.pressed).toBe(true); // edge on the step it appeared
      step += 1;
      expect(input.jump.pressed).toBe(false); // held, no longer an edge
      downs.delete(0);
      step += 1;
      expect(input.jump.released).toBe(true);

      axes[0] = 0.8; // stick right
      step += 1;
      expect(input.right.down).toBe(true);
      expect(input.right.value).toBeCloseTo(0.8); // analog magnitude
    });

    it("can consume a UI-owned action until its bindings are released", () => {
      let step = 0;
      const downs = new Set<number>([0]);
      const input = map(
        { jump: ["pad:a"] },
        {
          keys: fakeKeys(new Set(), { pressed: new Set(), released: new Set() }),
          pad: fakeStickPad([], downs),
          steps: () => step,
        },
      );
      input.consume("jump");
      expect(input.jump.down).toBe(false);
      expect(input.jump.pressed).toBe(false);
      step++;
      expect(input.jump.pressed).toBe(false);
      downs.clear();
      step++;
      expect(input.jump.released).toBe(false);
      downs.add(0);
      step++;
      expect(input.jump.pressed).toBe(true);
    });

    it("axis fuses opposing actions, analog-aware", () => {
      let step = 0;
      const held = new Set<string>();
      const axes = [0, 0];
      const input = map(
        {
          left: ["KeyA", "pad:lstick-left"],
          right: ["KeyD", "pad:lstick-right"],
        },
        {
          keys: fakeKeys(held, { pressed: new Set(), released: new Set() }),
          pad: fakeStickPad(axes),
          steps: () => step,
        },
      );
      expect(input.axis("left", "right")).toBe(0);
      held.add("KeyD");
      step += 1;
      expect(input.axis("left", "right")).toBe(1); // keys snap to ±1
      held.delete("KeyD");
      axes[0] = -0.6;
      step += 1; // pad activity memoizes per step — new step, fresh sample
      expect(input.axis("left", "right")).toBeCloseTo(-0.6); // analog
    });

    it("vector normalizes the keyboard diagonal but preserves analog magnitude", () => {
      const held = new Set<string>(["KeyD", "KeyS"]);
      const input = map(
        { left: ["KeyA"], right: ["KeyD"], up: ["KeyW"], down: ["KeyS"] },
        {
          keys: fakeKeys(held, { pressed: new Set(), released: new Set() }),
          pad: null,
          steps: () => 0,
        },
      );
      const v = input.vector("left", "right", "up", "down");
      expect(Math.hypot(v.x, v.y)).toBeCloseTo(1); // no 1.41× diagonal
      expect(v.x).toBeCloseTo(Math.SQRT1_2);
    });

    it("rebind replaces bindings and bindings round-trips as JSON", () => {
      const held = new Set<string>();
      const input = map(
        { jump: ["Space"] },
        {
          keys: fakeKeys(held, { pressed: new Set(), released: new Set() }),
          pad: null,
          steps: () => 0,
        },
      );
      input.rebind("jump", ["KeyJ"]);
      held.add("Space");
      expect(input.jump.down).toBe(false); // old binding gone
      held.add("KeyJ");
      expect(input.jump.down).toBe(true);
      expect(JSON.parse(JSON.stringify(input.bindings))).toEqual({ jump: ["KeyJ"] });
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

    it("combines stick and d-pad into semantic navigation axes", () => {
      const t = createGamepadTracker(() =>
        fakePad({
          axes: [0.6, 0],
          buttons: Array.from({ length: 16 }, (_, i) => ({
            pressed: i === 12 || i === 0 || i === 1,
          })),
        } as Partial<Gamepad>),
      );
      t.poll();
      expect(navigation(t, { stick: 0 })).toMatchObject({
        x: 0.6,
        y: -1,
        acceptPressed: true,
        cancelPressed: true,
      });
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
