import { beforeEach, describe, expect, it } from "vitest";
import { ensureAudio, music } from "@src/audio/index.js";

/** A `MusicHandle`'s `GainNode` does not exist until `play` has decoded the
 *  track and built the graph, so a level set before that has nowhere to land.
 *  These drive the real `music()` against a mock context and read the gain the
 *  voice actually comes up at. */

class MockParam {
  value = 0;
  setValueAtTime(v: number) {
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

const gains: { gain: MockParam }[] = [];

const node = (extra: Record<string, unknown> = {}) => ({
  ...extra,
  connect() {
    return this;
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
    const made = node({ gain: new MockParam() }) as unknown as { gain: MockParam };
    gains.push(made);
    return made;
  }
  createBiquadFilter() {
    return node({ type: "lowpass", frequency: new MockParam(), Q: new MockParam() });
  }
  createConvolver() {
    return node({ buffer: null });
  }
  createDelay() {
    return node({ delayTime: new MockParam() });
  }
  createDynamicsCompressor() {
    return node({
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
  createBufferSource() {
    return node({ buffer: null, loop: false, start() {}, stop() {}, onended: null });
  }
  createStereoPanner() {
    return node({ pan: new MockParam() });
  }
  decodeAudioData(data: ArrayBuffer) {
    return Promise.resolve({ duration: 1, length: data.byteLength, numberOfChannels: 1 });
  }
}

/** `start()` awaits `decodeAudioData`, so a play has to be given a turn of the
 * task queue before its graph exists. Returns the voice's OWN gain: the mixer
 * materializes buses out of gains too, and it does that lazily on the
 * `connect` that follows, so the voice is the FIRST gain of the play. */
async function started(play: () => void): Promise<{ gain: MockParam }> {
  const before = gains.length;
  play();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const voice = gains[before];
  if (!voice) throw new Error("the play built no gain node");
  return voice;
}

beforeEach(() => {
  gains.length = 0;
  (window as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext;
  ensureAudio();
});

describe("Audio.music volume", () => {
  it("comes up at the authored volume when nothing asks for another", async () => {
    const handle = music(new ArrayBuffer(8), { loop: true, volume: 0.3 });
    const voice = await started(() => handle.play());
    expect(voice.gain.value).toBeCloseTo(0.3, 6);
  });

  it("comes up at a level faded in BEFORE the first play", async () => {
    // The order a mixed game cue arrives in: work out the level, ask for it,
    // start the voice. The fade used to be dropped — there was no `GainNode`
    // yet — and the track then came up at its authored 0.3 instead of the 0.18
    // the caller had already computed, ignoring the player's own slider.
    const handle = music(new ArrayBuffer(8), { loop: true, volume: 0.3 });
    handle.fade(0.18, 0);
    const voice = await started(() => handle.play());
    expect(voice.gain.value).toBeCloseTo(0.18, 6);
  });

  it("keeps a level asked for while stopped, across the next play", async () => {
    const handle = music(new ArrayBuffer(8), { loop: true, volume: 0.3 });
    await started(() => handle.play());
    handle.stop();
    handle.fade(0.05, 0);
    const again = await started(() => handle.play());
    expect(again.gain.value).toBeCloseTo(0.05, 6);
  });

  it("still ramps a voice that is already sounding", async () => {
    const handle = music(new ArrayBuffer(8), { loop: true, volume: 0.3 });
    const voice = await started(() => handle.play());
    handle.fade(0.5, 0);
    expect(voice.gain.value).toBeCloseTo(0.5, 6);
  });
});
