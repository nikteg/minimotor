import { audioCtx, ensureAudio } from "./context.js";
import { Bus, Mixer } from "./mixer.js";

// ---------- Music player ----------
// Web Audio scheduling: the timer wakes us often, but notes are booked
// in advance against audioCtx.currentTime. This keeps the melody steady
// even if timers jitter, and it won't break if the interval gets throttled.

/** Config for `Music.start` — the music channel's volume, step length, and
 *  per-step note scheduler. */
export interface MusicConfig {
  /** Master volume for the music channel `0..1`. */
  volume: number;
  /** Length of one schedule step in ms (e.g. a sixteenth note). */
  stepMs: number;
  /** Called for each step; book notes via `Music.note` / `Music.kick` /
   *  `Music.noiseHit`. `when` is the audio-clock time (seconds) the step plays. */
  schedule: (step: number, when: number) => void;
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

// Pause scheduling when the tab is hidden: the app is stopped anyway
// (rAF is paused) and background tabs throttle timers so the melody
// would break up.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopScheduler();
  } else {
    startScheduler();
  }
});

/** The procedural music channel: a look-ahead Web Audio step scheduler.
 * Book notes from a `MusicConfig.schedule`; persistence belongs to the
 * optional Storage capability. */
let musicOn = true;

export const Music = {
  // On/off state is reflected in the music bus gain, so the scheduler can keep
  // running even when muted - switching is instant and click-free.
  get on(): boolean {
    return musicOn;
  },
  /** Turn music on/off and update the bus. */
  set on(on: boolean) {
    musicOn = on;
    musicBus?.setOn(on, 50);
  },

  /** Start the music channel with a `MusicConfig`. Call on the first user
   *  gesture (browsers require one to unlock audio). Idempotent — safe to call
   *  repeatedly. */
  start(config: MusicConfig): void {
    if (musicStarted) return;
    musicConfig = config;
    // Sound must NEVER block the app - swallow all errors.
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

  /** Book a synth note at audio-clock time `when`: a `type` oscillator at `freq`
   *  Hz, peak `vol` `0..1`, over `dur` seconds (attack/release envelope). */
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

  /** Book a kick drum at `when` — a short descending sine thump. */
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

  /** Book a hi-hat/snare at `when`: filtered noise (`filterType` at `freq` Hz),
   *  peak `vol` `0..1`, over `dur` seconds. */
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
