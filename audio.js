// ---------- Ljudstöd ----------
// WebAudio-hjälpare: kraschsäkra ljudeffekter och en schemalagd
// musikspelare. Spelet tillhandahåller melodier/songstruktur; motorn
// sköter AudioContext, timing, volym och paus vid dold flik.
let audioCtx = null;
// Lazy-init: AudioContext får inte skapas förrän en användargest, så
// anropa alltid via playSfx/music.start (som körs vid första trycket).
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
// Alla ljudeffekter bör gå via denna: ljud får ALDRIG krascha spelet
// (t.ex. när AudioContext saknas eller blockeras av webbläsaren). Ett
// kastat fel här skulle annars bubbla upp genom update() och stoppa
// hela game-loopen.
export function playSfx(build) {
    try {
        const ctx = ensureAudio();
        build(ctx, ctx.currentTime);
    }
    catch {
        /* tyst - hellre inget ljud än ett fruset spel */
    }
}
const SCHED_AHEAD_S = 0.2;
const SCHED_INTERVAL_MS = 60;
let musicGain = null;
let musicStarted = false;
let musicStep = 0;
let musicTimer = null;
let musicNextNoteTime = 0;
let musicConfig = null;
let noiseBuffer = null;
function getNoiseBuffer() {
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
function schedulerTick() {
    if (!audioCtx || !musicGain || !musicConfig)
        return;
    // Om klockan hunnit ifatt (t.ex. efter suspend) - hoppa fram i stället
    // för att boka en storm av försenade noter.
    if (musicNextNoteTime < audioCtx.currentTime) {
        musicNextNoteTime = audioCtx.currentTime + 0.05;
    }
    while (musicNextNoteTime < audioCtx.currentTime + SCHED_AHEAD_S) {
        musicConfig.schedule(musicStep, musicNextNoteTime);
        musicStep++;
        musicNextNoteTime += musicConfig.stepMs / 1000;
    }
}
function stopScheduler() {
    if (musicTimer !== null) {
        clearInterval(musicTimer);
        musicTimer = null;
    }
}
function startScheduler() {
    if (musicTimer !== null || !musicStarted)
        return;
    musicNextNoteTime = 0; // nollställ så första ticket börjar "nu"
    schedulerTick();
    musicTimer = setInterval(schedulerTick, SCHED_INTERVAL_MS);
}
// Pausa schemaläggningen när fliken är dold: spelet står ändå stilla (rAF
// pausas) och bakgrundsflikar stryper timers så melodin skulle hacka sönder.
document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        stopScheduler();
    }
    else {
        startScheduler();
    }
});
export const music = {
    // På/av-ställningen speglas i musicGain, så schemaläggaren kan snurra på
    // även när ljudet är av - växlingen blir direkt och klickfri.
    on: true,
    // Startar musikkanalen. Anropa vid första användargesten (webbläsare
    // kräver en gest för att låsa upp ljud). Felfri att anropa flera gånger.
    start(config) {
        if (musicStarted)
            return;
        musicConfig = config;
        if (config.storageKey) {
            try {
                music.on = localStorage.getItem(config.storageKey) !== "off";
            }
            catch {
                /* privat läge m.m. - default på */
            }
        }
        // Ljud får ALDRIG blockera spelet - svälj alla fel.
        try {
            const ctx = ensureAudio();
            musicGain = ctx.createGain();
            musicGain.gain.value = music.on ? config.volume : 0;
            musicGain.connect(ctx.destination);
            musicStarted = true;
            startScheduler();
        }
        catch {
            musicStarted = true; // försök inte igen varje bildruta
        }
    },
    setOn(on) {
        music.on = on;
        if (musicConfig?.storageKey) {
            try {
                localStorage.setItem(musicConfig.storageKey, on ? "on" : "off");
            }
            catch {
                /* se ovan */
            }
        }
        if (musicGain && audioCtx) {
            const now = audioCtx.currentTime;
            musicGain.gain.cancelScheduledValues(now);
            musicGain.gain.setTargetAtTime(on && musicConfig ? musicConfig.volume : 0, now, 0.05);
        }
    },
    // Enkel syntnot med attack/release-kurva, routad via musikkanalen.
    note(freq, dur, type, vol, when) {
        if (!audioCtx || !musicGain)
            return;
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(vol, when + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
        osc.connect(g).connect(musicGain);
        osc.start(when);
        osc.stop(when + dur + 0.02);
    },
    // Bastrumma: en sjunkande sinuston.
    kick(when) {
        if (!audioCtx || !musicGain)
            return;
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(150, when);
        osc.frequency.exponentialRampToValueAtTime(45, when + 0.1);
        g.gain.setValueAtTime(0.9, when);
        g.gain.exponentialRampToValueAtTime(0.0001, when + 0.22);
        osc.connect(g).connect(musicGain);
        osc.start(when);
        osc.stop(when + 0.25);
    },
    // Hi-hat/virvel: filtrerat brus från en återanvänd brusbuffer.
    noiseHit(when, dur, vol, filterType, freq) {
        if (!audioCtx || !musicGain)
            return;
        const src = audioCtx.createBufferSource();
        src.buffer = getNoiseBuffer();
        const f = audioCtx.createBiquadFilter();
        f.type = filterType;
        f.frequency.value = freq;
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(vol, when);
        g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
        src.connect(f).connect(g).connect(musicGain);
        src.start(when);
        src.stop(when + dur + 0.02);
    },
};
