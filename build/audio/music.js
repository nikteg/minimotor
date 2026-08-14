import { audioCtx, ensureAudio } from "./context.js";
/** Seconds per schedule step — the tempo, resolved. */
function stepSeconds(config) {
    return 60 / config.bpm / (config.stepsPerBeat ?? 4);
}
const SCHED_AHEAD_S = 0.2;
const SCHED_INTERVAL_MS = 60;
// ---------- Page-shared pieces --------------------------------------------
let noiseBuffer = null;
export function getNoiseBuffer() {
    if (!noiseBuffer) {
        const ctx = ensureAudio();
        const len = Math.floor(ctx.sampleRate * 0.2);
        noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < len; i++)
            data[i] = Math.random() * 2 - 1;
    }
    return noiseBuffer;
}
const running = new Set();
let visibilityWired = false;
function onVisibilityChange() {
    for (const channel of running) {
        if (document.hidden)
            channel.suspend();
        else
            channel.resume();
    }
}
function wireVisibility() {
    if (visibilityWired || typeof document === "undefined")
        return;
    visibilityWired = true;
    document.addEventListener("visibilitychange", onVisibilityChange);
}
function unwireVisibility() {
    if (!visibilityWired || typeof document === "undefined")
        return;
    visibilityWired = false;
    document.removeEventListener("visibilitychange", onVisibilityChange);
}
/** Build a music channel that books its notes on `bus`. One per app —
 *  `createAudio` binds it to that app's own `music` bus. */
export function createMusicChannel(bus) {
    let started = false;
    let muted = false;
    let step = 0;
    let timer = null;
    let nextNoteTime = 0;
    let config = null;
    function tick() {
        if (!audioCtx || !config)
            return;
        // If the clock has caught up (e.g. after suspend) - skip ahead instead
        // of scheduling a storm of late notes.
        if (nextNoteTime < audioCtx.currentTime) {
            nextNoteTime = audioCtx.currentTime + 0.05;
        }
        while (nextNoteTime < audioCtx.currentTime + SCHED_AHEAD_S) {
            config.schedule(step, nextNoteTime);
            step++;
            nextNoteTime += stepSeconds(config);
        }
    }
    const lifecycle = {
        suspend() {
            if (timer !== null) {
                clearInterval(timer);
                timer = null;
            }
        },
        resume() {
            if (timer !== null || !started)
                return;
            nextNoteTime = 0; // reset so the first tick starts "now"
            tick();
            timer = setInterval(tick, SCHED_INTERVAL_MS);
        },
    };
    return {
        get muted() {
            return muted;
        },
        /** Silence/unsilence the channel and update its bus. */
        set muted(value) {
            muted = value;
            bus.setMuted(value, 50);
        },
        start(next) {
            if (started)
                return;
            // A non-positive tempo would make the look-ahead loop book notes forever
            // and hang the tab, so this one is a throw rather than the silence the
            // rest of this module falls back to: it can only be a bug in the caller.
            if (!(stepSeconds(next) > 0) || !Number.isFinite(stepSeconds(next))) {
                throw new RangeError("Music.start: bpm and stepsPerBeat must be finite and greater than 0");
            }
            config = next;
            // Sound must NEVER block the app - swallow all errors.
            try {
                ensureAudio();
                // Volume and mute live on the bus gain, so a game can add filters and
                // sends to the same channel through `Audio.buses.music`.
                bus.setVolume(next.volume, 0);
                bus.setMuted(muted, 0);
                started = true;
                running.add(lifecycle);
                wireVisibility();
                lifecycle.resume();
            }
            catch {
                started = true; // don't try again every frame
            }
        },
        stop() {
            lifecycle.suspend();
            started = false;
            step = 0;
            config = null;
            running.delete(lifecycle);
            if (running.size === 0)
                unwireVisibility();
        },
        note(freq, dur, type, vol, when) {
            if (!audioCtx)
                return;
            const osc = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            osc.type = type;
            osc.frequency.value = freq;
            g.gain.setValueAtTime(0, when);
            g.gain.linearRampToValueAtTime(vol, when + 0.015);
            g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
            osc.connect(g).connect(bus.input);
            osc.start(when);
            osc.stop(when + dur + 0.02);
        },
        kick(when) {
            if (!audioCtx)
                return;
            const osc = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            osc.type = "sine";
            osc.frequency.setValueAtTime(150, when);
            osc.frequency.exponentialRampToValueAtTime(45, when + 0.1);
            g.gain.setValueAtTime(0.9, when);
            g.gain.exponentialRampToValueAtTime(0.0001, when + 0.22);
            osc.connect(g).connect(bus.input);
            osc.start(when);
            osc.stop(when + 0.25);
        },
        noiseHit(when, dur, vol, filterType, freq) {
            if (!audioCtx)
                return;
            const src = audioCtx.createBufferSource();
            src.buffer = getNoiseBuffer();
            const f = audioCtx.createBiquadFilter();
            f.type = filterType;
            f.frequency.value = freq;
            const g = audioCtx.createGain();
            g.gain.setValueAtTime(vol, when);
            g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
            src.connect(f).connect(g).connect(bus.input);
            src.start(when);
            src.stop(when + dur + 0.02);
        },
    };
}
