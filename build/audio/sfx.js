import { getNoiseBuffer } from "./music.js";
import { ensureAudio } from "./context.js";
import { Mixer } from "./mixer.js";
// ---------- SFX bus ----------
// Sound effects route through the mixer's built-in "sfx" bus (mute/volume is a
// single knob; add filters/sends via `Mixer.bus("sfx")`).
/** Run a `SfxBuilder`, wiring its nodes into the `"sfx"` bus. Crash-safe: a
 *  missing or browser-blocked `AudioContext` is swallowed (silence beats a
 *  frozen app — a throw here would bubble through `update()` and kill the loop). */
export function playSfx(build) {
    try {
        const ctx = ensureAudio();
        build(ctx, ctx.currentTime, Mixer.bus("sfx").input);
    }
    catch {
        /* silent - rather no sound than a frozen app */
    }
}
function scheduleSweep(param, spec, when, fallbackTime) {
    if (typeof spec === "number") {
        param.setValueAtTime(spec, when);
        return;
    }
    if (Array.isArray(spec)) {
        let first = true;
        for (const frame of spec) {
            const at = when + (frame.at ?? 0);
            const curve = first ? "step" : (frame.curve ?? "step");
            if (curve === "step")
                param.setValueAtTime(frame.value, at);
            else if (curve === "lin")
                param.linearRampToValueAtTime(frame.value, at);
            else
                param.exponentialRampToValueAtTime(Math.max(0.0001, frame.value), at);
            first = false;
        }
        return;
    }
    param.setValueAtTime(spec.from, when);
    const at = when + (spec.time ?? fallbackTime);
    if (spec.curve === "lin")
        param.linearRampToValueAtTime(spec.to, at);
    else
        param.exponentialRampToValueAtTime(Math.max(0.0001, spec.to), at);
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
export function tone(opts) {
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
        if (hold > 0)
            env.gain.setValueAtTime(peak, holdEnd);
        env.gain.exponentialRampToValueAtTime(0.0001, end);
        // …into the bus, through a panner when this voice asked to be placed.
        // Skipped at centre so an unpanned voice keeps the plain graph (a
        // StereoPanner applies the equal-power law even at 0).
        const busInput = Mixer.bus(opts.bus ?? "sfx").input;
        if (opts.pan && typeof ctx.createStereoPanner === "function") {
            const panner = ctx.createStereoPanner();
            panner.pan.value = Math.max(-1, Math.min(1, opts.pan));
            env.connect(panner);
            panner.connect(busInput);
        }
        else {
            env.connect(busInput);
        }
        // Sources feed the filter if present, else the envelope directly.
        let sink = env;
        if (opts.filter) {
            const f = ctx.createBiquadFilter();
            f.type = opts.filter.type;
            if (opts.filter.q !== undefined)
                f.Q.value = opts.filter.q;
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
        }
        else {
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
    }
    catch {
        /* silent - rather no sound than a frozen app */
    }
}
/** The SFX channel (the mixer's "sfx" bus): master mute/volume plus a few synth
 *  presets, so every game doesn't re-implement the same blip. All presets are
 *  crash-safe (playSfx). */
export const Sfx = {
    /** Whether the SFX bus is silenced. */
    get muted() {
        return Mixer.bus("sfx").muted;
    },
    /** Mute/unmute all SFX (click-free). */
    set muted(muted) {
        Mixer.bus("sfx").setMuted(muted);
    },
    /** Master SFX volume 0..1 (click-free ramp). */
    get volume() {
        return Mixer.bus("sfx").volume;
    },
    set volume(v) {
        Mixer.bus("sfx").setVolume(v);
    },
    /** Short square-wave blip — menu ticks, UI feedback. */
    blip(freq = 880, dur = 0.08, vol = 0.25) {
        tone({ wave: "square", freq, gain: vol, release: dur });
    },
    /** Rising sweep — the classic jump. */
    jump() {
        tone({ wave: "triangle", freq: { from: 220, to: 660, time: 0.12 }, gain: 0.3, release: 0.18 });
    },
    /** Two-note sparkle — pickups, coins. */
    coin() {
        tone({ wave: "sine", freq: 988, gain: 0.25, release: 0.25 });
        tone({ wave: "sine", freq: 1319, gain: 0.25, release: 0.25, delay: 0.08 });
    },
};
