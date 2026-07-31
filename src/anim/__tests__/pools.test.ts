import { describe, expect, it } from "vitest";
import { effects, keyed } from "@src/anim/pools.js";

describe("animation pools", () => {
  it("lazily owns and retains keyed values", () => {
    const pool = keyed<string, { id: string }>((id) => ({ id }));
    expect(pool.get("a")).toBe(pool.get("a"));
    pool.get("b");
    pool.retain(["b"]);
    expect(pool.has("a")).toBe(false);
    expect(pool.size).toBe(1);
  });

  it("prunes completed one-shot effects while iterating", () => {
    const pool = effects(
      (name: string) => ({ name, done: false }),
      (effect) => effect.done,
    );
    const first = pool.play("first");
    pool.play("second");
    first.done = true;
    expect([...pool].map((effect) => effect.name)).toEqual(["second"]);
  });
});
