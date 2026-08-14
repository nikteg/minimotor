/** Builds one sound effect. Route nodes into `out` (the master SFX bus, so
 *  `Sfx.muted`/`volume` apply); older builders that connect straight to
 *  `ctx.destination` keep working but bypass the bus. */
export type SfxBuilder = (ctx: AudioContext, now: number, out: AudioNode) => void;
export declare let audioCtx: AudioContext | null;
/** Get the shared `AudioContext`, creating it lazily on first call and resuming
 *  it when `suspended`. Must run from a user gesture (browsers block audio
 *  before one) — reach it via `playSfx` / `Music.start`, which fire on the first
 *  action. */
export declare function ensureAudio(): AudioContext;
