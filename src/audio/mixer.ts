import { audioCtx, ensureAudio } from "./context.js";

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

let masterMuted = false;

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
    masterGain.gain.value = masterMuted ? 0 : masterVolume;
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
  /** The bus's name (its mixer key, e.g. `"sfx"` / `"music"`). */
  readonly name: string;
  /** Head of the chain — connect sound sources here. */
  readonly input: AudioNode;
  /** Channel volume 0..1 (click-free ramp, default 20ms). */
  setVolume(v: number, rampMs?: number): void;
  /** Current channel volume `0..1`. */
  readonly volume: number;
  /** Mute/unmute without losing the volume setting. */
  setMuted(muted: boolean, rampMs?: number): void;
  /** Whether the channel is silenced. Muting only drops the gain — whatever is
   *  playing keeps playing, so unmuting resumes mid-note rather than restarting. */
  readonly muted: boolean;
  /** Stereo position: -1 hard left, 0 centre, 1 hard right (click-free ramp,
   *  default 20ms). Sits after the fader and the duck, so panning a bus never
   *  disturbs its volume — and its aux sends stay centred, which is what you
   *  want from a shared reverb. */
  setPan(pan: number, rampMs?: number): void;
  /** Current stereo position `-1..1`. */
  readonly pan: number;
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
  /** The effect's name (its mixer key, e.g. `"hall"`). */
  readonly name: string;
  /** The effect's input node (buses' sends connect here). */
  readonly input: AudioNode;
  /** Wet output level 0..1. */
  setWet(level: number, rampMs?: number): void;
  /** Current wet output level `0..1`. */
  readonly wet: number;
}

/** A feedback delay/echo effect. */
export interface DelayEffect extends Effect {
  /** Delay/echo time in `seconds` (click-free ramp). */
  setTime(seconds: number, rampMs?: number): void;
  /** Feedback `amount` `0..1` — longer values lengthen the echo tail
   *  (click-free ramp). */
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
  let muted = false;
  let pan = 0;
  let inputNode: GainNode | null = null;
  let gainNode: GainNode | null = null;
  let duckGain: GainNode | null = null; // transient side-chain dip, post-volume
  let panNode: StereoPannerNode | null = null; // last in the chain, made on demand
  const filters: FilterState[] = [];
  const sends = new Map<string, SendState>();

  // The panner is spliced in on the first `setPan`, not at build time: a
  // StereoPanner is not transparent to a mono source even at centre (it applies
  // the equal-power law), so a bus nobody pans keeps exactly the graph it had.
  const ensurePan = (): void => {
    if (panNode || !duckGain || !audioCtx) return;
    if (typeof audioCtx.createStereoPanner !== "function") return; // ancient browser
    panNode = audioCtx.createStereoPanner();
    panNode.pan.value = pan;
    const master = ensureMaster(audioCtx);
    try {
      duckGain.disconnect(master); // only the master leg — the aux sends stay
    } catch {
      /* not yet connected */
    }
    duckGain.connect(panNode);
    panNode.connect(master);
  };

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
    gainNode.gain.value = muted ? 0 : volume;
    duckGain = ctx.createGain();
    gainNode.connect(duckGain);
    duckGain.connect(ensureMaster(ctx));
    rewire();
    if (pan !== 0) ensurePan(); // a pan set before the graph existed
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
    get muted() {
      return muted;
    },
    setVolume(v, rampMs = 20) {
      volume = v;
      if (gainNode && !muted) rampParam(gainNode.gain, v, rampMs);
    },
    setMuted(next, rampMs = 20) {
      muted = next;
      if (gainNode) rampParam(gainNode.gain, next ? 0 : volume, rampMs);
    },
    get pan() {
      return pan;
    },
    setPan(next, rampMs = 20) {
      pan = Math.max(-1, Math.min(1, next));
      if (!gainNode) return; // pre-materialize: recorded, applied on first use
      ensurePan();
      if (panNode) rampParam(panNode.pan, pan, rampMs);
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
  /** Get or create a generated-impulse reverb effect. `seconds` is the impulse
   *  tail length (default 2), `decay` its falloff exponent (default 2), `wet`
   *  the output level 0..1 (default 0.3). */
  reverb(name: string, opts: { seconds?: number; decay?: number; wet?: number } = {}): Effect {
    let effect = effects.get(name);
    if (!effect) {
      effect = createReverb(name, opts);
      effects.set(name, effect);
    }
    return effect;
  },
  /** Get or create a feedback delay/echo effect. `time` is the echo spacing in
   *  seconds (default 0.25), `feedback` the repeat gain 0..1 (default 0.35),
   *  `wet` the output level 0..1 (default 0.35). */
  delay(name: string, opts: { time?: number; feedback?: number; wet?: number } = {}): DelayEffect {
    let effect = effects.get(name) as DelayEffect | undefined;
    if (!effect) {
      effect = createDelay(name, opts);
      effects.set(name, effect);
    }
    return effect;
  },
  /** Insert a compressor/limiter on the master bus (before the destination) —
   *  glue the mix and stop peaks clipping when many sounds stack. `threshold`
   *  in dB (default -18), `ratio` (default 12), `attack`/`release` in seconds
   *  (defaults 0.003 / 0.25), `knee` in dB (default 6). Defaults act as a
   *  gentle limiter; raise `ratio` / lower `threshold` for a hard brick wall.
   *  Call once (idempotent); re-calling re-tunes it. */
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
  /** Current master volume setting. */
  get masterVolume(): number {
    return masterVolume;
  },
  /** Master volume 0..1 for everything (click-free ramp). */
  setMasterVolume(v: number, rampMs = 20): void {
    masterVolume = v;
    if (masterGain && !masterMuted) rampParam(masterGain.gain, v, rampMs);
  },
  /** Whether everything is silenced. */
  get muted(): boolean {
    return masterMuted;
  },
  /** Global mute (click-free). */
  setMuted(muted: boolean, rampMs = 20): void {
    masterMuted = muted;
    if (masterGain) rampParam(masterGain.gain, muted ? 0 : masterVolume, rampMs);
  },
};
