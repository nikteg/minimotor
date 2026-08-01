import { describe, expect, it, vi } from "vitest";
import { createHotReload } from "../index.js";

describe("Hot", () => {
  it("persists state and runs cleanup through a compatible HMR context", () => {
    const data: Record<string, unknown> = {};
    let dispose: ((next: Record<string, unknown>) => void) | undefined;
    const context = {
      data,
      accept: vi.fn(),
      dispose: vi.fn((callback: (next: Record<string, unknown>) => void) => {
        dispose = callback;
      }),
    };
    const cleanup = vi.fn();
    const hot = createHotReload(context);
    let score = 7;
    hot.persist("game", () => ({ score }));
    hot.onDispose(cleanup);

    dispose?.(data);

    expect(context.accept).toHaveBeenCalledOnce();
    expect(data.game).toEqual({ score: 7 });
    expect(cleanup).toHaveBeenCalledOnce();
    score = 9;
    expect(hot.restore<{ score: number }>("game")).toEqual({ score: 7 });
  });

  it("is a no-op without a bundler context", () => {
    const hot = createHotReload();
    expect(hot.enabled).toBe(false);
    expect(hot.restore("missing")).toBeUndefined();
    expect(() => hot.persist("game", () => ({ score: 1 }))).not.toThrow();
  });
});
