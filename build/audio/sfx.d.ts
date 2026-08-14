import { SfxBuilder } from "./context.js";
/** Run a `SfxBuilder`, wiring its nodes into the `"sfx"` bus. Crash-safe: a
 *  missing or browser-blocked `AudioContext` is swallowed (silence beats a
 *  frozen app — a throw here would bubble through `update()` and kill the loop). */
export declare function playSfx(build: SfxBuilder): void;
/** One point on a `ToneSweep` timeline. */
export interface ToneFrame {
    /** The parameter's value here. */
    value: number;
    /** Seconds after the voice starts. Default 0; frames run in order. */
    at?: number;
    /** How the value ARRIVES from the previous frame: `"step"` (default) jumps to
     *  it, `"lin"`/`"exp"` glides. The first frame is always set outright. */
    curve?: "step" | "lin" | "exp";
}
/** A parameter value: a constant, a `{ from, to }` sweep over `time` seconds
 *  (default the note's release), or a list of `ToneFrame` keyframes for stepped
 *  or multi-stage moves. `curve` defaults to exponential — the musical choice
 *  for pitch and filter cutoffs (both stay > 0) — except between keyframes,
 *  where the default is a hard step (an arpeggio, not a glissando). */
export type ToneSweep = number | {
    from: number;
    to: number;
    time?: number;
    curve?: "lin" | "exp";
} | ToneFrame[];
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
    filter?: {
        type: BiquadFilterType;
        freq?: ToneSweep;
        q?: number;
    };
    /** Absolute audio-clock start time. Default now. */
    when?: number;
    /** Start delay in seconds from now (ignored if `when` is given). Default 0. */
    delay?: number;
    /** Mixer bus to play on. Default `"sfx"`. */
    bus?: string;
    /** Stereo position for this one voice: -1 hard left, 0 centre (default), 1
     *  hard right. This is the cheap way to place a sound in the world — pan by
     *  where the thing is relative to the camera:
     *
     *      Audio.tone({ wave: "square", freq: 440, pan: (x - cam.x) / (vp.w / 2) });
     *
     *  Independent of `Mixer.bus(...).setPan`, which moves the whole channel. */
    pan?: number;
}
/** Play a described synth voice — no manual node graph. Crash-safe (a missing
 *  or blocked AudioContext is swallowed). Layer calls (with `delay`/`when`) for
 *  chords and arpeggios; drop to `playSfx` only when you need a custom graph.
 *
 *    Audio.tone({ wave: "square", freq: 880, release: 0.08 });        // blip
 *    Audio.tone({ wave: "triangle", freq: { from: 220, to: 660, time: 0.12 } }); // jump
 *    Audio.tone({ wave: "noise", release: 0.05, filter: { type: "highpass", freq: 8000 } }); // hat
 *    Audio.tone({ wave: "sine", freq: [{ value: 660 }, { value: 990, at: 0.07 }] }); // coin
 *    Audio.tone({ wave: "sine", freq: 440, detune: [-5, 5],
 *                 filter: { type: "lowpass", freq: { from: 4000, to: 800 } } }); */
export declare function tone(opts: ToneOptions): void;
/** The SFX channel (the mixer's "sfx" bus): master mute/volume plus a few synth
 *  presets, so every game doesn't re-implement the same blip. All presets are
 *  crash-safe (playSfx). */
export declare const Sfx: {
    /** Whether the SFX bus is silenced. */
    muted: boolean;
    /** Master SFX volume 0..1 (click-free ramp). */
    volume: number;
    /** Short square-wave blip — menu ticks, UI feedback. */
    blip(freq?: number, dur?: number, vol?: number): void;
    /** Rising sweep — the classic jump. */
    jump(): void;
    /** Two-note sparkle — pickups, coins. */
    coin(): void;
};
