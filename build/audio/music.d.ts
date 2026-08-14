import type { Bus } from "./mixer.js";
/** Config for `Music.start` — the music channel's volume, tempo, and per-step
 *  note scheduler. */
export interface MusicConfig {
    /** Master volume for the music channel `0..1`. */
    volume: number;
    /** Tempo in beats per minute — the beat you would tap your foot to. */
    bpm: number;
    /** How finely `schedule` is called within a beat: 4 = sixteenth notes
     *  (default), 2 = eighths, 1 = one call per beat. Together with `bpm` this
     *  fixes the step length, `60000 / bpm / stepsPerBeat` ms. */
    stepsPerBeat?: number;
    /** Called for each step; book notes via `Music.note` / `Music.kick` /
     *  `Music.noiseHit`. `when` is the audio-clock time (seconds) the step plays. */
    schedule: (step: number, when: number) => void;
}
/** The procedural music channel: a look-ahead Web Audio step scheduler over one
 *  bus. Book notes from a `MusicConfig.schedule`; persistence belongs to the
 *  optional Storage capability. */
export interface MusicChannel {
    /** Whether the channel is silenced. Mute is reflected in the bus gain, so the
     *  scheduler keeps running while silent — switching is instant, click-free,
     *  and resumes mid-phrase rather than restarting the song. */
    muted: boolean;
    /** Start the channel with a `MusicConfig`. Call on the first user gesture
     *  (browsers require one to unlock audio). Idempotent — safe to call
     *  repeatedly on the same channel. */
    start(config: MusicConfig): void;
    /** Stop scheduling and forget the config. Notes already booked still play
     *  out; a later `start` begins again from step 0. Called for you when the
     *  owning app is destroyed. */
    stop(): void;
    /** Book a synth note at audio-clock time `when`: a `type` oscillator at `freq`
     *  Hz, peak `vol` `0..1`, over `dur` seconds (attack/release envelope). */
    note(freq: number, dur: number, type: OscillatorType, vol: number, when: number): void;
    /** Book a kick drum at `when` — a short descending sine thump. */
    kick(when: number): void;
    /** Book a hi-hat/snare at `when`: filtered noise (`filterType` at `freq` Hz),
     *  peak `vol` `0..1`, over `dur` seconds. */
    noiseHit(when: number, dur: number, vol: number, filterType: BiquadFilterType, freq: number): void;
}
export declare function getNoiseBuffer(): AudioBuffer;
/** Build a music channel that books its notes on `bus`. One per app —
 *  `createAudio` binds it to that app's own `music` bus. */
export declare function createMusicChannel(bus: Bus): MusicChannel;
