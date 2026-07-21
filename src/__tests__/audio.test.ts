import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock AudioContext
const createOsc = () => ({
  type: "sine" as OscillatorType,
  frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
  connect: vi.fn().mockReturnThis(),
  start: vi.fn(),
  stop: vi.fn(),
});
const createGain = () => ({
  gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
  connect: vi.fn().mockReturnThis(),
});

class MockCtx {
  state: AudioContextState = "running";
  currentTime = 0;
  sampleRate = 44100;
  destination = {} as AudioDestinationNode;
  createOscillator() {
    return createOsc() as unknown as OscillatorNode;
  }
  createGain() {
    return createGain() as unknown as GainNode;
  }
  createBuffer(_c: number, len: number, _sr: number) {
    return { getChannelData: () => new Float32Array(len) } as unknown as AudioBuffer;
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

beforeEach(() => {
  vi.stubGlobal("AudioContext", MockCtx);
  vi.resetModules();
});

describe("Audio", () => {
  describe("ensureAudio", () => {
    it("creates context", async () => {
      const { ensureAudio } = await import("../audio.js");
      expect(ensureAudio()).toBeDefined();
    });
    it("reuses context", async () => {
      const { ensureAudio } = await import("../audio.js");
      expect(ensureAudio()).toBe(ensureAudio());
    });
  });

  describe("playSfx", () => {
    it("calls builder", async () => {
      const { playSfx } = await import("../audio.js");
      const b = vi.fn();
      playSfx(b);
      expect(b).toHaveBeenCalledOnce();
    });
    it("survives builder throw", async () => {
      const { playSfx } = await import("../audio.js");
      expect(() =>
        playSfx(() => {
          throw Error("x");
        }),
      ).not.toThrow();
    });
    it("survives missing AudioContext", async () => {
      vi.stubGlobal("AudioContext", undefined);
      const { playSfx } = await import("../audio.js");
      expect(() => playSfx(vi.fn())).not.toThrow();
    });
  });

  describe("Music", () => {
    it("Music.on defaults to true", async () => {
      const mod = await import("../audio.js");
      expect(mod.Music.on).toBe(true);
    });

    it("Music.setOn toggles", async () => {
      const mod = await import("../audio.js");
      mod.Music.setOn(true);
      expect(mod.Music.on).toBe(true);
      mod.Music.setOn(false);
      expect(mod.Music.on).toBe(false);
    });

    it("Music.start activates", async () => {
      const mod = await import("../audio.js");
      vi.stubGlobal("setInterval", vi.fn());
      mod.Music.start({ volume: 0.1, stepMs: 100, schedule: vi.fn() });
      expect(mod.Music.on).toBe(true);
    });
  });
});
