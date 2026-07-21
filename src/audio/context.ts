// ---------- Audio support ----------
// WebAudio helpers: crash-safe sound effects and a scheduled music
// player. The game provides melodies/song structure; the engine
// manages AudioContext, timing, volume and pause on hidden tab.

/** Builds one sound effect. Route nodes into `out` (the master SFX bus, so
 *  `Sfx.setOn`/`setVolume` apply); older builders that connect straight to
 *  `ctx.destination` keep working but bypass the bus. */
export type SfxBuilder = (ctx: AudioContext, now: number, out: AudioNode) => void;

export let audioCtx: AudioContext | null = null;

// Lazy init: AudioContext must not be created before a user gesture,
// so always call via playSfx/Music.start (which runs on first action).
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
