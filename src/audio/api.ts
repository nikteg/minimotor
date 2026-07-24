// ---------- The Audio surface (API_PLAN #35–#38) ----------
// Typed sfx maps, tweakable recipes, buffer music, and buses:
//
//   const sfx = Audio.sfx({
//     jump: { shape: "square", freq: { from: 520, to: 880 }, ms: 90, volume: 0.4 },
//     coin: Audio.Recipes.coin(),
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
  /** The bus's name (`"sfx"`, `"music"`, or a custom bus name). */
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

/** A custom content bus (cave reverb, radio filter). `lowpass` inserts a
 *  low-pass filter at the given cutoff in Hz; `reverb` adds a per-bus reverb
 *  send at the given wet mix 0..1. Omit both for a plain bus. */
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

/** Per-play overrides for `SfxHandle.play` (pitch, volume, bus). */
export interface PlayOptions {
  /** Playback-rate style pitch multiplier; a `[min, max]` tuple rolls a
   *  fresh jitter per play (footsteps, coins). */
  pitch?: number | [number, number];
  /** Override the spec's volume for this play. */
  volume?: number;
  /** Route to a different bus for this play. */
  bus?: BusHandle;
}

/** A ready-to-play sound effect built from an `SfxSpec`. */
export interface SfxHandle {
  /** Play the sound once. `PlayOptions` tweak pitch/volume/bus per play; a
   *  pre-unlock play is dropped with a dev warn. */
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

/** Build a typed sfx map: each key becomes an `SfxHandle` (`sfx.jump.play()`).
 *  Specs are plain `SfxSpec` data — write them by hand or start from
 *  `Recipes`. All sounds route to `opts.bus`, defaulting to the sfx bus
 *  (`Audio.buses.sfx`); `PlayOptions.bus` can reroute a single play.
 *
 *      const sfx = Audio.sfx({
 *        jump: { shape: "square", freq: { from: 520, to: 880 }, ms: 90, volume: 0.4 },
 *        coin: Audio.Recipes.coin(),
 *      });
 *      sfx.jump.play();
 *      sfx.coin.play({ pitch: [0.95, 1.15] }); // tuple = per-play jitter */
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
 *    coin: Audio.Recipes.coin(),
 *    boom: { ...Audio.Recipes.explosion(), ms: 400 }, */
export const Recipes = {
  /** A two-note ascending sine sparkle — pickups, coins. */
  coin: (): SfxSpec => ({
    shape: "sine",
    freq: 988,
    ms: 220,
    volume: 0.25,
    layers: [{ shape: "sine", freq: 1319, ms: 250, volume: 0.25, delayMs: 80 }],
  }),
  /** A rising triangle sweep — the classic jump. */
  jump: (): SfxSpec => ({ shape: "triangle", freq: { from: 220, to: 660 }, ms: 180, volume: 0.3 }),
  /** A short filtered-noise thud, cutoff diving down — impacts. */
  hit: (): SfxSpec => ({
    noise: true,
    ms: 120,
    volume: 0.4,
    filter: { type: "lowpass", freq: { from: 2000, to: 200 } },
  }),
  /** A long, dark filtered-noise boom. */
  explosion: (): SfxSpec => ({
    noise: true,
    ms: 500,
    volume: 0.5,
    filter: { type: "lowpass", freq: { from: 1200, to: 80 } },
  }),
  /** A fast descending sawtooth zap. */
  laser: (): SfxSpec => ({
    shape: "sawtooth",
    freq: { from: 1800, to: 220 },
    ms: 150,
    volume: 0.3,
  }),
  /** A rising square sweep — power-ups, level-ups. */
  powerup: (): SfxSpec => ({
    shape: "square",
    freq: { from: 440, to: 1760 },
    ms: 320,
    volume: 0.3,
  }),
  /** A short square blip — menu ticks, UI feedback. */
  blip: (): SfxSpec => ({ shape: "square", freq: 880, ms: 80, volume: 0.25 }),
  /** A tiny bright noise tick — button clicks. */
  click: (): SfxSpec => ({
    noise: true,
    ms: 35,
    volume: 0.2,
    filter: { type: "highpass", freq: 5000 },
  }),
  /** A swept band-pass noise whoosh — dashes, swipes. */
  whoosh: (): SfxSpec => ({
    noise: true,
    ms: 260,
    volume: 0.3,
    filter: { type: "bandpass", freq: { from: 400, to: 2400 }, q: 1.5 },
  }),
};

// ---------- Engine sound: a looping, revving motor ----------

/** Config for a looping engine sound — idle/rev pitch, gears, drive, level. */
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
  /** Add a speed-driven road-rumble layer (low-passed looping noise that grows
   *  with speed) — road/tyre noise under the engine. 0 = off (default). ~0.4 is
   *  a good starting point. */
  rumble?: number;
  /** Bus to route through — a bus handle or a bus name (like `Audio.tone`).
   *  Default the sfx bus. */
  bus?: BusHandle | string;
}

/** Per-frame engine telemetry. All optional; sensible zero defaults. */
export interface EngineDrive {
  /** Accelerator 0..1 — drives the audible load/volume. */
  throttle?: number;
  /** Current speed, mapped through `maxSpeed` to the gear/rev curve. */
  speed?: number;
  /** Top speed — `speed / maxSpeed` gives the `0..1` rev position. */
  maxSpeed?: number;
  /** Explicit engine load 0..1 (overrides throttle for volume when given). */
  load?: number;
  /** Tyre slip 0..1 — adds a bit of noisy grit (screech). */
  slip?: number;
}

/** A running engine sound: feed it `EngineDrive` each frame, `stop` to end. */
export interface EngineHandle {
  /** Feed telemetry each frame; pitch/gain follow (click-free ramps). */
  update(drive: EngineDrive): void;
  /** Silence and tear down the oscillators. */
  stop(): void;
}

// A real engine isn't a sustained tone — it's a train of discrete cylinder
// *firings* whose rate rises with RPM, coloured by fixed body/exhaust
// resonances that DON'T move with RPM (the model behind Andy Farnell's engine
// patch in "Designing Sound"). Two mistakes make a synth engine sound "weird":
// gliding an oscillator (a sustained tone, not firings), or pitch-shifting a
// tonal loop (the timbre chipmunks as it revs). We avoid both: the loop is a
// train of broadband *clicks* (so changing their rate via `playbackRate` shifts
// the firing rate without pitching the colour), jittered so it isn't robotic,
// then run through FIXED resonant band-pass "formants" that give the constant
// engine growl. We ship no audio assets — the loop is built procedurally.
// Uneven inter-firing gaps: a cross-plane V8 fires on an irregular pattern,
// which is what gives a muscle car its lumpy "potato-potato" burble rather than
// an even drone. The gaps sum to 8 so the loop is one full 8-cylinder cycle.
const FIRING_GAPS = [1.3, 0.7, 0.7, 1.3, 1.3, 0.7, 0.7, 1.3];

function engineCycle(ctx: AudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const unit = Math.round(sr * 0.02); // base gap; ~ firing period at rate 1
  const len = unit * FIRING_GAPS.reduce((a, b) => a + b, 0);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const click = Math.max(4, Math.round(sr * 0.0022)); // ~2.2ms broadband thump
  let pos = 0;
  for (const gap of FIRING_GAPS) {
    // Jitter timing & amplitude per firing so it isn't a robotic pulse.
    const jitter = Math.round((Math.random() - 0.5) * unit * 0.1);
    const start = Math.max(0, Math.round(pos) + jitter);
    const amp = 0.75 + Math.random() * 0.4;
    for (let i = 0; i < click && start + i < len; i++) {
      const env = Math.exp(-i / (click * 0.4)); // sharp attack, fast decay
      d[start + i] += (Math.random() * 2 - 1) * env * amp; // broadband click
    }
    pos += gap * unit;
  }
  return buf;
}

/** A continuous, gear-shifting engine — a looping train of synthesized cylinder
 *  firings whose `playbackRate` climbs with RPM, coloured by a bank of fixed
 *  resonant formants (so it revs without chipmunking) and a load-opening
 *  low-pass, plus a slip-driven noise layer that screeches on the limit.
 *  Persistent (unlike the one-shot `sfx`) — real-time, outside the clock system.
 *  Feed it telemetry:
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
  const rumbleLevel = opts.rumble ?? 0;
  const busName = typeof opts.bus === "string" ? opts.bus : (opts.bus ?? buses.sfx).name;

  interface Nodes {
    ctx: AudioContext;
    firingBase: number; // Hz the loop fires at when playbackRate == 1
    motor: AudioBufferSourceNode;
    textureGain: GainNode; // level of the click/formant firing texture
    saw: OscillatorNode; // tonal harmonic body, tracks the firing fundamental
    sub: OscillatorNode; // sine sub-weight, an octave down
    lp: BiquadFilterNode;
    gain: GainNode;
    skid: AudioBufferSourceNode;
    skidGain: GainNode;
    skidFilter: BiquadFilterNode;
    rumbleSrc?: AudioBufferSourceNode; // optional speed-driven road rumble
    rumbleGain?: GainNode;
    rumbleFilter?: BiquadFilterNode;
  }
  let n: Nodes | null = null;
  let stopped = false;

  function build(): Nodes | null {
    try {
      const ctx = ensureAudio();
      const out = Mixer.bus(busName).input;
      const sr = ctx.sampleRate;

      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(out);

      // Master low-pass: engine body, opens (brightens) as it revs under load.
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 700;
      lp.Q.value = 0.7;
      lp.connect(gain);

      // --- Harmonic body (source-filter): a sawtooth at the firing fundamental
      // gives a continuous low rumble that rises with revs, plus a sine sub an
      // octave down for weight. This is the "voice" that stops the engine from
      // being just isolated clicks (farts). Frequencies are set directly, so
      // they track RPM without the buffer's playbackRate → no chipmunking.
      const saw = ctx.createOscillator();
      saw.type = "sawtooth";
      saw.frequency.value = idleHz;
      const sawGain = ctx.createGain();
      sawGain.gain.value = 0.16;
      saw.connect(sawGain).connect(lp);
      saw.start();

      const sub = ctx.createOscillator();
      sub.type = "sine";
      sub.frequency.value = idleHz / 2;
      const subGain = ctx.createGain();
      subGain.gain.value = 0.85; // heavy sub → deep muscle-car chest
      sub.connect(subGain).connect(lp);
      sub.start();

      // --- Firing texture: the click train through FIXED resonant formants adds
      // the mechanical rasp/growl on top of the body. `textureGain` keeps it a
      // seasoning, not the whole sound.
      const cycle = engineCycle(ctx);
      const firingBase = sr / Math.round(sr * 0.02); // firings/sec at rate 1
      const motor = ctx.createBufferSource();
      motor.buffer = cycle;
      motor.loop = true;
      motor.start();
      const textureGain = ctx.createGain();
      textureGain.gain.value = 0.6;
      textureGain.connect(lp);

      const formants: Array<[freq: number, q: number, gain: number]> = [
        [58, 10, 1.0], // deep boom / exhaust body (muscle-car chest)
        [120, 8, 0.55], // mid burble
        [240, 5, 0.25], // upper rasp — kept low so it stays dark, not fizzy
      ];
      for (const [freq, q, g] of formants) {
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = freq;
        bp.Q.value = q;
        const fg = ctx.createGain();
        fg.gain.value = g;
        motor.connect(bp).connect(fg).connect(textureGain);
      }
      // A touch of the dry click train keeps the mechanical attack/edge.
      const dry = ctx.createGain();
      dry.gain.value = 0.15;
      motor.connect(dry).connect(textureGain);

      // Tyre-skid layer: band-passed white noise, its own gain (slip-driven).
      const nb = ctx.createBuffer(1, sr, sr);
      const nd = nb.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      const skid = ctx.createBufferSource();
      skid.buffer = nb;
      skid.loop = true;
      const skidFilter = ctx.createBiquadFilter();
      skidFilter.type = "bandpass";
      skidFilter.frequency.value = 1400;
      skidFilter.Q.value = 0.8;
      const skidGain = ctx.createGain();
      skidGain.gain.value = 0;
      skid.connect(skidFilter).connect(skidGain).connect(out);
      skid.start();

      // Optional road-rumble layer: a second tap off the same noise, low-passed
      // and gained by speed — road/tyre roar under the engine (off unless set).
      let rumbleSrc: AudioBufferSourceNode | undefined;
      let rumbleGain: GainNode | undefined;
      let rumbleFilter: BiquadFilterNode | undefined;
      if (rumbleLevel > 0) {
        rumbleSrc = ctx.createBufferSource();
        rumbleSrc.buffer = nb;
        rumbleSrc.loop = true;
        rumbleFilter = ctx.createBiquadFilter();
        rumbleFilter.type = "lowpass";
        rumbleFilter.frequency.value = 220;
        rumbleGain = ctx.createGain();
        rumbleGain.gain.value = 0;
        rumbleSrc.connect(rumbleFilter).connect(rumbleGain).connect(out);
        rumbleSrc.start();
      }

      return {
        ctx,
        firingBase,
        motor,
        textureGain,
        saw,
        sub,
        lp,
        gain,
        skid,
        skidGain,
        skidFilter,
        rumbleSrc,
        rumbleGain,
        rumbleFilter,
      };
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
      const ramp = (p: AudioParam, v: number, tau = 0.06) => p.setTargetAtTime(v, t, tau);
      // Tonal body tracks the firing fundamental directly (no chipmunking); the
      // click texture's playbackRate carries the firing RATE (fixed formants).
      ramp(n.saw.frequency, hz, 0.05);
      ramp(n.sub.frequency, hz / 2, 0.05);
      ramp(n.motor.playbackRate, Math.max(0.05, hz / n.firingBase), 0.05);
      // Firing texture grows with revs/load; softer at idle so it isn't farty.
      ramp(n.textureGain.gain, 0.35 + 0.5 * norm + 0.25 * load, 0.08);
      // Master low-pass opens with rpm & load — kept low-slung so the engine
      // stays dark and chesty (muscle car) rather than bright/buzzy.
      ramp(n.lp.frequency, 420 + norm * 1200 + load * 1100 * drive);
      ramp(n.gain.gain, volume * (0.55 + 0.45 * load) * (0.6 + 0.4 * norm), 0.1);
      // Skid: only real slip, quadratic so light cornering stays quiet, and well
      // under the engine so it never dominates.
      ramp(n.skidGain.gain, Math.min(0.12, slip * slip * 0.14) * volume, 0.05);
      // Road rumble: opens and swells with speed (norm), sitting under the body.
      if (n.rumbleGain && n.rumbleFilter) {
        ramp(n.rumbleFilter.frequency, 200 + norm * 700, 0.12);
        ramp(n.rumbleGain.gain, rumbleLevel * (0.15 + 0.85 * norm) * volume, 0.12);
      }
    },
    stop() {
      stopped = true;
      if (!n) return;
      try {
        n.motor.stop();
        n.saw.stop();
        n.sub.stop();
        n.skid.stop();
        n.rumbleSrc?.stop();
        n.gain.disconnect();
      } catch {
        /* already torn down */
      }
      n = null;
    },
  };
}

// ---------- Music: a decoded track on the music bus ----------

/** Config for `Audio.music` — loop flag and per-track volume. */
export interface MusicOptions {
  /** Loop the track. Default `false`. */
  loop?: boolean;
  /** Track volume 0..1 (its own gain, under the music bus). Default 1. */
  volume?: number;
}

/** A decoded music track on the music bus; `play`/`stop`/`fade` control it. */
export interface MusicHandle {
  /** Start (idempotent — already-playing is a no-op). Called before the
   *  first gesture, it starts automatically on unlock. */
  play(): void;
  /** Stop the track and release its source (a fresh `play()` starts over). */
  stop(): void;
  /** Ramp THIS track's volume over `ms` (scene-hook ducking). */
  fade(volume: number, ms: number): void;
  /** Whether the track is currently sounding. */
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
