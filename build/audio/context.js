// ---------- Audio support ----------
// WebAudio helpers: crash-safe sound effects and a scheduled music
// player. The app provides melodies/song structure; the engine
// manages AudioContext, timing, volume and pause on hidden tab.
export let audioCtx = null;
/** Get the shared `AudioContext`, creating it lazily on first call and resuming
 *  it when `suspended`. Must run from a user gesture (browsers block audio
 *  before one) — reach it via `playSfx` / `Music.start`, which fire on the first
 *  action. */
export function ensureAudio() {
    if (!audioCtx) {
        const AC = window.AudioContext ||
            window.webkitAudioContext;
        audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") {
        audioCtx.resume();
    }
    return audioCtx;
}
