import { describe, it, expect, beforeEach, vi } from "vitest";
import { load, save } from "./storage.js";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
  });
});

describe("Storage", () => {
  it("load fallback on missing key", () => expect(load("x", 42)).toBe(42));
  it("load returns stored value", () => {
    store.set("s", "100");
    expect(load("s", 0)).toBe(100);
  });
  it("load fallback on NaN", () => {
    store.set("s", "abc");
    expect(load("s", 0)).toBe(0);
  });
  it("save stores as string", () => {
    save("s", 99);
    expect(store.get("s")).toBe("99");
  });
  it("load fallback on throw", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw Error("x");
      },
    });
    expect(load("s", 10)).toBe(10);
  });
  it("save no throw on error", () => {
    vi.stubGlobal("localStorage", {
      setItem: () => {
        throw Error("x");
      },
    });
    expect(() => save("s", 50)).not.toThrow();
  });
});
