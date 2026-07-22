import { describe, expect, it } from "vitest";
import { buffer, cooldown, jumpGate, window } from "../timers.js";

describe("Timers.window (coyote/grace)", () => {
  it("is active for the duration after charge, then closes", () => {
    const w = window(100);
    expect(w.active).toBe(false);
    w.charge();
    expect(w.active).toBe(true);
    expect(w.remaining).toBe(100);
    w.tick(60);
    expect(w.active).toBe(true);
    w.tick(60); // 120 > 100
    expect(w.active).toBe(false);
    expect(w.remaining).toBe(0);
  });

  it("recharging refills the window", () => {
    const w = window(100);
    w.charge();
    w.tick(80);
    w.charge(); // still grounded
    expect(w.remaining).toBe(100);
  });

  it("expire() closes it immediately", () => {
    const w = window(100);
    w.charge();
    w.expire();
    expect(w.active).toBe(false);
  });
});

describe("Timers.buffer (input buffering)", () => {
  it("consume returns true once within the window, then clears", () => {
    const b = buffer(120);
    expect(b.consume()).toBe(false);
    b.trigger();
    expect(b.armed).toBe(true);
    expect(b.consume()).toBe(true);
    expect(b.consume()).toBe(false); // already spent
  });

  it("expires if not consumed in time", () => {
    const b = buffer(120);
    b.trigger();
    b.tick(130);
    expect(b.consume()).toBe(false);
  });
});

describe("Timers.cooldown", () => {
  it("blocks until the delay elapses, restarts on use", () => {
    const cd = cooldown(500);
    expect(cd.ready()).toBe(true);
    cd.use();
    expect(cd.ready()).toBe(false);
    cd.tick(400);
    expect(cd.ready()).toBe(false);
    cd.tick(100);
    expect(cd.ready()).toBe(true);
    cd.use();
    expect(cd.ready()).toBe(false);
  });
});

describe("Timers.jumpGate", () => {
  it("fires when grounded and pressed on the same step", () => {
    const g = jumpGate({ coyoteMs: 100, bufferMs: 120 });
    expect(g.try(true, true)).toBe(true);
    expect(g.try(false, true)).toBe(false); // no press
  });

  it("coyote time: fires shortly after leaving the ground", () => {
    const g = jumpGate({ coyoteMs: 100, bufferMs: 120 });
    g.try(false, true); // grounded, charge coyote
    // Now airborne; press within the coyote window a couple steps later.
    expect(g.try(false, false)).toBe(false);
    expect(g.try(true, false)).toBe(true); // ~33ms after takeoff < 100
  });

  it("coyote expires after the window", () => {
    const g = jumpGate({ coyoteMs: 100, bufferMs: 120 });
    g.try(false, true);
    for (let i = 0; i < 8; i++) g.try(false, false); // ~133ms airborne
    expect(g.try(true, false)).toBe(false); // too late
  });

  it("jump buffering: a press just before landing fires on touchdown", () => {
    const g = jumpGate({ coyoteMs: 100, bufferMs: 120 });
    // Airborne, press buffered (no coyote left → doesn't fire yet).
    g.try(false, true); // ground once
    for (let i = 0; i < 8; i++) g.try(false, false); // burn coyote
    expect(g.try(true, false)).toBe(false); // buffered, airborne
    // Land within the buffer window → fires.
    expect(g.try(false, true)).toBe(true);
  });

  it("only one jump per takeoff (no lingering-coyote double jump)", () => {
    const g = jumpGate({ coyoteMs: 100, bufferMs: 120 });
    expect(g.try(true, true)).toBe(true); // jump
    // Still 'grounded' the same/next step but shouldn't immediately re-fire
    // without a fresh press+ground; a held press isn't an edge.
    expect(g.try(false, false)).toBe(false);
    expect(g.try(true, false)).toBe(false); // coyote was expired on fire
  });
});
