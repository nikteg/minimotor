import { beforeEach, describe, expect, it } from "vitest";
import { Mixer, Sfx } from "./audio.js";

// ---- Minimal Web Audio mock ----
// Records every connect() so we can assert graph wiring; AudioParams remember
// the last value set so ramp calls are observable.
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
  cancelScheduledValues() {
    return this;
  }
  linearRampToValueAtTime(v: number) {
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime(v: number) {
    this.value = v;
    return this;
  }
}

let nodeId = 0;
const connections: Array<{ from: number; to: number; toKind: string }> = [];
type MockNode = {
  __id: number;
  kind: string;
  connect: (d: MockNode) => MockNode;
  disconnect: () => void;
};
const mockNode = (kind: string, extra: Record<string, unknown> = {}): MockNode => {
  const n = {
    __id: ++nodeId,
    kind,
    ...extra,
    connect(dest: MockNode) {
      connections.push({ from: n.__id, to: dest.__id, toKind: dest.kind });
      return dest;
    },
    disconnect() {},
  } as unknown as MockNode;
  return n;
};

class MockAudioContext {
  currentTime = 0;
  sampleRate = 44100;
  state = "running";
  destination = mockNode("destination");
  resume() {}
  createGain() {
    return mockNode("gain", { gain: new MockParam() });
  }
  createBiquadFilter() {
    return mockNode("biquad", {
      type: "lowpass",
      frequency: new MockParam(),
      Q: new MockParam(),
      gain: new MockParam(),
    });
  }
  createConvolver() {
    return mockNode("convolver", { buffer: null });
  }
  createDelay() {
    return mockNode("delay", { delayTime: new MockParam() });
  }
  createBuffer(channels: number, length: number) {
    return { numberOfChannels: channels, length, getChannelData: () => new Float32Array(length) };
  }
}

beforeEach(() => {
  connections.length = 0;
  (window as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext;
});

describe("Audio.Mixer", () => {
  it("returns the same bus/effect per name", () => {
    expect(Mixer.bus("music")).toBe(Mixer.bus("music"));
    expect(Mixer.bus("busA")).not.toBe(Mixer.bus("busB"));
    expect(Mixer.reverb("hallX")).toBe(Mixer.reverb("hallX"));
  });

  it("volume/mute setters are crash-safe and record on the live gain", () => {
    const bus = Mixer.bus("chan1");
    bus.setVolume(0.5); // pre-materialize: just records
    void bus.input; // materialize the graph
    bus.setVolume(0.25);
    bus.setOn(false);
    expect(bus.volume).toBe(0.25);
    expect(bus.on).toBe(false);
    Mixer.setMasterVolume(0.8);
    Mixer.setOn(false);
    expect(Mixer.on).toBe(false);
    Mixer.setOn(true);
  });

  it("inserts a dynamic filter into the chain and sweeps it live", () => {
    const bus = Mixer.bus("chan2");
    const lp = bus.addFilter("lowpass", 800, 0.7);
    const input = bus.input as unknown as MockNode; // materialize
    const node = lp.node as unknown as (MockNode & { type: string; frequency: MockParam }) | null;
    expect(node).not.toBeNull();
    expect(node!.type).toBe("lowpass");
    expect(node!.frequency.value).toBe(800);
    // input feeds the filter (chain: input → filter → gain).
    expect(connections.some((c) => c.from === input.__id && c.to === node!.__id)).toBe(true);
    lp.frequency(300);
    expect(node!.frequency.value).toBe(300);
  });

  it("routes an aux send into a reverb (convolver) effect", () => {
    Mixer.reverb("hall2", { seconds: 0.05, wet: 0.4 });
    const bus = Mixer.bus("chan3");
    bus.send("hall2", 0.5);
    void bus.input; // materialize bus + wire the send
    expect(connections.some((c) => c.toKind === "convolver")).toBe(true);
  });

  it("delay effect exposes time/feedback/wet setters (crash-safe)", () => {
    const echo = Mixer.delay("echo2", { time: 0.2 });
    void echo.input; // materialize
    echo.setTime(0.4);
    echo.setFeedback(0.25);
    echo.setWet(0.5);
    expect(echo.wet).toBe(0.5);
  });
});

describe("Audio.Sfx delegates to the sfx bus", () => {
  it("on/volume flow through Mixer.bus('sfx')", () => {
    Sfx.setVolume(0.6);
    Sfx.setOn(false);
    expect(Sfx.on).toBe(false);
    expect(Mixer.bus("sfx").on).toBe(false);
    Sfx.setOn(true);
  });
});
