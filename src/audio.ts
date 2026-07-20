// ---------- Audio support ----------
// WebAudio helpers: crash-safe sound effects and a scheduled music
// player. The game provides melodies/song structure; the engine
// manages AudioContext, timing, volume and pause on hidden tab.

/** Builds one sound effect. Route nodes into `out` (the master SFX bus, so
 *  `Sfx.setOn`/`setVolume` apply); older builders that connect straight to
 *  `ctx.destination` keep working but bypass the bus. */
export type SfxBuilder = (ctx: AudioContext, now: number, out: AudioNode) => void;

let audioCtx: AudioContext | null = null;

// Lazy init: AudioContext must not be created before a user gesture,
// so always call via playSfx/Music.start (which runs on first action).
export function ensureAudio(): AudioContext {
  if (!audioCtx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new AC();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

// ---------- Mixer ----------
// A small routing mixer over Web Audio. Named channel BUSES feed a MASTER bus
// (→ destination); each bus carries dynamic biquad FILTERS and can aux-SEND
// (post-fader) into shared EFFECTS — a generated-impulse reverb and a feedback
// delay. Everything materializes lazily on first use (after a gesture unlocks
// the context) and every control is crash-safe: before the graph exists a
// setter just records state, then ramps the live node once it's built. `Sfx`
// and `Music` are simply the built-in "sfx" and "music" buses.

/** Click-free parameter change: ramp toward `target` over ~`rampMs` (0 = jump).
 *  `setTargetAtTime` reaches ~95% of the target in three time-constants. */
function rampParam(param: AudioParam, target: number, rampMs: number): void {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  param.cancelScheduledValues(now);
  if (rampMs > 0) param.setTargetAtTime(target, now, rampMs / 3000);
  else param.setValueAtTime(target, now);
}

let masterGain: GainNode | null = null;
let masterVolume = 1;
let masterOn = true;
interface CompSpec {
  threshold: number;
  ratio: number;
  attack: number;
  release: number;
  knee: number;
}
let compSpec: CompSpec | null = null;
let masterComp: DynamicsCompressorNode | null = null;
const masterFilters: FilterState[] = [];

// Route the master gain to the destination through any master filters and the
// compressor/limiter: masterGain → [filters] → [compressor] → destination.
// Called on master creation and whenever a filter/compressor is (re)configured,
// so they can be inserted after the graph already exists.
function wireMasterOut(ctx: AudioContext): void {
  if (!masterGain) return;
  try {
    masterGain.disconnect();
  } catch {
    /* not yet connected */
  }
  let node: AudioNode = masterGain;
  for (const f of masterFilters) {
    if (!f.node) {
      f.node = ctx.createBiquadFilter();
      f.node.type = f.type;
      f.node.frequency.value = f.frequency;
      f.node.Q.value = f.q;
      f.node.gain.value = f.gain;
    } else {
      try {
        f.node.disconnect();
      } catch {
        /* ok */
      }
    }
    node.connect(f.node);
    node = f.node;
  }
  if (compSpec) {
    if (!masterComp) masterComp = ctx.createDynamicsCompressor();
    masterComp.threshold.value = compSpec.threshold;
    masterComp.ratio.value = compSpec.ratio;
    masterComp.attack.value = compSpec.attack;
    masterComp.release.value = compSpec.release;
    masterComp.knee.value = compSpec.knee;
    try {
      masterComp.disconnect();
    } catch {
      /* ok */
    }
    node.connect(masterComp);
    masterComp.connect(ctx.destination);
  } else {
    node.connect(ctx.destination);
  }
}

function ensureMaster(ctx: AudioContext): GainNode {
  if (!masterGain) {
    masterGain = ctx.createGain();
    masterGain.gain.value = masterOn ? masterVolume : 0;
    wireMasterOut(ctx);
  }
  return masterGain;
}

/** A dynamic biquad filter inserted on a bus. The setters sweep the live node
 *  click-free (default instant), so you can muffle/EQ a channel over time. */
export interface Filter {
  /** The live node, or null until the bus graph is materialized. */
  readonly node: BiquadFilterNode | null;
  /** Cutoff / centre frequency in Hz. */
  frequency(hz: number, rampMs?: number): void;
  /** Q / resonance. */
  q(value: number, rampMs?: number): void;
  /** Gain in dB (peaking / shelf types only). */
  gain(db: number, rampMs?: number): void;
}

/** A mixer channel: sources connect to `input`, then flow through any inserted
 *  filters and the channel gain into the master bus. */
export interface Bus {
  readonly name: string;
  /** Head of the chain — connect sound sources here. */
  readonly input: AudioNode;
  /** Channel volume 0..1 (click-free ramp, default 20ms). */
  setVolume(v: number, rampMs?: number): void;
  readonly volume: number;
  /** Mute/unmute without losing the volume setting. */
  setOn(on: boolean, rampMs?: number): void;
  readonly on: boolean;
  /** Insert a dynamic biquad filter (input → filters… → gain); returns a handle
   *  to sweep it live. */
  addFilter(type: BiquadFilterType, frequency?: number, q?: number): Filter;
  /** Remove every inserted filter. */
  clearFilters(): void;
  /** Aux-send this bus (post-fader) into a named effect at `level` (0..1).
   *  Create the effect first with `Mixer.reverb` / `Mixer.delay`. */
  send(effect: string, level: number, rampMs?: number): void;
  /** Momentarily dip this bus by `amount` (0..1) then restore — a game-style
   *  side-chain duck (e.g. duck the music while a big SFX plays). Independent
   *  of the channel volume, so it never overwrites your `setVolume`. */
  duck(amount: number, opts?: { attackMs?: number; holdMs?: number; releaseMs?: number }): void;
}

/** A shared effect that buses send into; its wet output returns to the master. */
export interface Effect {
  readonly name: string;
  /** The effect's input node (buses' sends connect here). */
  readonly input: AudioNode;
  /** Wet output level 0..1. */
  setWet(level: number, rampMs?: number): void;
  readonly wet: number;
}

/** A feedback delay/echo effect. */
export interface DelayEffect extends Effect {
  setTime(seconds: number, rampMs?: number): void;
  setFeedback(amount: number, rampMs?: number): void;
}

interface FilterState {
  type: BiquadFilterType;
  frequency: number;
  q: number;
  gain: number;
  node: BiquadFilterNode | null;
}
interface SendState {
  level: number;
  node: GainNode | null;
}

const buses = new Map<string, Bus>();
const effects = new Map<string, Effect>();

function createBus(name: string): Bus {
  let volume = 1;
  let on = true;
  let inputNode: GainNode | null = null;
  let gainNode: GainNode | null = null;
  let duckGain: GainNode | null = null; // transient side-chain dip, post-volume
  const filters: FilterState[] = [];
  const sends = new Map<string, SendState>();

  const rewire = (): void => {
    if (!inputNode || !gainNode || !audioCtx) return;
    try {
      inputNode.disconnect();
    } catch {
      /* not yet connected */
    }
    let prev: AudioNode = inputNode;
    for (const f of filters) {
      if (!f.node) {
        f.node = audioCtx.createBiquadFilter();
        f.node.type = f.type;
        f.node.frequency.value = f.frequency;
        f.node.Q.value = f.q;
        f.node.gain.value = f.gain;
      } else {
        try {
          f.node.disconnect();
        } catch {
          /* ok */
        }
      }
      prev.connect(f.node);
      prev = f.node;
    }
    prev.connect(gainNode);
  };

  const wireSend = (effectName: string, s: SendState): void => {
    if (!duckGain || s.node) return;
    const effect = effects.get(effectName);
    if (!effect) return; // effect not created yet; wired when send() is called again
    s.node = ensureAudio().createGain();
    s.node.gain.value = s.level;
    duckGain.connect(s.node); // post-fader (after volume + duck)
    s.node.connect(effect.input);
  };

  const ensure = (): void => {
    if (gainNode) return;
    const ctx = ensureAudio();
    inputNode = ctx.createGain();
    gainNode = ctx.createGain();
    gainNode.gain.value = on ? volume : 0;
    duckGain = ctx.createGain();
    gainNode.connect(duckGain);
    duckGain.connect(ensureMaster(ctx));
    rewire();
    for (const [effectName, s] of sends) wireSend(effectName, s);
  };

  return {
    name,
    get input() {
      ensure();
      return inputNode!;
    },
    get volume() {
      return volume;
    },
    get on() {
      return on;
    },
    setVolume(v, rampMs = 20) {
      volume = v;
      if (gainNode && on) rampParam(gainNode.gain, v, rampMs);
    },
    setOn(next, rampMs = 20) {
      on = next;
      if (gainNode) rampParam(gainNode.gain, next ? volume : 0, rampMs);
    },
    addFilter(type, frequency = 1000, q = 1) {
      const state: FilterState = { type, frequency, q, gain: 0, node: null };
      filters.push(state);
      if (gainNode) rewire();
      return {
        get node() {
          return state.node;
        },
        frequency(hz, rampMs = 0) {
          state.frequency = hz;
          if (state.node) rampParam(state.node.frequency, hz, rampMs);
        },
        q(value, rampMs = 0) {
          state.q = value;
          if (state.node) rampParam(state.node.Q, value, rampMs);
        },
        gain(db, rampMs = 0) {
          state.gain = db;
          if (state.node) rampParam(state.node.gain, db, rampMs);
        },
      };
    },
    clearFilters() {
      for (const f of filters) {
        if (f.node) {
          try {
            f.node.disconnect();
          } catch {
            /* ok */
          }
        }
      }
      filters.length = 0;
      if (gainNode && inputNode) {
        try {
          inputNode.disconnect();
        } catch {
          /* ok */
        }
        inputNode.connect(gainNode);
      }
    },
    send(effectName, level, rampMs = 20) {
      let s = sends.get(effectName);
      if (!s) {
        s = { level, node: null };
        sends.set(effectName, s);
      } else {
        s.level = level;
      }
      if (gainNode) wireSend(effectName, s);
      if (s.node) rampParam(s.node.gain, level, rampMs);
    },
    duck(amount, opts = {}) {
      ensure();
      if (!duckGain || !audioCtx) return;
      const attackMs = opts.attackMs ?? 40;
      const holdMs = opts.holdMs ?? 120;
      const releaseMs = opts.releaseMs ?? 300;
      const now = audioCtx.currentTime;
      const g = duckGain.gain;
      g.cancelScheduledValues(now);
      g.setTargetAtTime(Math.max(0, 1 - amount), now, attackMs / 3000);
      g.setTargetAtTime(1, now + (attackMs + holdMs) / 1000, releaseMs / 3000);
    },
  };
}

function makeImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(seconds * rate));
  const buffer = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buffer;
}

function createReverb(
  name: string,
  opts: { seconds?: number; decay?: number; wet?: number },
): Effect {
  const seconds = opts.seconds ?? 2;
  const decay = opts.decay ?? 2;
  let wet = opts.wet ?? 0.3;
  let inputNode: GainNode | null = null;
  let wetGain: GainNode | null = null;
  const ensure = (): void => {
    if (inputNode) return;
    const ctx = ensureAudio();
    inputNode = ctx.createGain();
    const convolver = ctx.createConvolver();
    convolver.buffer = makeImpulse(ctx, seconds, decay);
    wetGain = ctx.createGain();
    wetGain.gain.value = wet;
    inputNode.connect(convolver).connect(wetGain).connect(ensureMaster(ctx));
  };
  return {
    name,
    get input() {
      ensure();
      return inputNode!;
    },
    get wet() {
      return wet;
    },
    setWet(level, rampMs = 20) {
      wet = level;
      if (wetGain) rampParam(wetGain.gain, level, rampMs);
    },
  };
}

function createDelay(
  name: string,
  opts: { time?: number; feedback?: number; wet?: number },
): DelayEffect {
  let time = opts.time ?? 0.25;
  let feedback = opts.feedback ?? 0.35;
  let wet = opts.wet ?? 0.35;
  let inputNode: GainNode | null = null;
  let delayNode: DelayNode | null = null;
  let feedbackGain: GainNode | null = null;
  let wetGain: GainNode | null = null;
  const ensure = (): void => {
    if (inputNode) return;
    const ctx = ensureAudio();
    inputNode = ctx.createGain();
    delayNode = ctx.createDelay(5);
    delayNode.delayTime.value = time;
    feedbackGain = ctx.createGain();
    feedbackGain.gain.value = feedback;
    wetGain = ctx.createGain();
    wetGain.gain.value = wet;
    inputNode.connect(delayNode);
    delayNode.connect(feedbackGain).connect(delayNode); // feedback loop
    delayNode.connect(wetGain).connect(ensureMaster(ctx));
  };
  return {
    name,
    get input() {
      ensure();
      return inputNode!;
    },
    get wet() {
      return wet;
    },
    setWet(level, rampMs = 20) {
      wet = level;
      if (wetGain) rampParam(wetGain.gain, level, rampMs);
    },
    setTime(seconds, rampMs = 20) {
      time = seconds;
      if (delayNode) rampParam(delayNode.delayTime, seconds, rampMs);
    },
    setFeedback(amount, rampMs = 20) {
      feedback = amount;
      if (feedbackGain) rampParam(feedbackGain.gain, amount, rampMs);
    },
  };
}

/** The mixer: named buses under a master, plus shared reverb/delay effects.
 *
 *    Audio.Mixer.setMasterVolume(0.8);
 *    Audio.Mixer.reverb("hall", { seconds: 2.4, wet: 0.3 });
 *    Audio.Mixer.bus("sfx").send("hall", 0.25);        // wet blips
 *    const muffle = Audio.Mixer.bus("music").addFilter("lowpass", 20000);
 *    // on pause:  muffle.frequency(500, 250);  on resume: muffle.frequency(20000, 250); */
export const Mixer = {
  /** Get or create a named channel bus (routed into the master). */
  bus(name: string): Bus {
    let bus = buses.get(name);
    if (!bus) {
      bus = createBus(name);
      buses.set(name, bus);
    }
    return bus;
  },
  /** Get or create a generated-impulse reverb effect. */
  reverb(name: string, opts: { seconds?: number; decay?: number; wet?: number } = {}): Effect {
    let effect = effects.get(name);
    if (!effect) {
      effect = createReverb(name, opts);
      effects.set(name, effect);
    }
    return effect;
  },
  /** Get or create a feedback delay/echo effect. */
  delay(name: string, opts: { time?: number; feedback?: number; wet?: number } = {}): DelayEffect {
    let effect = effects.get(name) as DelayEffect | undefined;
    if (!effect) {
      effect = createDelay(name, opts);
      effects.set(name, effect);
    }
    return effect;
  },
  /** Insert a compressor/limiter on the master bus (before the destination) —
   *  glue the mix and stop peaks clipping when many sounds stack. Defaults act
   *  as a gentle limiter; raise `ratio` / lower `threshold` for a hard brick
   *  wall. Call once (idempotent); re-calling re-tunes it. */
  compressor(
    opts: {
      threshold?: number;
      ratio?: number;
      attack?: number;
      release?: number;
      knee?: number;
    } = {},
  ): void {
    compSpec = {
      threshold: opts.threshold ?? -18,
      ratio: opts.ratio ?? 12,
      attack: opts.attack ?? 0.003,
      release: opts.release ?? 0.25,
      knee: opts.knee ?? 6,
    };
    if (masterGain && audioCtx) wireMasterOut(audioCtx);
  },
  /** Insert a dynamic biquad filter on the master bus (post-mix, before the
   *  compressor/destination), so it filters EVERYTHING — every bus and effect
   *  at once. Returns a handle to sweep it live (a master low-pass / EQ). */
  masterFilter(type: BiquadFilterType, frequency = 1000, q = 1): Filter {
    const state: FilterState = { type, frequency, q, gain: 0, node: null };
    masterFilters.push(state);
    if (masterGain && audioCtx) wireMasterOut(audioCtx);
    return {
      get node() {
        return state.node;
      },
      frequency(hz, rampMs = 0) {
        state.frequency = hz;
        if (state.node) rampParam(state.node.frequency, hz, rampMs);
      },
      q(value, rampMs = 0) {
        state.q = value;
        if (state.node) rampParam(state.node.Q, value, rampMs);
      },
      gain(db, rampMs = 0) {
        state.gain = db;
        if (state.node) rampParam(state.node.gain, db, rampMs);
      },
    };
  },
  /** Momentarily duck a named bus by `amount` then restore — e.g. dip the
   *  music while a big SFX plays. Shorthand for `Mixer.bus(name).duck(...)`. */
  duck(
    name: string,
    amount: number,
    opts?: { attackMs?: number; holdMs?: number; releaseMs?: number },
  ): void {
    Mixer.bus(name).duck(amount, opts);
  },
  /** Master volume 0..1 for everything (click-free ramp). */
  setMasterVolume(v: number, rampMs = 20): void {
    masterVolume = v;
    if (masterGain && masterOn) rampParam(masterGain.gain, v, rampMs);
  },
  get on(): boolean {
    return masterOn;
  },
  /** Global mute (click-free). */
  setOn(on: boolean, rampMs = 20): void {
    masterOn = on;
    if (masterGain) rampParam(masterGain.gain, on ? masterVolume : 0, rampMs);
  },
};

// ---------- SFX bus ----------
// Sound effects route through the mixer's built-in "sfx" bus (mute/volume is a
// single knob; add filters/sends via `Mixer.bus("sfx")`).

// All sound effects should go through this: sound MUST NEVER crash the
// game (e.g. when AudioContext is missing or blocked by the browser).
// A thrown error here would otherwise bubble up through update() and
// stop the entire game loop.
export function playSfx(build: SfxBuilder): void {
  try {
    const ctx = ensureAudio();
    build(ctx, ctx.currentTime, Mixer.bus("sfx").input);
  } catch {
    /* silent - rather no sound than a frozen game */
  }
}

/** A parameter value: a constant, or a `{ from, to }` sweep over `time` seconds
 *  (default the note's release). `curve` defaults to exponential — the musical
 *  choice for pitch and filter cutoffs (both stay > 0). */
export type ToneSweep = number | { from: number; to: number; time?: number; curve?: "lin" | "exp" };

/** A one-shot synth voice: an oscillator (or noise) through an
 *  attack/hold/release envelope and an optional filter, routed to a mixer bus.
 *  This is the declarative alternative to hand-wiring nodes in a `SfxBuilder`. */
export interface ToneOptions {
  /** Oscillator shape, or `"noise"` for filtered noise (hats, hits, wind). */
  wave?: OscillatorType | "noise";
  /** Pitch in Hz — a number or a `{ from, to }` sweep. Ignored for `"noise"`. */
  freq?: ToneSweep;
  /** Extra detuned unison voices, in cents (e.g. `[-6, 6]`). Oscillators only. */
  detune?: number[];
  /** Peak level 0..1. Default 0.3. */
  gain?: number;
  /** Fade-in seconds. Default 0.005. */
  attack?: number;
  /** Seconds held at peak before the release. Default 0. */
  hold?: number;
  /** Fade-out seconds (the note's tail). Default 0.25. */
  release?: number;
  /** An optional filter the voice runs through; `freq` may sweep. */
  filter?: { type: BiquadFilterType; freq?: ToneSweep; q?: number };
  /** Absolute audio-clock start time. Default now. */
  when?: number;
  /** Start delay in seconds from now (ignored if `when` is given). Default 0. */
  delay?: number;
  /** Mixer bus to play on. Default `"sfx"`. */
  bus?: string;
}

function scheduleSweep(
  param: AudioParam,
  spec: ToneSweep,
  when: number,
  fallbackTime: number,
): void {
  if (typeof spec === "number") {
    param.setValueAtTime(spec, when);
    return;
  }
  param.setValueAtTime(spec.from, when);
  const at = when + (spec.time ?? fallbackTime);
  if (spec.curve === "lin") param.linearRampToValueAtTime(spec.to, at);
  else param.exponentialRampToValueAtTime(Math.max(0.0001, spec.to), at);
}

/** Play a described synth voice — no manual node graph. Crash-safe (a missing
 *  or blocked AudioContext is swallowed). Layer calls (with `delay`/`when`) for
 *  chords and arpeggios; drop to `playSfx` only when you need a custom graph.
 *
 *    Audio.tone({ wave: "square", freq: 880, release: 0.08 });        // blip
 *    Audio.tone({ wave: "triangle", freq: { from: 220, to: 660, time: 0.12 } }); // jump
 *    Audio.tone({ wave: "noise", release: 0.05, filter: { type: "highpass", freq: 8000 } }); // hat
 *    Audio.tone({ wave: "sine", freq: 440, detune: [-5, 5],
 *                 filter: { type: "lowpass", freq: { from: 4000, to: 800 } } }); */
export function tone(opts: ToneOptions): void {
  try {
    const ctx = ensureAudio();
    const when = opts.when ?? ctx.currentTime + (opts.delay ?? 0);
    const wave = opts.wave ?? "sine";
    const peak = Math.max(0.0001, opts.gain ?? 0.3);
    const attack = Math.max(0, opts.attack ?? 0.005);
    const hold = Math.max(0, opts.hold ?? 0);
    const release = Math.max(0.01, opts.release ?? 0.25);
    const holdEnd = when + attack + hold;
    const end = holdEnd + release;

    // Attack → (hold) → exponential release envelope.
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, when);
    env.gain.linearRampToValueAtTime(peak, when + attack);
    if (hold > 0) env.gain.setValueAtTime(peak, holdEnd);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    env.connect(Mixer.bus(opts.bus ?? "sfx").input);

    // Sources feed the filter if present, else the envelope directly.
    let sink: AudioNode = env;
    if (opts.filter) {
      const f = ctx.createBiquadFilter();
      f.type = opts.filter.type;
      if (opts.filter.q !== undefined) f.Q.value = opts.filter.q;
      scheduleSweep(f.frequency, opts.filter.freq ?? 1000, when, release);
      f.connect(env);
      sink = f;
    }

    if (wave === "noise") {
      const src = ctx.createBufferSource();
      src.buffer = getNoiseBuffer();
      src.loop = true;
      src.connect(sink);
      src.start(when);
      src.stop(end + 0.02);
    } else {
      for (const cents of opts.detune ?? [0]) {
        const osc = ctx.createOscillator();
        osc.type = wave;
        osc.detune.value = cents;
        scheduleSweep(osc.frequency, opts.freq ?? 440, when, release);
        osc.connect(sink);
        osc.start(when);
        osc.stop(end + 0.02);
      }
    }
  } catch {
    /* silent - rather no sound than a frozen game */
  }
}

/** The SFX channel (the mixer's "sfx" bus): master mute/volume plus a few synth
 *  presets, so every game doesn't re-implement the same blip. All presets are
 *  crash-safe (playSfx). */
export const Sfx = {
  get on(): boolean {
    return Mixer.bus("sfx").on;
  },
  setOn(on: boolean): void {
    Mixer.bus("sfx").setOn(on);
  },
  /** Master SFX volume 0..1 (click-free ramp). */
  setVolume(v: number): void {
    Mixer.bus("sfx").setVolume(v);
  },

  /** Short square-wave blip — menu ticks, UI feedback. */
  blip(freq = 880, dur = 0.08, vol = 0.25): void {
    tone({ wave: "square", freq, gain: vol, release: dur });
  },

  /** Rising sweep — the classic jump. */
  jump(): void {
    tone({ wave: "triangle", freq: { from: 220, to: 660, time: 0.12 }, gain: 0.3, release: 0.18 });
  },

  /** Two-note sparkle — pickups, coins. */
  coin(): void {
    tone({ wave: "sine", freq: 988, gain: 0.25, release: 0.25 });
    tone({ wave: "sine", freq: 1319, gain: 0.25, release: 0.25, delay: 0.08 });
  },
};

// ---------- Music player ----------
// Web Audio scheduling: the timer wakes us often, but notes are booked
// in advance against audioCtx.currentTime. This keeps the melody steady
// even if timers jitter, and it won't break if the interval gets throttled.

export interface MusicConfig {
  // Master volume for the music channel.
  volume: number;
  // Length of one schedule step in milliseconds (e.g. a sixteenth note).
  stepMs: number;
  // Called for each step; book notes via Music.note/kick/noiseHit.
  // `when` is the audio clock time (seconds) when the step should play.
  schedule: (step: number, when: number) => void;
  // localStorage key to remember on/off between visits (optional).
  storageKey?: string;
}

const SCHED_AHEAD_S = 0.2;
const SCHED_INTERVAL_MS = 60;

let musicBus: Bus | null = null;
let musicStarted = false;
let musicStep = 0;
let musicTimer: ReturnType<typeof setInterval> | null = null;
let musicNextNoteTime = 0;
let musicConfig: MusicConfig | null = null;

let noiseBuffer: AudioBuffer | null = null;

function getNoiseBuffer(): AudioBuffer {
  if (!noiseBuffer) {
    const ctx = ensureAudio();
    const len = Math.floor(ctx.sampleRate * 0.2);
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

function schedulerTick() {
  if (!audioCtx || !musicBus || !musicConfig) return;
  // If the clock has caught up (e.g. after suspend) - skip ahead instead
  // of scheduling a storm of late notes.
  if (musicNextNoteTime < audioCtx.currentTime) {
    musicNextNoteTime = audioCtx.currentTime + 0.05;
  }
  while (musicNextNoteTime < audioCtx.currentTime + SCHED_AHEAD_S) {
    musicConfig.schedule(musicStep, musicNextNoteTime);
    musicStep++;
    musicNextNoteTime += musicConfig.stepMs / 1000;
  }
}

function stopScheduler() {
  if (musicTimer !== null) {
    clearInterval(musicTimer);
    musicTimer = null;
  }
}

function startScheduler() {
  if (musicTimer !== null || !musicStarted) return;
  musicNextNoteTime = 0; // reset so first tick starts "now"
  schedulerTick();
  musicTimer = setInterval(schedulerTick, SCHED_INTERVAL_MS);
}

// Pause scheduling when the tab is hidden: the game is stopped anyway
// (rAF is paused) and background tabs throttle timers so the melody
// would break up.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopScheduler();
  } else {
    startScheduler();
  }
});

export const Music = {
  // On/off state is reflected in the music bus gain, so the scheduler can keep
  // running even when muted - switching is instant and click-free.
  /** Read-only in practice — call `setOn()` to change it, or the gain node and
   *  the persisted preference silently go out of sync with this flag. */
  on: true,

  // Starts the music channel. Call on the first user gesture (browsers
  // require a gesture to unlock audio). Safe to call multiple times.
  start(config: MusicConfig): void {
    if (musicStarted) return;
    musicConfig = config;
    if (config.storageKey) {
      try {
        Music.on = localStorage.getItem(config.storageKey) !== "off";
      } catch {
        /* private browsing etc. - default on */
      }
    }
    // Sound must NEVER block the game - swallow all errors.
    try {
      ensureAudio();
      // The music channel is just the mixer's "music" bus — volume/mute live on
      // its gain, and games can add filters/sends via Mixer.bus("music").
      musicBus = Mixer.bus("music");
      musicBus.setVolume(config.volume, 0);
      musicBus.setOn(Music.on, 0);
      musicStarted = true;
      startScheduler();
    } catch {
      musicStarted = true; // don't try again every frame
    }
  },

  setOn(on: boolean): void {
    Music.on = on;
    if (musicConfig?.storageKey) {
      try {
        localStorage.setItem(musicConfig.storageKey, on ? "on" : "off");
      } catch {
        /* see above */
      }
    }
    musicBus?.setOn(on, 50);
  },

  // Simple synth note with attack/release curve, routed through the music channel.
  note(freq: number, dur: number, type: OscillatorType, vol: number, when: number): void {
    if (!audioCtx || !musicBus) return;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vol, when + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(g).connect(musicBus.input);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  },

  // Kick drum: a descending sine tone.
  kick(when: number): void {
    if (!audioCtx || !musicBus) return;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, when);
    osc.frequency.exponentialRampToValueAtTime(45, when + 0.1);
    g.gain.setValueAtTime(0.9, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.22);
    osc.connect(g).connect(musicBus.input);
    osc.start(when);
    osc.stop(when + 0.25);
  },

  // Hi-hat/snare: filtered noise from a reusable noise buffer.
  noiseHit(
    when: number,
    dur: number,
    vol: number,
    filterType: BiquadFilterType,
    freq: number,
  ): void {
    if (!audioCtx || !musicBus) return;
    const src = audioCtx.createBufferSource();
    src.buffer = getNoiseBuffer();
    const f = audioCtx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(vol, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(f).connect(g).connect(musicBus.input);
    src.start(when);
    src.stop(when + dur + 0.02);
  },
};
