import { describe, it, expect, vi } from "vitest";
import { createPerfTracker, createNetMeter, drawPerfHud } from "./perf.js";

describe("createPerfTracker", () => {
  it("primes on the first call, then reports fps from frame deltas", () => {
    const tick = createPerfTracker();
    tick(100); // prime — no delta yet
    const s = tick(100 + 1000 / 60); // one ~16.7ms frame
    expect(s.fps).toBe(60);
  });
});

describe("createNetMeter", () => {
  it("reports zero on the first (priming) sample", () => {
    const m = createNetMeter();
    m.sent(100);
    expect(m.sample(1000)).toMatchObject({ upMsgs: 0, upBps: 0 });
  });

  it("converts counts to smoothed per-second rates", () => {
    const m = createNetMeter();
    m.sample(1000); // establish the baseline timestamp
    // 10 messages / 500 bytes sent, 4 received, over a 1s window.
    for (let i = 0; i < 10; i++) m.sent(50);
    for (let i = 0; i < 4; i++) m.recv(20);
    const s = m.sample(2000);
    // First smoothed step is k=0.2 of the instantaneous rate (10/s, 500 B/s).
    expect(s.upMsgs).toBeCloseTo(2); // 0.2 * 10
    expect(s.upBps).toBeCloseTo(100); // 0.2 * 500
    expect(s.downMsgs).toBeCloseTo(0.8); // 0.2 * 4
  });

  it("ignores a non-advancing timestamp", () => {
    const m = createNetMeter();
    m.sample(500); // prime
    m.sent(10);
    const s = m.sample(500); // dt = 0
    expect(s.upMsgs).toBe(0);
  });
});

describe("drawPerfHud", () => {
  const stats = { fps: 60, frameMs: 16, minMs: 15, maxMs: 18, avgMs: 16.5 };

  function recorder() {
    const rects: number[][] = [];
    const ctx = {
      fillStyle: "",
      font: "",
      textBaseline: "",
      textAlign: "",
      save: vi.fn(),
      restore: vi.fn(),
      fillRect: vi.fn((x: number, y: number, w: number, h: number) => rects.push([x, y, w, h])),
      fillText: vi.fn(),
    } as unknown as CanvasRenderingContext2D & {
      fillText: ReturnType<typeof vi.fn>;
      save: ReturnType<typeof vi.fn>;
      restore: ReturnType<typeof vi.fn>;
    };
    return { ctx, rects };
  }

  it("saves and restores ctx state so nothing leaks into the game's draw", () => {
    const { ctx } = recorder();
    drawPerfHud(ctx, stats, { viewW: 800 });
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it("anchors the box to the right edge by default", () => {
    const { ctx, rects } = recorder();
    drawPerfHud(ctx, stats, { viewW: 800 });
    // box width 130, right-anchored: bgX = 800 - 4 - 130 = 666
    expect(rects[0][0]).toBe(666);
  });

  it("draws in the top-left when asked", () => {
    const { ctx, rects } = recorder();
    drawPerfHud(ctx, stats, { viewW: 800, anchor: "top-left" });
    expect(rects[0][0]).toBe(4);
  });

  it("adds two network lines and a wider box when net stats are given", () => {
    const { ctx, rects } = recorder();
    const base = recorder();
    drawPerfHud(base.ctx, stats, { viewW: 800 });
    drawPerfHud(ctx, stats, {
      viewW: 800,
      net: { upMsgs: 30, downMsgs: 12, upBps: 2048, downBps: 512 },
    });
    // 4 frame lines vs 6 with net.
    expect(base.ctx.fillText.mock.calls.length).toBe(4);
    expect(ctx.fillText.mock.calls.length).toBe(6);
    // Wider box (176 vs 130).
    expect(rects[0][2]).toBe(176);
    const upLine = ctx.fillText.mock.calls[4][0] as string;
    expect(upLine).toContain("↑ 30/s");
    expect(upLine).toContain("2.0 KB/s");
  });
});
