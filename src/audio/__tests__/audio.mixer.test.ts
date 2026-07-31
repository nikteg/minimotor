import { beforeEach, describe, expect, it } from "vitest";
import { Mixer, Sfx, tone } from "../index.js";

// ---- Minimal Web Audio mock ----
// Records every connect() so we can assert graph wiring; AudioParams remember
// the last value set so ramp calls are observable.
class MockParam {
  value = 0;
  /** Every scheduled change, so tests can assert WHEN as well as what. */
  calls: Array<{ op: "set" | "lin" | "exp" | "target"; v: number; t: number }> = [];
  setValueAtTime(v: number, t = 0) {
    this.value = v;
    this.calls.push({ op: "set", v, t });
    return this;
  }
  setTargetAtTime(v: number, t = 0) {
    this.value = v;
    this.calls.push({ op: "target", v, t });
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
  linearRampToValueAtTime(v: number, t = 0) {
    this.value = v;
    this.calls.push({ op: "lin", v, t });
    return this;
  }
  exponentialRampToValueAtTime(v: number, t = 0) {
    this.value = v;
    this.calls.push({ op: "exp", v, t });
    return this;
  }
}

let nodeId = 0;
const connections: Array<{ from: number; to: number; toKind: string }> = [];
const created: MockNode[] = [];
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
  created.push(n);
  return n;
};

/** The most recently created node of a kind — the voice a `tone` call just built. */
const lastNode = (kind: string) =>
  [...created].reverse().find((n) => n.kind === kind) as unknown as {
    frequency: MockParam;
    gain: MockParam;
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
  createDynamicsCompressor() {
    return mockNode("compressor", {
      threshold: new MockParam(),
      ratio: new MockParam(),
      attack: new MockParam(),
      release: new MockParam(),
      knee: new MockParam(),
    });
  }
  createBuffer(channels: number, length: number) {
    return { numberOfChannels: channels, length, getChannelData: () => new Float32Array(length) };
  }
  createOscillator() {
    return mockNode("osc", {
      type: "sine",
      frequency: new MockParam(),
      detune: new MockParam(),
      start() {},
      stop() {},
    });
  }
  createBufferSource() {
    return mockNode("source", { buffer: null, loop: false, start() {}, stop() {} });
  }
  createStereoPanner() {
    return mockNode("panner", { pan: new MockParam() });
  }
}

beforeEach(() => {
  connections.length = 0;
  created.length = 0;
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

  it("inserts a master compressor/limiter", () => {
    Mixer.compressor({ ratio: 20, threshold: -12 });
    void Mixer.bus("chan4").input; // materialize the master path
    expect(connections.some((c) => c.toKind === "compressor")).toBe(true);
  });

  it("inserts a master filter into the master out chain", () => {
    const f = Mixer.masterFilter("lowpass", 500);
    void Mixer.bus("chan6").input; // materialize the master path
    const node = f.node as unknown as (MockNode & { type: string }) | null;
    expect(node).not.toBeNull();
    expect(node!.type).toBe("lowpass");
    // The filter feeds onward (→ compressor/destination), so it carries the mix.
    expect(connections.some((c) => c.from === node!.__id)).toBe(true);
    f.frequency(800); // crash-safe sweep
  });

  it("pans a bus, and only once someone asks for it", () => {
    const bus = Mixer.bus("chanPan");
    void bus.input; // materialize with no pan
    expect(connections.some((c) => c.toKind === "panner")).toBe(false);

    bus.setPan(-0.5);
    expect(bus.pan).toBe(-0.5);
    // The panner is spliced in at the end of the chain and carries the mix on.
    const panner = connections.find((c) => c.toKind === "panner");
    expect(panner).toBeDefined();
    expect(connections.some((c) => c.from === panner!.to)).toBe(true);

    bus.setPan(4); // clamped to the -1..1 the node accepts
    expect(bus.pan).toBe(1);
  });

  it("applies a pan set before the bus graph existed", () => {
    const bus = Mixer.bus("chanPanEarly");
    bus.setPan(1); // pre-materialize: recorded only
    expect(connections.some((c) => c.toKind === "panner")).toBe(false);
    void bus.input; // materialize — the pan comes along
    expect(connections.some((c) => c.toKind === "panner")).toBe(true);
    expect(bus.pan).toBe(1);
  });

  it("duck() is crash-safe and independent of channel volume", () => {
    const bus = Mixer.bus("chan5");
    bus.setVolume(0.7);
    void bus.input; // materialize
    bus.duck(0.5, { attackMs: 20, holdMs: 50, releaseMs: 150 });
    Mixer.duck("chan5", 0.3); // shorthand
    expect(bus.volume).toBe(0.7); // duck never overwrites the set volume
  });
});

describe("Audio.tone", () => {
  it("builds an oscillator voice graph (crash-safe)", () => {
    const before = connections.length;
    tone({ wave: "square", freq: 440, gain: 0.2, release: 0.1 });
    expect(connections.length).toBeGreaterThan(before); // wired osc → env → bus
  });

  it("runs the voice through a filter when given one", () => {
    connections.length = 0;
    tone({
      wave: "sine",
      freq: { from: 200, to: 800 },
      detune: [-5, 5],
      filter: { type: "lowpass", freq: 1000 },
    });
    expect(connections.some((c) => c.toKind === "biquad")).toBe(true);
  });

  it("places a single voice with `pan`, leaving centred voices alone", () => {
    connections.length = 0;
    tone({ wave: "square", freq: 440, pan: -0.8 });
    expect(connections.some((c) => c.toKind === "panner")).toBe(true);

    connections.length = 0;
    tone({ wave: "square", freq: 440 });
    expect(connections.some((c) => c.toKind === "panner")).toBe(false);
  });

  it("sweeps over `time` when given, and over the release when not", () => {
    tone({ wave: "square", freq: { from: 280, to: 620, time: 0.126 }, release: 0.18 });
    expect(lastNode("osc").frequency.calls).toEqual([
      { op: "set", v: 280, t: 0 },
      { op: "exp", v: 620, t: 0.126 },
    ]);

    tone({ wave: "square", freq: { from: 320, to: 50 }, release: 0.4 });
    expect(lastNode("osc").frequency.calls.at(-1)).toEqual({ op: "exp", v: 50, t: 0.4 });
  });

  it("jumps between keyframes by default and glides when asked", () => {
    // One voice, one envelope — the two-note pickup that a second layer would
    // otherwise re-attack.
    tone({ wave: "sine", freq: [{ value: 660 }, { value: 990, at: 0.07 }], release: 0.18 });
    expect(lastNode("osc").frequency.calls).toEqual([
      { op: "set", v: 660, t: 0 },
      { op: "set", v: 990, t: 0.07 },
    ]);

    tone({ wave: "sine", freq: [{ value: 200 }, { value: 400, at: 0.1, curve: "lin" }] });
    expect(lastNode("osc").frequency.calls.at(-1)).toEqual({ op: "lin", v: 400, t: 0.1 });
  });

  it("supports a noise source without throwing", () => {
    expect(() =>
      tone({ wave: "noise", release: 0.05, filter: { type: "highpass", freq: 8000 } }),
    ).not.toThrow();
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
