import { type ToneSweep } from "./sfx.js";
/** A well-known mixer knob. The defaults (`Audio.master`, `Audio.buses.sfx`,
 *  `Audio.buses.music`) always exist. A settings screen assigns them directly
 *  and may persist those values separately through `minimotor/storage`.
 *  Custom buses are created via `Audio.bus`. */
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
    duckUnder(trigger: BusHandle, opts?: {
        amount?: number;
        ms?: number;
    }): void;
}
/** The default buses — platform knobs that always exist. */
export declare const buses: {
    sfx: BusHandle;
    music: BusHandle;
};
/** The master output. */
export declare const master: {
    volume: number;
    muted: boolean;
};
/** A custom content bus (cave reverb, radio filter). `lowpass` inserts a
 *  low-pass filter at the given cutoff in Hz; `reverb` adds a per-bus reverb
 *  send at the given wet mix 0..1. Omit both for a plain bus. */
export declare function bus(name: string, opts?: {
    lowpass?: number;
    reverb?: number;
}): BusHandle;
/** The raw AudioContext — the drop-to-WebAudio escape hatch. Null until the
 *  first unlock/use. */
export declare function raw(): AudioContext | null;
/** One pitch keyframe in an `SfxFreq` timeline. */
export interface SfxFreqStep {
    /** Pitch in Hz from this point on. */
    hz: number;
    /** Milliseconds after the sound starts. Default 0; steps run in order. */
    atMs?: number;
    /** Glide into this pitch from the previous one instead of jumping to it. */
    glide?: "lin" | "exp";
}
/** A sound's pitch: a constant, a `{ from, to }` sweep, or a list of keyframes.
 *
 *  A sweep runs over the whole note unless you give it its own `ms` — that is
 *  the difference between a siren and a blip that bends early and then rings
 *  out. Keyframes step by default, so a two-note pickup is one voice with one
 *  envelope rather than two layers that each re-attack. */
export type SfxFreq = number | {
    from: number;
    to: number;
    ms?: number;
} | SfxFreqStep[];
/** A synth sound as plain, tweakable DATA. Directional values are
 *  `{ from, to }`; `[min, max]` tuples are reserved for per-play randomness
 *  (see `PlayOptions.pitch`). */
export interface SfxSpec {
    /** Oscillator shape. Default "sine". */
    shape?: OscillatorType;
    /** Filtered noise instead of an oscillator (hits, whooshes). */
    noise?: boolean;
    /** Pitch in Hz — see `SfxFreq`. */
    freq?: SfxFreq;
    /** Length in ms (the envelope's release). Default 250. */
    ms?: number;
    /** Fade-in in ms. Default 5; 0 is an instant, percussive attack. */
    attackMs?: number;
    /** Peak level 0..1. Default 0.3. */
    volume?: number;
    /** Optional filter; `freq` may sweep. */
    filter?: {
        type: BiquadFilterType;
        freq?: ToneSweep;
        q?: number;
    };
    /** Extra detuned unison voices, in cents. */
    detune?: number[];
    /** Extra layered voices (chords, sparkles), each with its own delay. */
    layers?: Array<Omit<SfxSpec, "layers"> & {
        delayMs?: number;
    }>;
}
/** Per-play overrides for `SfxHandle.play` (pitch, volume, bus). */
export interface PlayOptions {
    /** Playback-rate style pitch multiplier; a `[min, max]` tuple rolls a
     *  fresh jitter per play (footsteps, coins). */
    pitch?: number | [number, number];
    /** Time-scale multiplier for the WHOLE sound — envelope, sweeps, keyframes
     *  and layer delays. `1.2` plays it 20 % longer; a `[min, max]` tuple rolls a
     *  fresh stretch per play. Pair with `pitch` and a repeated sound (a jump, a
     *  footstep) stops sounding like a sample. */
    stretch?: number | [number, number];
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
export declare function sfx<K extends string>(map: Record<K, SfxSpec>, opts?: {
    bus?: BusHandle;
}): Record<K, SfxHandle>;
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
/** A continuous, gear-shifting engine — a looping train of synthesized cylinder
 *  firings whose `playbackRate` climbs with RPM, coloured by a bank of fixed
 *  resonant formants (so it revs without chipmunking) and a load-opening
 *  low-pass, plus a slip-driven noise layer that screeches on the limit.
 *  Persistent (unlike the one-shot `sfx`) — real-time, outside the clock system.
 *  Feed it telemetry:
 *
 *    const engine = Audio.engine({ gears: 6 });
 *    // each frame: engine.update({ throttle, speed: car.speed, maxSpeed, slip }); */
export declare function engine(opts?: EngineOptions): EngineHandle;
/** Config for `Audio.music` — loop flag and per-track volume. */
export interface MusicOptions {
    /** Loop the track. Default `false`. */
    loop?: boolean;
    /** Track volume 0..1 (its own gain, under the music bus). Default 1. */
    volume?: number;
    /** Output bus. Defaults to `Audio.buses.music`. */
    bus?: BusHandle;
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
/** Per-play controls for a decoded sample. Samples are intentionally generic:
 * the engine does not attach meaning to the bytes or the event that requests
 * them. Games can use the same primitive for impacts, UI clicks, footsteps,
 * voices, or any other short recorded sound. */
export interface SamplePlayOptions {
    /** Per-play gain under the selected bus. Default 1. */
    volume?: number;
    /** Playback-rate multiplier. Values above 1 shorten and raise the sample. */
    pitch?: number;
    /** Output bus. Defaults to `Audio.buses.sfx`. */
    bus?: BusHandle;
}
/** A decoded, reusable sample. `play` may overlap previous plays. */
export interface SampleHandle {
    /** Start one instance of the sample. Pre-unlock calls are dropped. */
    play(options?: SamplePlayOptions): void;
    /** Stop all active instances and discard pending decode plays. */
    stop(): void;
}
/** Build a reusable recorded sound from an encoded audio buffer. Decoding is
 * lazy and happens once; subsequent plays create cheap independent buffer
 * sources so rapid impacts do not cut each other off. */
export declare function sample(data: ArrayBuffer, opts?: {
    bus?: BusHandle;
}): SampleHandle;
/** A music track from a loaded asset (`Assets.load` audio entries are
 *  ArrayBuffers, decoded lazily here). */
export declare function music(data: ArrayBuffer, opts?: MusicOptions): MusicHandle;
