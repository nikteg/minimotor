import { getNoiseBuffer } from "./music.js";
import { SfxBuilder, ensureAudio } from "./context.js";
import { Mixer } from "./mixer.js";

// ---------- SFX bus ----------
// Sound effects route through the mixer's built-in "sfx" bus (mute/volume is a
// single knob; add filters/sends via `Mixer.bus("sfx")`).

/** Run a `SfxBuilder`, wiring its nodes into the `"sfx"` bus. Crash-safe: a
 *  missing or browser-blocked `AudioContext` is swallowed (silence beats a
 *  frozen game — a throw here would bubble through `update()` and kill the loop). */
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
  /** Whether the SFX bus is unmuted. */
  get on(): boolean {
    return Mixer.bus("sfx").on;
  },
  /** Mute/unmute all SFX (click-free). */
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
