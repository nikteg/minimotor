// ---------- Audio support ----------
// WebAudio helpers: crash-safe sound effects and a scheduled music
// player. The game provides melodies/song structure; the engine
// manages AudioContext, timing, volume and pause on hidden tab.
// Split by concern: context / mixer / sfx / music. mixer/sfx re-export
// wholesale; context/music are re-exported selectively so the shared
// internals (audioCtx, getNoiseBuffer) stay private.
export * from "./mixer.js";
export * from "./sfx.js";
export { ensureAudio } from "./context.js";
export type { SfxBuilder } from "./context.js";
export { Music } from "./music.js";
export type { MusicConfig } from "./music.js";
