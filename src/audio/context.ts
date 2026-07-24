// ---------- Audio support ----------
// WebAudio helpers: crash-safe sound effects and a scheduled music
// player. The app provides melodies/song structure; the engine
// manages AudioContext, timing, volume and pause on hidden tab.

/** Builds one sound effect. Route nodes into `out` (the master SFX bus, so
 *  `Sfx.setOn`/`setVolume` apply); older builders that connect straight to
 *  `ctx.destination` keep working but bypass the bus. */
export type SfxBuilder = (ctx: AudioContext, now: number, out: AudioNode) => void;

export let audioCtx: AudioContext | null = null;

/** Get the shared `AudioContext`, creating it lazily on first call and resuming
 *  it when `suspended`. Must run from a user gesture (browsers block audio
 *  before one) — reach it via `playSfx` / `Music.start`, which fire on the first
 *  action. */
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
