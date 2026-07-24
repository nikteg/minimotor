import { describe, expect, it } from "vitest";
import { lruCache } from "../cache.js";

describe("lruCache", () => {
  it("stores and retrieves values, reports size", () => {
    const c = lruCache<number>(4);
    c.set("a", 1);
    c.set("b", 2);
    expect(c.get("a")).toBe(1);
    expect(c.get("b")).toBe(2);
    expect(c.get("missing")).toBeUndefined();
    expect(c.size).toBe(2);
  });

  it("evicts the oldest entry beyond the cap", () => {
    const c = lruCache<number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3); // over cap → "a" (oldest) goes
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe(2);
    expect(c.get("c")).toBe(3);
    expect(c.size).toBe(2);
  });

  it("a get-hit refreshes recency, changing the eviction victim", () => {
    const c = lruCache<number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a"); // "a" becomes most-recent → "b" is now oldest
    c.set("c", 3);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
  });

  it("re-setting an existing key updates the value and recency, not the size", () => {
    const c = lruCache<number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.set("a", 10); // "a" refreshed → "b" is now oldest
    expect(c.size).toBe(2);
    c.set("c", 3);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(10);
  });

  it("caches null values (miss stays distinguishable as undefined)", () => {
    const c = lruCache<string | null>(2);
    c.set("nope", null);
    expect(c.get("nope")).toBeNull();
    expect(c.get("gone")).toBeUndefined();
  });

  it("delete and clear remove entries", () => {
    const c = lruCache<number>(4);
    c.set("a", 1);
    c.set("b", 2);
    expect(c.delete("a")).toBe(true);
    expect(c.delete("a")).toBe(false);
    expect(c.size).toBe(1);
    c.clear();
    expect(c.size).toBe(0);
    expect(c.get("b")).toBeUndefined();
  });

  it("entries() iterates oldest-first and tolerates deleting while sweeping", () => {
    const c = lruCache<number>(4);
    c.set("x@1", 1);
    c.set("y@2", 2);
    c.set("z@1", 3);
    c.get("x@1"); // refresh → order is y@2, z@1, x@1
    expect([...c.entries()].map(([k]) => k)).toEqual(["y@2", "z@1", "x@1"]);
    for (const [key] of c.entries()) if (key.endsWith("@1")) c.delete(key); // dpr-style sweep
    expect([...c.entries()].map(([k]) => k)).toEqual(["y@2"]);
  });
});
