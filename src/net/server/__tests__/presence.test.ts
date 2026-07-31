import { describe, it, expect } from "vitest";
import { createPresence } from "@src/net/server/presence.js";

describe("net/server presence", () => {
  it("stores, reads, and removes state", () => {
    const p = createPresence<{ x: number }>();
    p.set("a", { x: 1 });
    p.set("b", { x: 2 });
    expect(p.get("a")).toEqual({ x: 1 });
    expect(p.has("b")).toBe(true);
    expect(p.size).toBe(2);
    expect(p.ids.sort()).toEqual(["a", "b"]);
    expect(p.delete("a")).toBe(true);
    expect(p.has("a")).toBe(false);
    expect(p.entries()).toEqual([["b", { x: 2 }]]);
  });

  it("set overwrites state and refreshes seen-time", () => {
    let t = 0;
    const p = createPresence<{ v: number }>({ timeoutMs: 100, now: () => t });
    p.set("a", { v: 1 });
    t = 90;
    p.set("a", { v: 2 }); // re-stamped at 90
    t = 150; // 60ms since last set → still alive
    expect(p.prune()).toEqual([]);
    expect(p.get("a")).toEqual({ v: 2 });
  });

  it("prune drops entries past the timeout and returns their ids", () => {
    let t = 0;
    const p = createPresence<number>({ timeoutMs: 100, now: () => t });
    p.set("stale", 1);
    t = 50;
    p.set("fresh", 2);
    t = 120; // stale: 120ms old (>100), fresh: 70ms old
    expect(p.prune().sort()).toEqual(["stale"]);
    expect(p.ids).toEqual(["fresh"]);
    expect(p.size).toBe(1);
  });

  it("touch keeps an entry alive without changing its state", () => {
    let t = 0;
    const p = createPresence<string>({ timeoutMs: 100, now: () => t });
    p.set("a", "hi");
    t = 90;
    p.touch("a");
    p.touch("ghost"); // absent → no-op
    t = 150; // 60ms since touch
    expect(p.prune()).toEqual([]);
    expect(p.get("a")).toBe("hi");
    expect(p.has("ghost")).toBe(false);
  });

  it("clear forgets everyone", () => {
    const p = createPresence<number>();
    p.set("a", 1);
    p.clear();
    expect(p.size).toBe(0);
  });
});
