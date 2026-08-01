import { audioCtx, ensureAudio } from "./context.js";
import type { Bus } from "./mixer.js";

// ---------- Music channel ----------
// Web Audio scheduling: the timer wakes us often, but notes are booked
// in advance against audioCtx.currentTime. This keeps the melody steady
// even if timers jitter, and it won't break if the interval gets throttled.
//
// A channel is BOUND TO ONE BUS, and `createAudio(app)` gives each app its own,
// so two apps on a page each get their own tempo, step counter and mute. The
// only page-shared pieces are the noise buffer (a cache over the shared
// AudioContext, like the context itself) and the visibility listener, which is
// wired lazily on the first running channel and removed when the last one
// stops. Importing this module registers nothing and touches no DOM, so
// `minimotor/audio` loads under Node.

/** Config for `Music.start` — the music channel's volume, tempo, and per-step
 *  note scheduler. */
export interface MusicConfig {
  /** Master volume for the music channel `0..1`. */
  volume: number;
  /** Tempo in beats per minute — the beat you would tap your foot to. */
  bpm: number;
  /** How finely `schedule` is called within a beat: 4 = sixteenth notes
   *  (default), 2 = eighths, 1 = one call per beat. Together with `bpm` this
   *  fixes the step length, `60000 / bpm / stepsPerBeat` ms. */
  stepsPerBeat?: number;
  /** Called for each step; book notes via `Music.note` / `Music.kick` /
   *  `Music.noiseHit`. `when` is the audio-clock time (seconds) the step plays. */
  schedule: (step: number, when: number) => void;
}

/** The procedural music channel: a look-ahead Web Audio step scheduler over one
 *  bus. Book notes from a `MusicConfig.schedule`; persistence belongs to the
 *  optional Storage capability. */
export interface MusicChannel {
  /** Whether the channel is silenced. Mute is reflected in the bus gain, so the
   *  scheduler keeps running while silent — switching is instant, click-free,
   *  and resumes mid-phrase rather than restarting the song. */
  muted: boolean;
  /** Start the channel with a `MusicConfig`. Call on the first user gesture
   *  (browsers require one to unlock audio). Idempotent — safe to call
   *  repeatedly on the same channel. */
  start(config: MusicConfig): void;
  /** Stop scheduling and forget the config. Notes already booked still play
   *  out; a later `start` begins again from step 0. Called for you when the
   *  owning app is destroyed. */
  stop(): void;
  /** Book a synth note at audio-clock time `when`: a `type` oscillator at `freq`
   *  Hz, peak `vol` `0..1`, over `dur` seconds (attack/release envelope). */
  note(freq: number, dur: number, type: OscillatorType, vol: number, when: number): void;
  /** Book a kick drum at `when` — a short descending sine thump. */
  kick(when: number): void;
  /** Book a hi-hat/snare at `when`: filtered noise (`filterType` at `freq` Hz),
   *  peak `vol` `0..1`, over `dur` seconds. */
  noiseHit(
    when: number,
    dur: number,
    vol: number,
    filterType: BiquadFilterType,
    freq: number,
  ): void;
}

/** Seconds per schedule step — the tempo, resolved. */
function stepSeconds(config: MusicConfig): number {
  return 60 / config.bpm / (config.stepsPerBeat ?? 4);
}

const SCHED_AHEAD_S = 0.2;

const SCHED_INTERVAL_MS = 60;

// ---------- Page-shared pieces --------------------------------------------

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

// Pause scheduling when the tab is hidden: the app is stopped anyway (rAF is
// paused) and background tabs throttle timers, so the melody would break up.
// One listener drives every running channel, and it only exists while at least
// one is running — a game that never plays music leaves no page-level trace.
interface Suspendable {
  suspend(): void;
  resume(): void;
}

const running = new Set<Suspendable>();
let visibilityWired = false;

function onVisibilityChange(): void {
  for (const channel of running) {
    if (document.hidden) channel.suspend();
    else channel.resume();
  }
}

function wireVisibility(): void {
  if (visibilityWired || typeof document === "undefined") return;
  visibilityWired = true;
  document.addEventListener("visibilitychange", onVisibilityChange);
}

function unwireVisibility(): void {
  if (!visibilityWired || typeof document === "undefined") return;
  visibilityWired = false;
  document.removeEventListener("visibilitychange", onVisibilityChange);
}

/** Build a music channel that books its notes on `bus`. One per app —
 *  `createAudio` binds it to that app's own `music` bus. */
export function createMusicChannel(bus: Bus): MusicChannel {
  let started = false;
  let muted = false;
  let step = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let nextNoteTime = 0;
  let config: MusicConfig | null = null;

  function tick(): void {
    if (!audioCtx || !config) return;
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

  const lifecycle: Suspendable = {
    suspend() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
    resume() {
      if (timer !== null || !started) return;
      nextNoteTime = 0; // reset so the first tick starts "now"
      tick();
      timer = setInterval(tick, SCHED_INTERVAL_MS);
    },
  };

  return {
    get muted(): boolean {
      return muted;
    },
    /** Silence/unsilence the channel and update its bus. */
    set muted(value: boolean) {
      muted = value;
      bus.setMuted(value, 50);
    },

    start(next: MusicConfig): void {
      if (started) return;
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
      } catch {
        started = true; // don't try again every frame
      }
    },

    stop(): void {
      lifecycle.suspend();
      started = false;
      step = 0;
      config = null;
      running.delete(lifecycle);
      if (running.size === 0) unwireVisibility();
    },

    note(freq, dur, type, vol, when): void {
      if (!audioCtx) return;
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

    kick(when): void {
      if (!audioCtx) return;
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

    noiseHit(when, dur, vol, filterType, freq): void {
      if (!audioCtx) return;
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
