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
    // Every test builds its OWN channel — a music channel is per-app, and the
    // isolation tests below are the reason the module no longer has a singleton
    // to reach for.
    const channel = async (name = "music") => {
      const mod = await import("@src/audio/index.js");
      return mod.createMusicChannel(mod.Mixer.bus(name));
    };

    it("starts unmuted", async () => {
      expect((await channel()).muted).toBe(false);
    });

    it("muted toggles", async () => {
      const music = await channel();
      music.muted = false;
      expect(music.muted).toBe(false);
      music.muted = true;
      expect(music.muted).toBe(true);
    });

    it("start activates", async () => {
      const music = await channel();
      vi.stubGlobal("setInterval", vi.fn());
      music.start({ volume: 0.1, bpm: 150, schedule: vi.fn() });
      expect(music.muted).toBe(false);
    });

    it("spaces steps by bpm / stepsPerBeat", async () => {
      const music = await channel();
      vi.stubGlobal("setInterval", vi.fn());
      const schedule = vi.fn();
      // 150 bpm at the default sixteenths → 100ms a step.
      music.start({ volume: 0.1, bpm: 150, schedule });
      const times = schedule.mock.calls.map(([, when]) => when as number);
      expect(schedule.mock.calls.map(([step]) => step)).toEqual([0, 1]);
      expect(times[1] - times[0]).toBeCloseTo(0.1);
    });

    it("stepsPerBeat stretches the step without touching the tempo", async () => {
      const music = await channel();
      vi.stubGlobal("setInterval", vi.fn());
      const schedule = vi.fn();
      // Same 150 bpm, but one call per beat → 400ms a step.
      music.start({ volume: 0.1, bpm: 150, stepsPerBeat: 1, schedule });
      expect(schedule).toHaveBeenCalledTimes(1); // only one step fits the lookahead
    });

    it("rejects a tempo that would never advance", async () => {
      const music = await channel();
      const schedule = vi.fn();
      expect(() => music.start({ volume: 0.1, bpm: 0, schedule })).toThrow(RangeError);
      expect(() => music.start({ volume: 0.1, bpm: -120, schedule })).toThrow(RangeError);
      expect(() => music.start({ volume: 0.1, bpm: 120, stepsPerBeat: 0, schedule })).toThrow(
        RangeError,
      );
    });

    it("stop lets a later start run again from step 0", async () => {
      const music = await channel();
      vi.stubGlobal("setInterval", vi.fn());
      const first = vi.fn();
      music.start({ volume: 0.1, bpm: 150, schedule: first });
      expect(first.mock.calls.map(([step]) => step)).toEqual([0, 1]);
      music.stop();
      const second = vi.fn();
      music.start({ volume: 0.1, bpm: 150, schedule: second });
      expect(second.mock.calls.map(([step]) => step)).toEqual([0, 1]);
    });

    it("two channels keep their own mute, tempo and step counter", async () => {
      vi.stubGlobal("setInterval", vi.fn());
      const a = await channel("game-a:music");
      const b = await channel("game-b:music");

      const scheduleA = vi.fn();
      const scheduleB = vi.fn();
      // 150 bpm sixteenths (100ms) vs 60 bpm sixteenths (250ms) — different
      // tempos means a different number of steps fits the same lookahead.
      a.start({ volume: 0.1, bpm: 150, schedule: scheduleA });
      b.start({ volume: 0.1, bpm: 60, schedule: scheduleB });
      expect(scheduleA).toHaveBeenCalledTimes(2);
      expect(scheduleB).toHaveBeenCalledTimes(1);

      a.muted = true;
      expect(a.muted).toBe(true);
      expect(b.muted).toBe(false);
    });

    it("the second app's start is not swallowed by the first's", async () => {
      vi.stubGlobal("setInterval", vi.fn());
      const a = await channel("game-a:music");
      const b = await channel("game-b:music");
      a.start({ volume: 0.1, bpm: 150, schedule: vi.fn() });
      const scheduleB = vi.fn();
      b.start({ volume: 0.1, bpm: 150, schedule: scheduleB });
      expect(scheduleB).toHaveBeenCalled();
    });
  });

  describe("page-level side effects", () => {
    it("importing the module registers no document listener", async () => {
      const add = vi.spyOn(document, "addEventListener");
      await import("@src/audio/index.js");
      expect(add).not.toHaveBeenCalledWith("visibilitychange", expect.anything());
      add.mockRestore();
    });

    it("the visibility listener is wired on the first start and dropped on the last stop", async () => {
      vi.stubGlobal("setInterval", vi.fn());
      const add = vi.spyOn(document, "addEventListener");
      const remove = vi.spyOn(document, "removeEventListener");
      const mod = await import("@src/audio/index.js");
      const a = mod.createMusicChannel(mod.Mixer.bus("game-a:music"));
      const b = mod.createMusicChannel(mod.Mixer.bus("game-b:music"));

      a.start({ volume: 0.1, bpm: 150, schedule: vi.fn() });
      b.start({ volume: 0.1, bpm: 150, schedule: vi.fn() });
      // One listener drives every running channel, not one per channel.
      const wires = add.mock.calls.filter(([type]) => type === "visibilitychange");
      expect(wires).toHaveLength(1);

      a.stop();
      expect(remove).not.toHaveBeenCalledWith("visibilitychange", expect.anything());
      b.stop();
      expect(remove).toHaveBeenCalledWith("visibilitychange", expect.anything());

      add.mockRestore();
      remove.mockRestore();
    });
  });
});
