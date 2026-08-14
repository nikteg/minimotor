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
    duck(amount: number, opts?: {
        attackMs?: number;
        holdMs?: number;
        releaseMs?: number;
    }): void;
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
/** The mixer: named buses under a master, plus shared reverb/delay effects.
 *
 *    Audio.Mixer.setMasterVolume(0.8);
 *    Audio.Mixer.reverb("hall", { seconds: 2.4, wet: 0.3 });
 *    Audio.Mixer.bus("sfx").send("hall", 0.25);        // wet blips
 *    const muffle = Audio.Mixer.bus("music").addFilter("lowpass", 20000);
 *    // on pause:  muffle.frequency(500, 250);  on resume: muffle.frequency(20000, 250); */
export declare const Mixer: {
    /** Get or create a named channel bus (routed into the master). */
    bus(name: string): Bus;
    /** Get or create a generated-impulse reverb effect. `seconds` is the impulse
     *  tail length (default 2), `decay` its falloff exponent (default 2), `wet`
     *  the output level 0..1 (default 0.3). */
    reverb(name: string, opts?: {
        seconds?: number;
        decay?: number;
        wet?: number;
    }): Effect;
    /** Get or create a feedback delay/echo effect. `time` is the echo spacing in
     *  seconds (default 0.25), `feedback` the repeat gain 0..1 (default 0.35),
     *  `wet` the output level 0..1 (default 0.35). */
    delay(name: string, opts?: {
        time?: number;
        feedback?: number;
        wet?: number;
    }): DelayEffect;
    /** Insert a compressor/limiter on the master bus (before the destination) —
     *  glue the mix and stop peaks clipping when many sounds stack. `threshold`
     *  in dB (default -18), `ratio` (default 12), `attack`/`release` in seconds
     *  (defaults 0.003 / 0.25), `knee` in dB (default 6). Defaults act as a
     *  gentle limiter; raise `ratio` / lower `threshold` for a hard brick wall.
     *  Call once (idempotent); re-calling re-tunes it. */
    compressor(opts?: {
        threshold?: number;
        ratio?: number;
        attack?: number;
        release?: number;
        knee?: number;
    }): void;
    /** Insert a dynamic biquad filter on the master bus (post-mix, before the
     *  compressor/destination), so it filters EVERYTHING — every bus and effect
     *  at once. Returns a handle to sweep it live (a master low-pass / EQ). */
    masterFilter(type: BiquadFilterType, frequency?: number, q?: number): Filter;
    /** Momentarily duck a named bus by `amount` then restore — e.g. dip the
     *  music while a big SFX plays. Shorthand for `Mixer.bus(name).duck(...)`. */
    duck(name: string, amount: number, opts?: {
        attackMs?: number;
        holdMs?: number;
        releaseMs?: number;
    }): void;
    /** Current master volume setting. */
    readonly masterVolume: number;
    /** Master volume 0..1 for everything (click-free ramp). */
    setMasterVolume(v: number, rampMs?: number): void;
    /** Whether everything is silenced. */
    readonly muted: boolean;
    /** Global mute (click-free). */
    setMuted(muted: boolean, rampMs?: number): void;
};
