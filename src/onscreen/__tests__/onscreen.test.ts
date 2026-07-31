// Module-local onscreen input tests.
import { describe, it, expect } from "vitest";
import { padButtonIndex, computeStick, fuseGamepad, type RawPad } from "@src/onscreen/index.js";
import { createGamepadTracker } from "@src/input/index.js";

const btns = (...pressed: boolean[]): { pressed: boolean }[] =>
  pressed.map((p) => ({ pressed: p }));

describe("OnscreenInput", () => {
  describe("padButtonIndex", () => {
    it("maps face / shoulder / dpad buttons to standard indices", () => {
      expect(padButtonIndex("a")).toBe(0);
      expect(padButtonIndex("b")).toBe(1);
      expect(padButtonIndex("x")).toBe(2);
      expect(padButtonIndex("y")).toBe(3);
      expect(padButtonIndex("l1")).toBe(4);
      expect(padButtonIndex("start")).toBe(9);
      expect(padButtonIndex("dpad-up")).toBe(12);
      expect(padButtonIndex("dpad-right")).toBe(15);
    });

    it("returns undefined for stick pseudo-buttons (they are axes)", () => {
      expect(padButtonIndex("lstick-left")).toBeUndefined();
      expect(padButtonIndex("rstick-up")).toBeUndefined();
    });
  });

  describe("computeStick", () => {
    it("is zero at the center", () => {
      expect(computeStick(0, 0, 60)).toEqual({ x: 0, y: 0 });
    });

    it("reads magnitude 1 at the rim and clamps beyond it", () => {
      expect(computeStick(60, 0, 60)).toEqual({ x: 1, y: 0 });
      expect(computeStick(120, 0, 60)).toEqual({ x: 1, y: 0 }); // clamped
    });

    it("uses screen-down as positive y (matches lstick axis 1)", () => {
      expect(computeStick(0, 30, 60)).toEqual({ x: 0, y: 0.5 });
      expect(computeStick(0, -30, 60)).toEqual({ x: 0, y: -0.5 });
    });

    it("applies a radial deadzone, rescaling past it", () => {
      expect(computeStick(0, 6, 60, 0.2)).toEqual({ x: 0, y: 0 }); // n=0.1 < 0.2
      // n=0.6, scaled = (0.6-0.5)/0.5 = 0.2
      const v = computeStick(0, 36, 60, 0.5);
      expect(v.x).toBe(0);
      expect(v.y).toBeCloseTo(0.2, 5);
    });
  });

  describe("fuseGamepad", () => {
    const touch: RawPad = { connected: true, buttons: btns(true, false), axes: [0.5, 0] };

    it("returns touch untouched when there is no hardware pad", () => {
      expect(fuseGamepad(touch, null)).toBe(touch);
      expect(fuseGamepad(touch, { connected: false, buttons: [], axes: [] })).toBe(touch);
    });

    it("ORs buttons across sources", () => {
      const hw: RawPad = { connected: true, buttons: btns(false, true), axes: [0, 0] };
      const out = fuseGamepad(touch, hw);
      expect(out.buttons[0].pressed).toBe(true); // from touch
      expect(out.buttons[1].pressed).toBe(true); // from hardware
    });

    it("takes the larger-magnitude axis", () => {
      const hw: RawPad = { connected: true, buttons: btns(false, false), axes: [-0.9, 0.2] };
      const out = fuseGamepad(touch, hw);
      expect(out.axes[0]).toBe(-0.9); // hw wins (|−0.9| > |0.5|)
      expect(out.axes[1]).toBe(0.2); // hw wins (touch is 0)
    });
  });

  describe("edge semantics through createGamepadTracker (the real fusion path)", () => {
    it("keeps pressed/released edge-correct across a touch press", () => {
      let touch: RawPad = { connected: true, buttons: btns(false), axes: [0, 0] };
      const pad = createGamepadTracker(() => fuseGamepad(touch, null) as unknown as Gamepad);

      pad.poll();
      expect(pad.down(0)).toBe(false);

      touch = { connected: true, buttons: btns(true), axes: [0, 0] };
      pad.poll();
      expect(pad.pressed(0)).toBe(true);
      expect(pad.down(0)).toBe(true);

      pad.poll(); // held a second step
      expect(pad.pressed(0)).toBe(false);
      expect(pad.down(0)).toBe(true);

      touch = { connected: true, buttons: btns(false), axes: [0, 0] };
      pad.poll();
      expect(pad.released(0)).toBe(true);
      expect(pad.down(0)).toBe(false);
    });

    it("does not fire a release when the same button is still held by the other source", () => {
      let touch: RawPad = { connected: true, buttons: btns(false), axes: [0, 0] };
      let hw: RawPad | null = null;
      const pad = createGamepadTracker(() => fuseGamepad(touch, hw) as unknown as Gamepad);

      // Touch presses A, then hardware also presses A.
      touch = { connected: true, buttons: btns(true), axes: [0, 0] };
      pad.poll();
      hw = { connected: true, buttons: btns(true), axes: [0, 0] };
      pad.poll();
      expect(pad.down(0)).toBe(true);

      // Release the touch — hardware still holds A, so no release yet.
      touch = { connected: true, buttons: btns(false), axes: [0, 0] };
      pad.poll();
      expect(pad.down(0)).toBe(true);
      expect(pad.released(0)).toBe(false);

      // Release hardware too — now it releases.
      hw = { connected: true, buttons: btns(false), axes: [0, 0] };
      pad.poll();
      expect(pad.released(0)).toBe(true);
    });

    it("fires pressed AGAIN after a release (no stuck held bit)", () => {
      // The touch pad emits a FULL-length button array so a released button
      // reports pressed:false rather than dropping out — otherwise the tracker's
      // poll loop skips the absent index and its held bit sticks, so the button
      // fires pressed only once (the 'jump once and never again' bug).
      const full = (down: boolean): RawPad => ({ connected: true, buttons: btns(down), axes: [] });
      let cur = full(false);
      const pad = createGamepadTracker(() => fuseGamepad(cur, null) as unknown as Gamepad);

      for (let cycle = 0; cycle < 3; cycle++) {
        cur = full(true);
        pad.poll();
        expect(pad.pressed(0)).toBe(true); // pressed fires on EVERY press
        cur = full(false);
        pad.poll();
        expect(pad.down(0)).toBe(false); // and the release always registers
      }
    });

    it("applies the tracker deadzone to fused axes", () => {
      let touch: RawPad = { connected: true, buttons: [], axes: [0.6, 0.1] };
      const pad = createGamepadTracker(() => fuseGamepad(touch, null) as unknown as Gamepad);
      pad.poll();
      expect(pad.axis(0)).toBeCloseTo(0.6, 5);
      expect(pad.axis(1)).toBe(0); // 0.1 is inside the 0.15 deadzone
      touch = { connected: true, buttons: [], axes: [0, 0] };
    });
  });
});
