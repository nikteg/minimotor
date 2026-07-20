import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { wireButton, preventTouchFocus, vibrate } from "./input.js";

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
