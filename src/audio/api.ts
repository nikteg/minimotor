// ---------- The Audio surface (API_PLAN #35–#38) ----------
// Typed sfx maps, tweakable recipes, buffer music, and buses:
//
//   const sfx = Audio.sfx({
//     jump: { shape: "square", freq: { from: 520, to: 880 }, ms: 90, volume: 0.4 },
//     coin: Audio.recipes.coin(),
//   });
//   sfx.jump.play();
//   sfx.coin.play({ pitch: [0.95, 1.15] });      // tuple = per-play jitter
//
//   const music = Audio.music(art.theme, { loop: true, volume: 0.5 });
//   music.play();  music.fade(0.15, 200);        // ducking = scene policy
//
//   Audio.buses.music.volume = 0.6;              // settings-screen knobs
//   Audio.buses.music.duckUnder(Audio.buses.sfx, { amount: 0.3 });
//
// The unlock ceremony is invisible (#35): the first pointer/key gesture
// unlocks the context. Pre-unlock one-shots drop with a dev warn (a stale
// blip is worse than silence); a pre-unlock `music.play()` starts on unlock.
// Audio runs in REAL time — deliberately outside the clock system (#37).

import { audioCtx, ensureAudio } from "./context.js";
import { tone, type ToneOptions, type ToneSweep } from "./sfx.js";
import { Mixer } from "./mixer.js";

// ---------- Unlock ----------

let unlockWired = false;
let unlocked = false;
const onUnlock: (() => void)[] = [];

function wireUnlock(): void {
  if (unlockWired || typeof window === "undefined") return;
  unlockWired = true;
  const unlock = () => {
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
    unlocked = true;
    try {
      ensureAudio();
    } catch {
      /* no WebAudio (tests) */
    }
    for (const fn of onUnlock.splice(0)) fn();
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

function isUnlocked(): boolean {
  return unlocked || audioCtx?.state === "running";
}

// ---------- Buses ----------

/** A well-known mixer knob. The defaults (`Audio.master`, `Audio.buses.sfx`,
 *  `Audio.buses.music`) always exist — a settings screen is three sliders +
 *  `Storage`, zero plumbing. Custom buses via `Audio.bus`. */
export interface BusHandle {
  readonly name: string;
  /** Channel volume 0..1 (click-free). */
  volume: number;
  /** Mute without losing the volume setting. */
  muted: boolean;
  /** Ramp the volume over `ms` — pause-menu ducking is
   *  `music.fade(...)` or a bus fade in scene hooks. */
  fade(volume: number, ms: number): void;
  /** Declarative side-chain: dip THIS bus whenever a sound plays on
   *  `trigger` (via the Audio.sfx/music surface). */
  duckUnder(trigger: BusHandle, opts?: { amount?: number; ms?: number }): void;
}

interface DuckRule {
  target: string;
  amount: number;
  ms: number;
}
const duckRules = new Map<string, DuckRule[]>(); // trigger bus → rules

function fireDucks(triggerBus: string): void {
  const rules = duckRules.get(triggerBus);
  if (!rules) return;
  for (const rule of rules) {
    Mixer.bus(rule.target).duck(rule.amount, { holdMs: rule.ms });
  }
}

function busHandle(name: string): BusHandle {
  return {
    name,
    get volume() {
      return Mixer.bus(name).volume;
    },
    set volume(v: number) {
      Mixer.bus(name).setVolume(v);
    },
    get muted() {
      return !Mixer.bus(name).on;
    },
    set muted(m: boolean) {
      Mixer.bus(name).setOn(!m);
    },
    fade(volume, ms) {
      Mixer.bus(name).setVolume(volume, ms);
    },
    duckUnder(trigger, opts = {}) {
      const rules = duckRules.get(trigger.name) ?? [];
      rules.push({ target: name, amount: opts.amount ?? 0.5, ms: opts.ms ?? 300 });
      duckRules.set(trigger.name, rules);
    },
  };
}

/** The default buses — platform knobs that always exist. */
export const buses = {
  sfx: busHandle("sfx"),
  music: busHandle("music"),
};

/** The master output. */
export const master = {
  get volume(): number {
    return Mixer.masterVolume;
  },
  set volume(v: number) {
    Mixer.setMasterVolume(v);
  },
  get muted(): boolean {
    return !Mixer.on;
  },
  set muted(m: boolean) {
    Mixer.setOn(!m);
  },
};

/** A custom content bus (cave reverb, radio filter). */
export function bus(name: string, opts: { lowpass?: number; reverb?: number } = {}): BusHandle {
  const b = Mixer.bus(name);
  if (opts.lowpass !== undefined) b.addFilter("lowpass", opts.lowpass);
  if (opts.reverb !== undefined) {
    Mixer.reverb(`${name}:reverb`, { wet: opts.reverb });
    b.send(`${name}:reverb`, opts.reverb);
  }
  return busHandle(name);
}

/** The raw AudioContext — the drop-to-WebAudio escape hatch. Null until the
 *  first unlock/use. */
export function raw(): AudioContext | null {
  return audioCtx;
}

// ---------- Sfx: typed maps of synth specs ----------

/** A synth sound as plain, tweakable DATA. Directional values are
 *  `{ from, to }`; `[min, max]` tuples are reserved for per-play randomness
 *  (see `PlayOptions.pitch`). */
export interface SfxSpec {
  /** Oscillator shape. Default "sine". */
  shape?: OscillatorType;
  /** Filtered noise instead of an oscillator (hits, whooshes). */
  noise?: boolean;
  /** Pitch in Hz — constant or a `{ from, to }` sweep. */
  freq?: number | { from: number; to: number };
  /** Length in ms (the envelope's release). Default 250. */
  ms?: number;
  /** Peak level 0..1. Default 0.3. */
  volume?: number;
  /** Optional filter; `freq` may sweep. */
  filter?: { type: BiquadFilterType; freq?: ToneSweep; q?: number };
  /** Extra detuned unison voices, in cents. */
  detune?: number[];
  /** Extra layered voices (chords, sparkles), each with its own delay. */
  layers?: Array<Omit<SfxSpec, "layers"> & { delayMs?: number }>;
}

export interface PlayOptions {
  /** Playback-rate style pitch multiplier; a `[min, max]` tuple rolls a
   *  fresh jitter per play (footsteps, coins). */
  pitch?: number | [number, number];
  /** Override the spec's volume for this play. */
  volume?: number;
  /** Route to a different bus for this play. */
  bus?: BusHandle;
}

export interface SfxHandle {
  play(opts?: PlayOptions): void;
  /** The spec — plain data; tweak it or serialize it. */
  readonly spec: SfxSpec;
}

function scaleFreq(
  freq: number | { from: number; to: number } | undefined,
  k: number,
): ToneSweep | undefined {
  if (freq === undefined) return undefined;
  if (typeof freq === "number") return freq * k;
  return { from: freq.from * k, to: freq.to * k };
}

function playSpec(spec: SfxSpec, opts: PlayOptions, busName: string, delayS = 0): void {
  const k =
    typeof opts.pitch === "number"
      ? opts.pitch
      : Array.isArray(opts.pitch)
        ? opts.pitch[0] + Math.random() * (opts.pitch[1] - opts.pitch[0])
        : 1;
  const t: ToneOptions = {
    wave: spec.noise ? "noise" : (spec.shape ?? "sine"),
    freq: scaleFreq(spec.freq, k),
    gain: opts.volume ?? spec.volume ?? 0.3,
    release: Math.max(0.01, (spec.ms ?? 250) / 1000),
    filter: spec.filter,
    detune: spec.detune,
    bus: busName,
    delay: delayS,
  };
  tone(t);
  for (const layer of spec.layers ?? []) {
    playSpec(
      layer,
      { ...opts, volume: opts.volume ?? layer.volume },
      busName,
      (layer.delayMs ?? 0) / 1000,
    );
  }
}

/** Build a typed sfx map: keys become handles (`sfx.jump.play()`). */
export function sfx<K extends string>(
  map: Record<K, SfxSpec>,
  opts: { bus?: BusHandle } = {},
): Record<K, SfxHandle> {
  wireUnlock();
  const defaultBus = opts.bus ?? buses.sfx;
  const out = {} as Record<K, SfxHandle>;
  for (const name of Object.keys(map) as K[]) {
    const spec = map[name];
    out[name] = {
      spec,
      play(playOpts = {}) {
        if (!isUnlocked()) {
          console.warn(`Minimotor.Audio: "${name}" dropped — audio unlocks on the first gesture`);
          return;
        }
        const busName = (playOpts.bus ?? defaultBus).name;
        playSpec(spec, playOpts, busName);
        fireDucks(busName);
      },
    };
  }
  return out;
}

// ---------- Recipes: classic effects as tweakable specs ----------

/** Classic sound-effect building blocks. Each returns a plain `SfxSpec` —
 *  inspect it, spread it, tweak any field:
 *
 *    coin: Audio.recipes.coin(),
 *    boom: { ...Audio.recipes.explosion(), ms: 400 }, */
export const recipes = {
  coin: (): SfxSpec => ({
    shape: "sine",
    freq: 988,
    ms: 220,
    volume: 0.25,
    layers: [{ shape: "sine", freq: 1319, ms: 250, volume: 0.25, delayMs: 80 }],
  }),
  jump: (): SfxSpec => ({ shape: "triangle", freq: { from: 220, to: 660 }, ms: 180, volume: 0.3 }),
  hit: (): SfxSpec => ({
    noise: true,
    ms: 120,
    volume: 0.4,
    filter: { type: "lowpass", freq: { from: 2000, to: 200 } },
  }),
  explosion: (): SfxSpec => ({
    noise: true,
    ms: 500,
    volume: 0.5,
    filter: { type: "lowpass", freq: { from: 1200, to: 80 } },
  }),
  laser: (): SfxSpec => ({
    shape: "sawtooth",
    freq: { from: 1800, to: 220 },
    ms: 150,
    volume: 0.3,
  }),
  powerup: (): SfxSpec => ({
    shape: "square",
    freq: { from: 440, to: 1760 },
    ms: 320,
    volume: 0.3,
  }),
  blip: (): SfxSpec => ({ shape: "square", freq: 880, ms: 80, volume: 0.25 }),
  click: (): SfxSpec => ({
    noise: true,
    ms: 35,
    volume: 0.2,
    filter: { type: "highpass", freq: 5000 },
  }),
  whoosh: (): SfxSpec => ({
    noise: true,
    ms: 260,
    volume: 0.3,
    filter: { type: "bandpass", freq: { from: 400, to: 2400 }, q: 1.5 },
  }),
};

// ---------- Engine sound: a looping, revving motor ----------

export interface EngineOptions {
  /** Pitch (Hz) at idle. Default 42. */
  idleHz?: number;
  /** Pitch (Hz) at redline. Default 165. */
  revHz?: number;
  /** Gear count — rev sweeps up then snaps down per gear. Default 5. */
  gears?: number;
  /** How aggressively load pulls the pitch up (0..2). Default 1. */
  drive?: number;
  /** Overall level 0..1. Default 0.5. */
  volume?: number;
  /** Bus to route through. Default the sfx bus. */
  bus?: BusHandle;
}

/** Per-frame engine telemetry. All optional; sensible zero defaults. */
export interface EngineDrive {
  /** Accelerator 0..1 — drives the audible load/volume. */
  throttle?: number;
  /** Current speed and its max, mapped to the gear/rev curve. */
  speed?: number;
  maxSpeed?: number;
  /** Explicit engine load 0..1 (overrides throttle for volume when given). */
  load?: number;
  /** Tyre slip 0..1 — adds a bit of noisy grit (screech). */
  slip?: number;
}

export interface EngineHandle {
  /** Feed telemetry each frame; pitch/gain follow (click-free ramps). */
  update(drive: EngineDrive): void;
  /** Silence and tear down the oscillators. */
  stop(): void;
}

/** A continuous, gear-shifting engine drone built from a detuned sawtooth pair
 *  through a low-pass, plus a slip-driven noise layer. Persistent (unlike the
 *  one-shot `sfx`) — real-time, outside the clock system. Feed it telemetry:
 *
 *    const engine = Audio.engine({ gears: 6 });
 *    // each frame: engine.update({ throttle, speed: car.speed, maxSpeed, slip }); */
export function engine(opts: EngineOptions = {}): EngineHandle {
  wireUnlock();
  const idleHz = opts.idleHz ?? 42;
  const revHz = opts.revHz ?? 165;
  const gears = Math.max(1, opts.gears ?? 5);
  const drive = opts.drive ?? 1;
  const volume = opts.volume ?? 0.5;
  const busName = (opts.bus ?? buses.sfx).name;

  interface Nodes {
    ctx: AudioContext;
    oscA: OscillatorNode;
    oscB: OscillatorNode;
    lp: BiquadFilterNode;
    gain: GainNode;
    noise: AudioBufferSourceNode;
    noiseGain: GainNode;
  }
  let n: Nodes | null = null;
  let stopped = false;

  function build(): Nodes | null {
    try {
      const ctx = ensureAudio();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1400;
      lp.connect(gain);
      gain.connect(Mixer.bus(busName).input);
      const oscA = ctx.createOscillator();
      const oscB = ctx.createOscillator();
      oscA.type = oscB.type = "sawtooth";
      oscB.detune.value = -12;
      oscA.connect(lp);
      oscB.connect(lp);
      oscA.start();
      oscB.start();
      // Slip grit: white noise through the same low-pass, its own gain.
      const noiseGain = ctx.createGain();
      noiseGain.gain.value = 0;
      noiseGain.connect(lp);
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      noise.loop = true;
      noise.connect(noiseGain);
      noise.start();
      return { ctx, oscA, oscB, lp, gain, noise, noiseGain };
    } catch {
      return null; // no WebAudio — silent, non-fatal
    }
  }

  return {
    update(d) {
      if (stopped) return;
      if (!n && isUnlocked()) n = build();
      if (!n) return;
      const throttle = Math.max(0, Math.min(1, d.throttle ?? 0));
      const norm = d.maxSpeed ? Math.max(0, Math.min(1, (d.speed ?? 0) / d.maxSpeed)) : 0;
      const load = Math.max(0, Math.min(1, d.load ?? throttle));
      const slip = Math.max(0, Math.min(1, d.slip ?? 0));
      // Rev = fractional position within the current gear (snaps down on shift).
      const gearRev = (norm * gears) % 1;
      const hz = idleHz + (revHz - idleHz) * (0.25 + 0.75 * gearRev) * (0.6 + 0.4 * drive * load);
      const t = n.ctx.currentTime;
      const rampTo = (p: AudioParam, v: number) => {
        p.cancelScheduledValues(t);
        p.setValueAtTime(p.value, t);
        p.linearRampToValueAtTime(v, t + 0.05);
      };
      rampTo(n.oscA.frequency, hz);
      rampTo(n.oscB.frequency, hz);
      rampTo(n.lp.frequency, 700 + 1800 * load);
      rampTo(n.gain.gain, volume * (0.12 + 0.5 * load));
      rampTo(n.noiseGain.gain, volume * 0.25 * slip);
    },
    stop() {
      stopped = true;
      if (!n) return;
      try {
        n.oscA.stop();
        n.oscB.stop();
        n.noise.stop();
        n.gain.disconnect();
      } catch {
        /* already torn down */
      }
      n = null;
    },
  };
}

// ---------- Music: a decoded track on the music bus ----------

export interface MusicOptions {
  loop?: boolean;
  /** Track volume 0..1 (its own gain, under the music bus). Default 1. */
  volume?: number;
}

export interface MusicHandle {
  /** Start (idempotent — already-playing is a no-op). Called before the
   *  first gesture, it starts automatically on unlock. */
  play(): void;
  stop(): void;
  /** Ramp THIS track's volume over `ms` (scene-hook ducking). */
  fade(volume: number, ms: number): void;
  readonly playing: boolean;
}

/** A music track from a loaded asset (`Assets.load` audio entries are
 *  ArrayBuffers, decoded lazily here). */
export function music(data: ArrayBuffer, opts: MusicOptions = {}): MusicHandle {
  wireUnlock();
  let source: AudioBufferSourceNode | null = null;
  let gain: GainNode | null = null;
  let decoded: AudioBuffer | null = null;
  let wantPlaying = false;
  let starting = false;

  async function start(): Promise<void> {
    if (source || starting || !wantPlaying) return;
    starting = true;
    try {
      const ctx = ensureAudio();
      decoded ??= await ctx.decodeAudioData(data.slice(0));
      if (!wantPlaying || source) return;
      gain = ctx.createGain();
      gain.gain.value = opts.volume ?? 1;
      gain.connect(Mixer.bus("music").input);
      source = ctx.createBufferSource();
      source.buffer = decoded;
      source.loop = opts.loop ?? false;
      source.connect(gain);
      source.onended = () => {
        if (!source?.loop) {
          source = null;
          wantPlaying = false;
        }
      };
      source.start();
      fireDucks("music");
    } catch {
      wantPlaying = false; // no WebAudio — stay silent, stay alive
    } finally {
      starting = false;
    }
  }

  return {
    play() {
      if (wantPlaying) return; // idempotent
      wantPlaying = true;
      if (isUnlocked()) void start();
      else onUnlock.push(() => void start());
    },
    stop() {
      wantPlaying = false;
      source?.stop();
      source = null;
    },
    fade(volume, ms) {
      const ctx = audioCtx;
      if (!gain || !ctx) return;
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + ms / 1000);
    },
    get playing() {
      return source !== null;
    },
  };
}
