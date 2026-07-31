// Module-local finite-state-machine tests.
import { describe, expect, it, vi } from "vitest";
import { create } from "@src/fsm/index.js";

describe("Fsm", () => {
  it("starts in the initial state and fires its enter", () => {
    const enter = vi.fn();
    const sm = create({ idle: { enter }, run: {} }, "idle");
    expect(sm.current).toBe("idle");
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
    sm.update(); // stays
    expect(sm.current).toBe("idle");
    moving = true;
    sm.update(); // idle.update returns "run"
    expect(sm.current).toBe("run");
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
    sm.update(); // a → b, but b.update must not run this tick
    expect(sm.current).toBe("b");
    expect(runUpdate).not.toHaveBeenCalled();
    sm.update();
    expect(runUpdate).toHaveBeenCalledTimes(1);
  });

  it("go() forces a transition and is a no-op for same/unknown state", () => {
    const change = vi.fn();
    const sm = create({ a: {}, b: {} }, "a", { onChange: change });
    expect(sm.go("b")).toBe(true);
    expect(sm.current).toBe("b");
    expect(change).toHaveBeenCalledWith("a", "b");
    expect(sm.go("b")).toBe(false); // already there
    // @ts-expect-error unknown state
    expect(sm.go("z")).toBe(false);
    expect(change).toHaveBeenCalledTimes(1);
  });

  it("update takes no arguments — one call per step, closures carry state", () => {
    let calls = 0;
    const sm = create({ a: { update: () => void calls++ } }, "a");
    sm.update();
    sm.update();
    expect(calls).toBe(2);
  });
});
