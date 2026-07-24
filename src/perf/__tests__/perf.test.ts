import { describe, it, expect, vi } from "vitest";
import { createPerfTracker, createNetMeter, createSparkline, drawPerfHud } from "../index.js";

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

describe("createSparkline", () => {
  function recorder() {
    const rects: number[][] = [];
    const ctx = {
      fillStyle: "",
      fillRect: (x: number, y: number, w: number, h: number) => rects.push([x, y, w, h]),
    } as unknown as CanvasRenderingContext2D;
    return { ctx, rects };
  }

  it("draws nothing before any sample", () => {
    const { ctx, rects } = recorder();
    createSparkline().draw(ctx, 0, 0, 120, 18, "#fff");
    expect(rects).toEqual([]);
  });

  it("draws one bar per sample, right-aligned, scaled to the max", () => {
    const { ctx, rects } = recorder();
    const spark = createSparkline(4);
    spark.push(10);
    spark.push(20);
    spark.draw(ctx, 0, 0, 40, 20, "#fff");
    expect(rects.length).toBe(2);
    // bw = 40/4 = 10; two samples occupy the two rightmost slots.
    expect(rects[0][0]).toBe(20);
    expect(rects[1][0]).toBe(30);
    // 10 scales to half height (max 20), newest fills the full 20.
    expect(rects[0][3]).toBe(10);
    expect(rects[1][3]).toBe(20);
    // Bars grow up from the bottom edge.
    expect(rects[0][1]).toBe(10);
    expect(rects[1][1]).toBe(0);
  });

  it("overwrites oldest samples once capacity is reached", () => {
    const { ctx, rects } = recorder();
    const spark = createSparkline(2);
    spark.push(100); // evicted
    spark.push(10);
    spark.push(40);
    spark.draw(ctx, 0, 0, 20, 20, "#fff");
    expect(rects.length).toBe(2);
    expect(rects.map((r) => r[3])).toEqual([5, 20]); // scaled to max 40, not 100
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

  it("saves and restores ctx state so nothing leaks into the app's draw", () => {
    const { ctx } = recorder();
    drawPerfHud(ctx, stats, { viewW: 800 });
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it("anchors the box to the right edge by default", () => {
    const { ctx, rects } = recorder();
    drawPerfHud(ctx, stats, { viewW: 800 });
    // box width 148, right-anchored: bgX = 800 - 4 - 148 = 648
    expect(rects[0][0]).toBe(648);
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

  it("grows the box and draws a labeled strip when a sparkline is attached", () => {
    const plain = recorder();
    drawPerfHud(plain.ctx, stats, { viewW: 800 });

    const { ctx, rects } = recorder();
    const frame = createSparkline(4);
    frame.push(16);
    frame.push(17);
    drawPerfHud(ctx, stats, { viewW: 800, graphs: { frame } });
    // Taller background box (label 10 + graph 16 + gap 4) + the two bars.
    expect(rects[0][3]).toBe(plain.rects[0][3] + 30);
    expect(rects.length).toBe(1 + 2);
    // The strip is captioned.
    const labels = ctx.fillText.mock.calls.map((c) => c[0] as string);
    expect(labels).toContain("frame ms");
  });

  it("shows entity count and heap when given (and omits the line otherwise)", () => {
    const { ctx } = recorder();
    drawPerfHud(ctx, stats, { viewW: 800, entities: 240, heapMB: 117.6 });
    const lines = ctx.fillText.mock.calls.map((c) => c[0] as string);
    expect(lines).toContain("ents 240  heap 118 MB");

    const plain = recorder();
    drawPerfHud(plain.ctx, stats, { viewW: 800 });
    expect(plain.ctx.fillText.mock.calls.length).toBe(4);
  });

  it("shows the engine's update/draw cost when timings are given", () => {
    const { ctx } = recorder();
    drawPerfHud(ctx, stats, {
      viewW: 800,
      timings: { updateMs: 0.42, drawMs: 1.26, steps: 2 },
    });
    const lines = ctx.fillText.mock.calls.map((c) => c[0] as string);
    expect(lines).toContain("upd 0.4  drw 1.3 ms  ×2");
  });
});
