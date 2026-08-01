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
      const { ensureAudio } = await import("@src/audio/index.js");
      expect(ensureAudio()).toBeDefined();
    });
    it("reuses context", async () => {
      const { ensureAudio } = await import("@src/audio/index.js");
      expect(ensureAudio()).toBe(ensureAudio());
    });
  });

  describe("playSfx", () => {
    it("calls builder", async () => {
      const { playSfx } = await import("@src/audio/index.js");
      const b = vi.fn();
      playSfx(b);
      expect(b).toHaveBeenCalledOnce();
    });
    it("survives builder throw", async () => {
      const { playSfx } = await import("@src/audio/index.js");
      expect(() =>
        playSfx(() => {
          throw Error("x");
        }),
      ).not.toThrow();
    });
    it("survives missing AudioContext", async () => {
      vi.stubGlobal("AudioContext", undefined);
      const { playSfx } = await import("@src/audio/index.js");
      expect(() => playSfx(vi.fn())).not.toThrow();
    });
  });

  describe("Music", () => {
    it("Music starts unmuted", async () => {
      const mod = await import("@src/audio/index.js");
      expect(mod.Music.muted).toBe(false);
    });

    it("Music.muted toggles", async () => {
      const mod = await import("@src/audio/index.js");
      mod.Music.muted = false;
      expect(mod.Music.muted).toBe(false);
      mod.Music.muted = true;
      expect(mod.Music.muted).toBe(true);
    });

    it("Music.start activates", async () => {
      const mod = await import("@src/audio/index.js");
      vi.stubGlobal("setInterval", vi.fn());
      mod.Music.start({ volume: 0.1, bpm: 150, schedule: vi.fn() });
      expect(mod.Music.muted).toBe(false);
    });

    it("spaces steps by bpm / stepsPerBeat", async () => {
      const mod = await import("@src/audio/index.js");
      vi.stubGlobal("setInterval", vi.fn());
      const schedule = vi.fn();
      // 150 bpm at the default sixteenths → 100ms a step.
      mod.Music.start({ volume: 0.1, bpm: 150, schedule });
      const times = schedule.mock.calls.map(([, when]) => when as number);
      expect(schedule.mock.calls.map(([step]) => step)).toEqual([0, 1]);
      expect(times[1] - times[0]).toBeCloseTo(0.1);
    });

    it("stepsPerBeat stretches the step without touching the tempo", async () => {
      const mod = await import("@src/audio/index.js");
      vi.stubGlobal("setInterval", vi.fn());
      const schedule = vi.fn();
      // Same 150 bpm, but one call per beat → 400ms a step.
      mod.Music.start({ volume: 0.1, bpm: 150, stepsPerBeat: 1, schedule });
      expect(schedule).toHaveBeenCalledTimes(1); // only one step fits the lookahead
    });

    it("rejects a tempo that would never advance", async () => {
      const mod = await import("@src/audio/index.js");
      const schedule = vi.fn();
      expect(() => mod.Music.start({ volume: 0.1, bpm: 0, schedule })).toThrow(RangeError);
      expect(() => mod.Music.start({ volume: 0.1, bpm: -120, schedule })).toThrow(RangeError);
      expect(() => mod.Music.start({ volume: 0.1, bpm: 120, stepsPerBeat: 0, schedule })).toThrow(
        RangeError,
      );
    });
  });
});
