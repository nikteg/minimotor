import { audioCtx, ensureAudio } from "./context.js";
import { Bus, Mixer } from "./mixer.js";

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

let musicBus: Bus | null = null;

let musicStarted = false;

let musicStep = 0;

let musicTimer: ReturnType<typeof setInterval> | null = null;

let musicNextNoteTime = 0;

let musicConfig: MusicConfig | null = null;

let noiseBuffer: AudioBuffer | null = null;

export function getNoiseBuffer(): AudioBuffer {
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
  if (!audioCtx || !musicBus || !musicConfig) return;
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
  // On/off state is reflected in the music bus gain, so the scheduler can keep
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
      ensureAudio();
      // The music channel is just the mixer's "music" bus — volume/mute live on
      // its gain, and games can add filters/sends via Mixer.bus("music").
      musicBus = Mixer.bus("music");
      musicBus.setVolume(config.volume, 0);
      musicBus.setOn(Music.on, 0);
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
    musicBus?.setOn(on, 50);
  },

  // Simple synth note with attack/release curve, routed through the music channel.
  note(freq: number, dur: number, type: OscillatorType, vol: number, when: number): void {
    if (!audioCtx || !musicBus) return;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vol, when + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(g).connect(musicBus.input);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  },

  // Kick drum: a descending sine tone.
  kick(when: number): void {
    if (!audioCtx || !musicBus) return;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, when);
    osc.frequency.exponentialRampToValueAtTime(45, when + 0.1);
    g.gain.setValueAtTime(0.9, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.22);
    osc.connect(g).connect(musicBus.input);
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
    if (!audioCtx || !musicBus) return;
    const src = audioCtx.createBufferSource();
    src.buffer = getNoiseBuffer();
    const f = audioCtx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(vol, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(f).connect(g).connect(musicBus.input);
    src.start(when);
    src.stop(when + dur + 0.02);
  },
};
