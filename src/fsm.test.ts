import { describe, expect, it, vi } from "vitest";
import { create } from "./fsm.js";

describe("Fsm", () => {
  it("starts in the initial state and fires its enter", () => {
    const enter = vi.fn();
    const sm = create({ idle: { enter }, run: {} }, "idle");
    expect(sm.state).toBe("idle");
    expect(sm.is("idle")).toBe(true);
    expect(enter).toHaveBeenCalledTimes(1);
  });

  it("throws on an unknown initial state", () => {
    // @ts-expect-error deliberately bad initial
    expect(() => create({ a: {} }, "b")).toThrow(/unknown initial/);
  });

  it("update transitions when a state's update returns a name (exit→enter)", () => {
    const order: string[] = [];
    let moving = false;
    const sm = create(
      {
        idle: {
          enter: () => order.push("enter idle"),
          exit: () => order.push("exit idle"),
          update: () => (moving ? "run" : null),
        },
        run: {
          enter: () => order.push("enter run"),
          update: () => (moving ? null : "idle"),
        },
      },
      "idle",
    );
    sm.update(16); // stays
    expect(sm.state).toBe("idle");
    moving = true;
    sm.update(16); // idle.update returns "run"
    expect(sm.state).toBe("run");
    expect(order).toEqual(["enter idle", "exit idle", "enter run"]);
  });

  it("does not re-run the new state's update in the same tick", () => {
    const runUpdate = vi.fn(() => null);
    const sm = create(
      {
        a: { update: () => "b" },
        b: { update: runUpdate },
      },
      "a",
    );
    sm.update(16); // a → b, but b.update must not run this tick
    expect(sm.state).toBe("b");
    expect(runUpdate).not.toHaveBeenCalled();
    sm.update(16);
    expect(runUpdate).toHaveBeenCalledTimes(1);
  });

  it("go() forces a transition and is a no-op for same/unknown state", () => {
    const change = vi.fn();
    const sm = create({ a: {}, b: {} }, "a", { onChange: change });
    expect(sm.go("b")).toBe(true);
    expect(sm.state).toBe("b");
    expect(change).toHaveBeenCalledWith("a", "b");
    expect(sm.go("b")).toBe(false); // already there
    // @ts-expect-error unknown state
    expect(sm.go("z")).toBe(false);
    expect(change).toHaveBeenCalledTimes(1);
  });

  it("drives an Anim.states-style bridge on the initial state and every change", () => {
    const played: string[] = [];
    const anim = { play: (s: string) => (played.push(s), true) };
    const sm = create({ idle: {}, run: {} }, "idle", { anim });
    expect(played).toEqual(["idle"]); // initial
    sm.go("run");
    expect(played).toEqual(["idle", "run"]);
    sm.go("run"); // no-op, no extra play
    expect(played).toEqual(["idle", "run"]);
  });

  it("passes dtMs to the active update", () => {
    const seen: number[] = [];
    const sm = create({ a: { update: (dt) => void seen.push(dt) } }, "a");
    sm.update(20);
    sm.update(); // defaults to 0
    expect(seen).toEqual([20, 0]);
  });
});
