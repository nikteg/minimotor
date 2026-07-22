import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { engine } from "../index.js";

// ---- Minimal Web Audio mock (just what engine() touches) ----
class MockParam {
  value = 0;
  setValueAtTime(v: number) {
    this.value = v;
    return this;
  }
  setTargetAtTime(v: number) {
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number) {
    this.value = v;
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}
const node = (extra: Record<string, unknown> = {}) => ({
  ...extra,
  connect(dest: unknown) {
    return dest;
  },
  disconnect() {},
});
class MockAudioContext {
  currentTime = 0;
  sampleRate = 44100;
  state = "running";
  destination = node();
  resume() {}
  createGain() {
    return node({ gain: new MockParam() });
  }
  createBiquadFilter() {
    return node({ type: "lowpass", frequency: new MockParam(), Q: new MockParam() });
  }
  createBuffer(_channels: number, length: number) {
    return { getChannelData: () => new Float32Array(length) };
  }
  createBufferSource() {
    return node({
      buffer: null,
      loop: false,
      playbackRate: new MockParam(),
      start() {},
      stop() {},
    });
  }
  createOscillator() {
    return node({
      type: "sine",
      frequency: new MockParam(),
      detune: new MockParam(),
      start() {},
      stop() {},
    });
  }
}

const win = window as unknown as { AudioContext: unknown };
const original = win.AudioContext;
afterEach(() => {
  win.AudioContext = original;
});

describe("Audio.engine", () => {
  beforeEach(() => {
    win.AudioContext = MockAudioContext;
  });

  it("returns a handle whose update/stop never throw", () => {
    const eng = engine({ idleHz: 40, revHz: 160, gears: 6 });
    // The handle builds its nodes lazily once the context is unlocked; a couple
    // of update() calls exercise the full node-graph wiring and param ramps.
    expect(() => eng.update({ throttle: 0, speed: 0, maxSpeed: 300 })).not.toThrow();
    expect(() =>
      eng.update({ throttle: 1, speed: 300, maxSpeed: 300, load: 1, slip: 1 }),
    ).not.toThrow();
    expect(() => eng.stop()).not.toThrow();
    // Post-stop updates are ignored, not fatal.
    expect(() => eng.update({ throttle: 1, speed: 100, maxSpeed: 300 })).not.toThrow();
  });

  it("is crash-safe with no AudioContext (silent no-op handle)", () => {
    win.AudioContext = undefined;
    const eng = engine();
    expect(() => eng.update({ throttle: 1, speed: 120, maxSpeed: 300 })).not.toThrow();
    expect(() => eng.stop()).not.toThrow();
  });
});
