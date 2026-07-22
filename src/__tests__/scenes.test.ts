import { describe, expect, it, vi } from "vitest";
import { Scenes } from "../scenes.js";
import { createClockHandle, type ClockHandle } from "../clock.js";

function makeClock(): ClockHandle {
  let steps = 0;
  const clock = createClockHandle(() => steps++);
  return clock;
}

describe("Scenes.create (typed stack)", () => {
  it("enters the FIRST scene in the map on creation", () => {
    const enter = vi.fn();
    const scenes = Scenes.create({ title: { enter }, playing: {} }, { clock: makeClock() });
    expect(scenes.active).toBe("title");
    expect(enter).toHaveBeenCalledTimes(1);
  });

  it("is structurally GameCallbacks: update ticks the top scene only", () => {
    const titleUpdate = vi.fn();
    const playUpdate = vi.fn();
    const scenes = Scenes.create(
      { title: { update: titleUpdate }, playing: { update: playUpdate } },
      { clock: makeClock() },
    );
    scenes.update();
    scenes.go("playing");
    scenes.update();
    expect(titleUpdate).toHaveBeenCalledTimes(1);
    expect(playUpdate).toHaveBeenCalledTimes(1);
  });

  it("go replaces the stack, firing exits then enter", () => {
    const order: string[] = [];
    const scenes = Scenes.create(
      {
        a: { exit: () => order.push("exit a") },
        b: { enter: () => order.push("enter b") },
      },
      { clock: makeClock() },
    );
    scenes.go("b");
    expect(order).toEqual(["exit a", "enter b"]);
    expect(scenes.stack).toEqual(["b"]);
  });

  it("push overlays: below keeps drawing, only the top updates", () => {
    const drew: string[] = [];
    const below = vi.fn();
    const scenes = Scenes.create(
      {
        playing: { update: below, draw: () => drew.push("playing") },
        paused: { draw: () => drew.push("paused") },
      },
      { clock: makeClock() },
    );
    scenes.push("paused");
    scenes.update();
    expect(below).not.toHaveBeenCalled(); // gated
    scenes.draw({} as CanvasRenderingContext2D);
    expect(drew).toEqual(["playing", "paused"]); // bottom-to-top re-draw
  });

  it("draw starts at the topmost opaque scene", () => {
    const drew: string[] = [];
    const scenes = Scenes.create(
      {
        world: { draw: () => drew.push("world") },
        cover: { draw: () => drew.push("cover"), opaque: true },
        toast: { draw: () => drew.push("toast") },
      },
      { clock: makeClock() },
    );
    scenes.push("cover");
    scenes.push("toast");
    scenes.draw({} as CanvasRenderingContext2D);
    expect(drew).toEqual(["cover", "toast"]); // world is covered
  });

  it("push holds the game clock; pop releases it (the time boundary)", () => {
    const clock = makeClock();
    const scenes = Scenes.create({ playing: {}, paused: {} }, { clock });
    expect(clock.held).toBe(false);
    scenes.push("paused");
    expect(clock.held).toBe(true);
    scenes.pop();
    expect(clock.held).toBe(false);
  });

  it("holdsTime: false keeps world time flowing under the modal", () => {
    const clock = makeClock();
    const scenes = Scenes.create({ playing: {}, paused: { holdsTime: false } }, { clock });
    scenes.push("paused");
    expect(clock.held).toBe(false); // live-world pause menu
  });

  it("stacked modals: the hold survives until the last holder pops", () => {
    const clock = makeClock();
    const scenes = Scenes.create({ playing: {}, inventory: {}, dialog: {} }, { clock });
    scenes.push("inventory");
    scenes.push("dialog");
    expect(clock.held).toBe(true);
    scenes.pop();
    expect(clock.held).toBe(true); // inventory still holds
    scenes.pop();
    expect(clock.held).toBe(false);
  });

  it("go releases any modal hold (fresh stack, fresh time)", () => {
    const clock = makeClock();
    const scenes = Scenes.create({ playing: {}, paused: {}, title: {} }, { clock });
    scenes.push("paused");
    expect(clock.held).toBe(true);
    scenes.go("title");
    expect(clock.held).toBe(false);
  });

  it("unknown scene names throw", () => {
    const scenes = Scenes.create({ only: {} }, { clock: makeClock() });
    // @ts-expect-error unknown name
    expect(() => scenes.go("nope")).toThrow(/no scene/);
    // @ts-expect-error unknown name
    expect(() => scenes.push("nope")).toThrow(/no scene/);
  });

  it("requires at least one scene", () => {
    expect(() => Scenes.create({} as Record<string, never>)).toThrow(/at least one/);
  });
});
