// ---------- Network CLI tests ----------
import { describe, expect, it } from "vitest";
import { diagnoseNetwork } from "@src/cli/features/net.js";

describe("mm net doctor", () => {
  it("is deterministic and recommends at least one snapshot interval", () => {
    const report = diagnoseNetwork({
      latency: 20,
      jitter: 8,
      loss: 5,
      rate: 20,
      seconds: 10,
      seed: 42,
    });

    expect(report.sent).toBe(200);
    expect(report.delivered).toBeLessThan(report.sent);
    expect(report.recommendedBufferMs).toBeGreaterThanOrEqual(50);
    expect(report).toEqual(
      diagnoseNetwork({
        latency: 20,
        jitter: 8,
        loss: 5,
        rate: 20,
        seconds: 10,
        seed: 42,
      }),
    );
  });
});
