import { describe, it, expect, vi } from "vitest";
import { createSignals } from "../signals.js";

describe("Signals", () => {
  it("delivers payloads to all listeners", () => {
    const s = createSignals();
    const a = vi.fn();
    const b = vi.fn();
    s.on("score", a);
    s.on("score", b);
    s.emit("score", 10);
    expect(a).toHaveBeenCalledWith(10);
    expect(b).toHaveBeenCalledWith(10);
  });

  it("off/unsubscribe removes a handler", () => {
    const s = createSignals();
    const fn = vi.fn();
    const off = s.on("x", fn);
    off();
    s.emit("x", 1);
    expect(fn).not.toHaveBeenCalled();
    expect(s.count("x")).toBe(0);
  });

  it("once fires a single time", () => {
    const s = createSignals();
    const fn = vi.fn();
    s.once("hit", fn);
    s.emit("hit");
    s.emit("hit");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(s.count("hit")).toBe(0);
  });

  it("a handler removing a later one during emit doesn't disturb this round", () => {
    const s = createSignals();
    const seen: string[] = [];
    let offB = () => {};
    s.on("e", () => {
      seen.push("a");
      offB(); // remove B mid-dispatch
    });
    offB = s.on("e", () => seen.push("b"));

    s.emit("e"); // snapshot dispatch: B still runs this round
    expect(seen).toEqual(["a", "b"]);

    seen.length = 0;
    s.emit("e"); // B is gone now
    expect(seen).toEqual(["a"]);
  });

  it("isolates a throwing handler", () => {
    const s = createSignals();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const good = vi.fn();
    s.on("e", () => {
      throw new Error("boom");
    });
    s.on("e", good);
    expect(() => s.emit("e")).not.toThrow();
    expect(good).toHaveBeenCalled();
    err.mockRestore();
  });

  it("off with no args clears everything", () => {
    const s = createSignals();
    s.on("a", vi.fn());
    s.on("b", vi.fn());
    s.off();
    expect(s.count("a")).toBe(0);
    expect(s.count("b")).toBe(0);
  });
});
