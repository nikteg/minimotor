// ---------- Audio support ----------
// WebAudio helpers: crash-safe sound effects and a scheduled music
// player. The game provides melodies/song structure; the engine
// manages AudioContext, timing, volume and pause on hidden tab.

/** Builds one sound effect. Route nodes into `out` (the master SFX bus, so
 *  `Sfx.setOn`/`setVolume` apply); older builders that connect straight to
 *  `ctx.destination` keep working but bypass the bus. */
export type SfxBuilder = (ctx: AudioContext, now: number, out: AudioNode) => void;

let audioCtx: AudioContext | null = null;

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

// ---------- SFX bus ----------
// One master gain for all sound effects, so mute/volume is a single knob
// (mirrors the music channel's gain).

let sfxGain: GainNode | null = null;
let sfxOn = true;
let sfxVolume = 1;

function ensureSfxBus(ctx: AudioContext): GainNode {
  if (!sfxGain) {
    sfxGain = ctx.createGain();
    sfxGain.gain.value = sfxOn ? sfxVolume : 0;
    sfxGain.connect(ctx.destination);
  }
  return sfxGain;
}

function rampSfxGain(): void {
  if (!sfxGain || !audioCtx) return;
  const now = audioCtx.currentTime;
  sfxGain.gain.cancelScheduledValues(now);
  sfxGain.gain.setTargetAtTime(sfxOn ? sfxVolume : 0, now, 0.02);
}

// All sound effects should go through this: sound MUST NEVER crash the
// game (e.g. when AudioContext is missing or blocked by the browser).
// A thrown error here would otherwise bubble up through update() and
// stop the entire game loop.
export function playSfx(build: SfxBuilder): void {
  try {
    const ctx = ensureAudio();
    build(ctx, ctx.currentTime, ensureSfxBus(ctx));
  } catch {
    /* silent - rather no sound than a frozen game */
  }
}

/** The SFX channel: master mute/volume plus a few synth presets, so every game
 *  doesn't re-implement the same blip. All presets are crash-safe (playSfx). */
export const Sfx = {
  get on(): boolean {
    return sfxOn;
  },
  setOn(on: boolean): void {
    sfxOn = on;
    rampSfxGain();
  },
  /** Master SFX volume 0..1 (click-free ramp). */
  setVolume(v: number): void {
    sfxVolume = v;
    rampSfxGain();
  },

  /** Short square-wave blip — menu ticks, UI feedback. */
  blip(freq = 880, dur = 0.08, vol = 0.25): void {
    playSfx((ctx, now, out) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(vol, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(g).connect(out);
      osc.start(now);
      osc.stop(now + dur + 0.02);
    });
  },

  /** Rising sweep — the classic jump. */
  jump(): void {
    playSfx((ctx, now, out) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(660, now + 0.12);
      g.gain.setValueAtTime(0.3, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      osc.connect(g).connect(out);
      osc.start(now);
      osc.stop(now + 0.2);
    });
  },

  /** Two-note sparkle — pickups, coins. */
  coin(): void {
    playSfx((ctx, now, out) => {
      for (const [i, freq] of [988, 1319].entries()) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        const t = now + i * 0.08;
        osc.type = "sine";
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0.25, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        osc.connect(g).connect(out);
        osc.start(t);
        osc.stop(t + 0.3);
      }
    });
  },
};

// ---------- Music player ----------
// Web Audio scheduling: the timer wakes us often, but notes are booked
// in advance against audioCtx.currentTime. This keeps the melody steady
// even if timers jitter, and it won't break if the interval gets throttled.

export interface MusicConfig {
  // Master volume for the music channel.
  volume: number;
  // Length of one schedule step in milliseconds (e.g. a sixteenth note).
  stepMs: number;
  // Called for each step; book notes via Music.note/kick/noiseHit.
  // `when` is the audio clock time (seconds) when the step should play.
  schedule: (step: number, when: number) => void;
  // localStorage key to remember on/off between visits (optional).
  storageKey?: string;
}

const SCHED_AHEAD_S = 0.2;
const SCHED_INTERVAL_MS = 60;

let musicGain: GainNode | null = null;
let musicStarted = false;
let musicStep = 0;
let musicTimer: number | null = null;
let musicNextNoteTime = 0;
let musicConfig: MusicConfig | null = null;

let noiseBuffer: AudioBuffer | null = null;

function getNoiseBuffer(): AudioBuffer {
  if (!noiseBuffer) {
    const ctx = ensureAudio();
    const len = Math.floor(ctx.sampleRate * 0.2);
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

function schedulerTick() {
  if (!audioCtx || !musicGain || !musicConfig) return;
  // If the clock has caught up (e.g. after suspend) - skip ahead instead
  // of scheduling a storm of late notes.
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
  if (musicTimer !== null || !musicStarted) return;
  musicNextNoteTime = 0; // reset so first tick starts "now"
  schedulerTick();
  musicTimer = setInterval(schedulerTick, SCHED_INTERVAL_MS);
}

// Pause scheduling when the tab is hidden: the game is stopped anyway
// (rAF is paused) and background tabs throttle timers so the melody
// would break up.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopScheduler();
  } else {
    startScheduler();
  }
});

export const Music = {
  // On/off state is reflected in musicGain, so the scheduler can keep
  // running even when muted - switching is instant and click-free.
  /** Read-only in practice — call `setOn()` to change it, or the gain node and
   *  the persisted preference silently go out of sync with this flag. */
  on: true,

  // Starts the music channel. Call on the first user gesture (browsers
  // require a gesture to unlock audio). Safe to call multiple times.
  start(config: MusicConfig): void {
    if (musicStarted) return;
    musicConfig = config;
    if (config.storageKey) {
      try {
        Music.on = localStorage.getItem(config.storageKey) !== "off";
      } catch {
        /* private browsing etc. - default on */
      }
    }
    // Sound must NEVER block the game - swallow all errors.
    try {
      const ctx = ensureAudio();
      musicGain = ctx.createGain();
      musicGain.gain.value = Music.on ? config.volume : 0;
      musicGain.connect(ctx.destination);
      musicStarted = true;
      startScheduler();
    } catch {
      musicStarted = true; // don't try again every frame
    }
  },

  setOn(on: boolean): void {
    Music.on = on;
    if (musicConfig?.storageKey) {
      try {
        localStorage.setItem(musicConfig.storageKey, on ? "on" : "off");
      } catch {
        /* see above */
      }
    }
    if (musicGain && audioCtx) {
      const now = audioCtx.currentTime;
      musicGain.gain.cancelScheduledValues(now);
      musicGain.gain.setTargetAtTime(on && musicConfig ? musicConfig.volume : 0, now, 0.05);
    }
  },

  // Simple synth note with attack/release curve, routed through the music channel.
  note(freq: number, dur: number, type: OscillatorType, vol: number, when: number): void {
    if (!audioCtx || !musicGain) return;
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

  // Kick drum: a descending sine tone.
  kick(when: number): void {
    if (!audioCtx || !musicGain) return;
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

  // Hi-hat/snare: filtered noise from a reusable noise buffer.
  noiseHit(
    when: number,
    dur: number,
    vol: number,
    filterType: BiquadFilterType,
    freq: number,
  ): void {
    if (!audioCtx || !musicGain) return;
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
