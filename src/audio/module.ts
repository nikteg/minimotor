// ---------- Pure audio module ----------
// WebAudio helpers: crash-safe sound effects and a scheduled music
// player. The app provides melodies/song structure; the engine
// manages AudioContext, timing, volume and pause on hidden tab.
// Split by concern: context / mixer / sfx / music. mixer/sfx re-export
// wholesale; context/music are re-exported selectively so the shared
// internals (audioCtx, getNoiseBuffer) stay private.
//
// The music channel is a FACTORY, not a singleton: `createAudio(app)` builds
// one bound to that app's own music bus and hands it out as `Audio.Music`.
export * from "./surface.js";
export * from "./recipes.js";
export * from "./mixer.js";
export * from "./sfx.js";
export { ensureAudio } from "./context.js";
export type { SfxBuilder } from "./context.js";
export { createMusicChannel } from "./music.js";
export type { MusicChannel, MusicConfig } from "./music.js";
