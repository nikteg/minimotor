import { describe, expect, it } from "vitest";
import { buffer, cooldown, jumpGate, window } from "../timers/index.js";
import { createClockHandle } from "../clock.js";

// A hand-cranked clock: advance by ms; timers derive from `now`.
function clockAt() {
  let now = 0;
  const clock = createClockHandle(() => now);
  return { clock, advance: (ms: number) => (now += ms / (1000 / 60)) };
}

describe("Timers.window (coyote/grace)", () => {
  it("is active for the duration after charge, then closes", () => {
    const t = clockAt();
    const w = window(100, t.clock);
    expect(w.active).toBe(false);
    w.charge();
    expect(w.active).toBe(true);
    expect(w.remaining).toBeCloseTo(100);
    t.advance(60);
    expect(w.active).toBe(true);
    t.advance(60); // 120 > 100
    expect(w.active).toBe(false);
    expect(w.remaining).toBe(0);
  });

  it("recharging refills the window", () => {
    const t = clockAt();
    const w = window(100, t.clock);
    w.charge();
    t.advance(80);
    w.charge(); // still grounded
    expect(w.remaining).toBeCloseTo(100);
  });

  it("expire() closes it immediately", () => {
    const t = clockAt();
    const w = window(100, t.clock);
    w.charge();
    w.expire();
    expect(w.active).toBe(false);
  });
});

describe("Timers.buffer (input buffering)", () => {
  it("consume returns true once within the window, then clears", () => {
    const t = clockAt();
    const b = buffer(120, t.clock);
    expect(b.consume()).toBe(false);
    b.trigger();
    expect(b.armed).toBe(true);
    expect(b.consume()).toBe(true);
    expect(b.consume()).toBe(false); // already spent
  });

  it("expires if not consumed in time", () => {
    const t = clockAt();
    const b = buffer(120, t.clock);
    b.trigger();
    t.advance(130);
    expect(b.consume()).toBe(false);
  });
});

describe("Timers.cooldown", () => {
  it("blocks until the delay elapses, restarts on use", () => {
    const t = clockAt();
    const cd = cooldown(500, t.clock);
    expect(cd.ready()).toBe(true);
    cd.use();
    expect(cd.ready()).toBe(false);
    t.advance(400);
    expect(cd.ready()).toBe(false);
    t.advance(100);
    expect(cd.ready()).toBe(true);
    cd.use();
    expect(cd.ready()).toBe(false);
  });
});

describe("Timers.jumpGate", () => {
  // The gate reads real time via its clock; advance ~1 step between tries.
  function gateAt(opts = {}) {
    const t = clockAt();
    const g = jumpGate({ coyoteMs: 100, bufferMs: 120, clock: t.clock, ...opts });
    return { g, step: () => t.advance(1000 / 60) };
  }

  it("fires when grounded and pressed on the same step", () => {
    const { g } = gateAt();
    expect(g.try(true, true)).toBe(true);
    expect(g.try(false, true)).toBe(false); // no press
  });

  it("coyote time: fires shortly after leaving the ground", () => {
    const { g, step } = gateAt();
    g.try(false, true); // grounded, charge coyote
    step();
    expect(g.try(false, false)).toBe(false);
    step();
    expect(g.try(true, false)).toBe(true); // ~33ms after takeoff < 100
  });

  it("coyote expires after the window", () => {
    const { g, step } = gateAt();
    g.try(false, true);
    for (let i = 0; i < 8; i++) {
      step();
      g.try(false, false); // ~133ms airborne
    }
    expect(g.try(true, false)).toBe(false); // too late
  });

  it("jump buffering: a press just before landing fires on touchdown", () => {
    const { g, step } = gateAt();
    g.try(false, true); // ground once
    for (let i = 0; i < 8; i++) {
      step();
      g.try(false, false); // burn coyote
    }
    expect(g.try(true, false)).toBe(false); // buffered, airborne
    step();
    expect(g.try(false, true)).toBe(true); // land within the buffer window
  });

  it("only one jump per takeoff (no lingering-coyote double jump)", () => {
    const { g, step } = gateAt();
    expect(g.try(true, true)).toBe(true); // jump
    step();
    expect(g.try(false, false)).toBe(false);
    step();
    expect(g.try(true, false)).toBe(false); // coyote was expired on fire
  });
});
