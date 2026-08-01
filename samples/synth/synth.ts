import { createPerformanceMonitoring } from "minimotor/performance";
// Synth: a playable instrument + a scheduled backing band.
// Demonstrates: Audio.tone (custom voices on the SFX bus), Audio.Music
// (look-ahead scheduler: note/kick/noiseHit), and the Audio.Mixer — both buses
// send into a shared reverb, a master low-pass sweeps the whole mix, and a
// master limiter glues it. All driven by on-screen UI widgets.
//
// Play it: A S D F G H J K L ; are the white keys (C major from C4), W E T Y U
// O P the black keys. Z/X shift octaves, 1-4 pick the waveform (all mirrored by
// the SYNTH panel's tab strip + Octave slider). Click the on-screen piano too;
// pick and start a backing groove from the on-screen Music controls.
import { createAudio } from "minimotor/audio";
import { createUI } from "minimotor/ui";
import { Mathf, createApp } from "minimotor";
import { KeyCode } from "minimotor";
import { installLayoutProbe } from "../shared/layout-probe.ts";

// The viewport is LIVE (mutated on resize) — piano + bars lay out from it.
const game = createApp("game", { background: "#12141c" });
createPerformanceMonitoring(game);
const vp = game.viewport;
const { Draw, Keys, Loop, Pointer } = game;
const Audio = createAudio(game);
const UI = createUI(game);
installLayoutProbe(UI);

const midiFreq = (m: number) => 440 * 2 ** ((m - 69) / 12);

// ---------- The instrument ----------

const WAVES: OscillatorType[] = ["sine", "triangle", "square", "sawtooth"];
let wave = 1; // triangle default — soft but present
let octave = 4; // C4 anchor; Z/X shifts

// Two slightly-detuned oscillators through a closing low-pass: a warm pluck.
function playNote(midi: number) {
  const freq = midiFreq(midi);
  // A warm pluck: two slightly-detuned voices through a closing low-pass with a
  // soft attack and a long tail — described, not hand-wired.
  Audio.tone({
    wave: WAVES[wave],
    freq,
    detune: [-5, 4],
    gain: 0.3,
    attack: 0.012,
    release: 1.1,
    filter: { type: "lowpass", freq: { from: Math.min(freq * 8, 9000), to: freq * 2, time: 0.5 } },
  });
  glow(midi);
  litUntil.set(midi, performance.now() + 180);
  // Duck the backing groove briefly so the played note cuts through (a light
  // side-chain). Repeated hits keep it ducked, then it swells back.
  if (backing) Audio.Mixer.duck("music", 0.4, { attackMs: 25, holdMs: 70, releaseMs: 220 });
}

// Keyboard layout: semitone offsets from the anchor C. `pos` is the white-key
// index a black key sits to the right of.
const WHITE_KEYS: { code: KeyCode; semi: number }[] = [
  { code: "KeyA", semi: 0 },
  { code: "KeyS", semi: 2 },
  { code: "KeyD", semi: 4 },
  { code: "KeyF", semi: 5 },
  { code: "KeyG", semi: 7 },
  { code: "KeyH", semi: 9 },
  { code: "KeyJ", semi: 11 },
  { code: "KeyK", semi: 12 },
  { code: "KeyL", semi: 14 },
  { code: "Semicolon", semi: 16 },
];
const BLACK_KEYS: { code: KeyCode; semi: number; pos: number }[] = [
  { code: "KeyW", semi: 1, pos: 0 },
  { code: "KeyE", semi: 3, pos: 1 },
  { code: "KeyT", semi: 6, pos: 3 },
  { code: "KeyY", semi: 8, pos: 4 },
  { code: "KeyU", semi: 10, pos: 5 },
  { code: "KeyO", semi: 13, pos: 7 },
  { code: "KeyP", semi: 15, pos: 8 },
];

const WHITE_NOTES = ["C", "D", "E", "F", "G", "A", "B"]; // note-name captions for the piano
const anchorMidi = () => 12 * (octave + 1); // C of the current octave
const litUntil = new Map<number, number>(); // midi → until-timestamp, for key highlights

// ---------- Backing grooves (Music scheduler) ----------
// Each groove is 4 chords × 16 sixteenth-steps of composed melody + bass, plus
// a drum pattern. 0 = rest. All share the scheduler's fixed 150ms step.

/* oxfmt-ignore-start */
const GROOVES = [
  {
    name: "Chill", // C – G – Am – F, lazy arpeggios
    leadVol: 0.16,
    melody: [
      72, 0, 0, 0, 76, 0, 74, 0, 72, 0, 79, 0, 76, 0, 74, 0, 71, 0, 0, 0, 74, 0, 71, 0, 67, 0, 74,
      0, 79, 0, 74, 0, 69, 0, 0, 0, 72, 0, 69, 0, 76, 0, 72, 0, 69, 0, 72, 0, 69, 0, 0, 0, 72, 0,
      69, 0, 77, 0, 76, 0, 72, 0, 74, 0,
    ],
    bass: [
      36, 0, 0, 0, 0, 0, 36, 0, 36, 0, 0, 0, 43, 0, 36, 0, 43, 0, 0, 0, 0, 0, 43, 0, 43, 0, 0, 0,
      50, 0, 43, 0, 45, 0, 0, 0, 0, 0, 45, 0, 45, 0, 0, 0, 52, 0, 45, 0, 41, 0, 0, 0, 0, 0, 41, 0,
      41, 0, 0, 0, 48, 0, 41, 0,
    ],
    kick: [0, 8],
    snare: [4, 12],
    hatEvery: 4,
  },
  {
    name: "Night", // Am – F – C – G, sparse and moody
    leadVol: 0.2,
    melody: [
      69, 0, 0, 0, 0, 0, 72, 0, 71, 0, 69, 0, 0, 0, 0, 0, 72, 0, 0, 0, 0, 0, 76, 0, 74, 0, 72, 0, 0,
      0, 0, 0, 76, 0, 0, 0, 0, 0, 79, 0, 76, 0, 74, 0, 0, 0, 0, 0, 74, 0, 0, 0, 0, 0, 71, 0, 69, 0,
      67, 0, 0, 0, 71, 0,
    ],
    bass: [
      33, 0, 0, 0, 0, 0, 0, 0, 33, 0, 40, 0, 0, 0, 0, 0, 29, 0, 0, 0, 0, 0, 0, 0, 29, 0, 36, 0, 0,
      0, 0, 0, 36, 0, 0, 0, 0, 0, 0, 0, 36, 0, 43, 0, 0, 0, 0, 0, 31, 0, 0, 0, 0, 0, 0, 0, 31, 0,
      38, 0, 0, 0, 0, 0,
    ],
    kick: [0, 10],
    snare: [8],
    hatEvery: 8,
  },
  {
    name: "Bounce", // C – Am – F – G, driving eighths
    leadVol: 0.12,
    melody: [
      72, 0, 72, 0, 76, 0, 72, 0, 79, 0, 76, 0, 72, 76, 74, 0, 72, 0, 72, 0, 76, 0, 72, 0, 81, 0,
      79, 0, 76, 0, 74, 0, 69, 0, 69, 0, 72, 0, 69, 0, 77, 0, 76, 0, 74, 0, 72, 0, 71, 0, 71, 0, 74,
      0, 71, 0, 79, 0, 74, 0, 71, 74, 76, 0,
    ],
    bass: [
      36, 0, 43, 0, 36, 0, 43, 0, 36, 0, 43, 0, 36, 0, 43, 0, 33, 0, 40, 0, 33, 0, 40, 0, 33, 0, 40,
      0, 33, 0, 40, 0, 29, 0, 36, 0, 29, 0, 36, 0, 29, 0, 36, 0, 29, 0, 36, 0, 31, 0, 38, 0, 31, 0,
      38, 0, 31, 0, 38, 0, 31, 0, 38, 0,
    ],
    kick: [0, 4, 8, 12],
    snare: [4, 12],
    hatEvery: 2,
  },
];
/* oxfmt-ignore-end */

let grooveIdx = 0;
let backing = false;
let musicStarted = false;

// ---------- Mixer wiring ----------
// A shared "hall" reverb both buses send into, and a MASTER low-pass (Cutoff)
// that filters the whole mix. Declaring these creates no AudioContext (the
// graph materializes on the first note), so it is safe at load.
Audio.Mixer.reverb("hall", { seconds: 2.4, decay: 2.2, wet: 0.9 });
// A tempo-ish feedback echo that both buses can send into, beside the reverb.
Audio.Mixer.delay("echo", { time: 0.3, feedback: 0.36, wet: 0.9 });
const toneFilter = Audio.Mixer.masterFilter("lowpass", 20000);
// A limiter on the master glues the mix and keeps peaks from clipping when you
// roll the keys and notes stack up.
Audio.Mixer.compressor();
let reverbOn = false;
let delayOn = false;
let filterOn = false;
let lastPointerMidi: number | null = null; // for hold-and-roll on the piano
// Continuous mix/filter amounts, driven by the on-screen sliders.
let masterVol = 1;
let reverbWet = 0.4;
let cutoff = 1200; // low-pass cutoff (Hz) when the filter is engaged

// Push the current state to the mixer. Verb sends BOTH buses into the reverb
// (instrument + backing) and Cutoff is a master filter, so all three knobs act
// on the whole synth.
function applyReverb() {
  const level = reverbOn ? reverbWet : 0;
  Audio.Mixer.bus("sfx").send("hall", level, 200);
  Audio.Mixer.bus("music").send("hall", level, 200);
}
// The echo mirrors the reverb pattern: both buses aux-send into the "echo"
// delay at a fixed level when the toggle is on, zero when off.
function applyDelay() {
  const level = delayOn ? 0.32 : 0;
  Audio.Mixer.bus("sfx").send("echo", level, 200);
  Audio.Mixer.bus("music").send("echo", level, 200);
}
function applyFilter() {
  toneFilter.frequency(filterOn ? cutoff : 20000, 240);
}

function ensureBacking() {
  if (musicStarted) return;
  musicStarted = true;
  Audio.Music.start({
    volume: 0.3,
    bpm: 100, // sixteenths by default, so 150ms per step
    schedule(step, when) {
      if (!backing || Audio.Music.muted) return;
      const g = GROOVES[grooveIdx];
      const i = step % 64;
      // Transpose the pitched parts with the Octave control (drums stay put),
      // so the backing follows the same octave as the keys you play. The lead
      // melody also uses the selected waveform, so the groove's "synth" voice
      // matches the instrument.
      const shift = 12 * (octave - 4);
      const m = g.melody[i];
      if (m) {
        Audio.Music.note(midiFreq(m + shift), 0.3, WAVES[wave], g.leadVol, when);
        glow(m + shift);
      }
      const b = g.bass[i];
      if (b) Audio.Music.note(midiFreq(b + shift), 0.34, "sine", 0.4, when);
      const beat = i % 16;
      if (g.kick.includes(beat)) Audio.Music.kick(when);
      if (g.snare.includes(beat)) Audio.Music.noiseHit(when, 0.12, 0.25, "bandpass", 1800);
      if (i % g.hatEvery === 0) {
        Audio.Music.noiseHit(when, 0.04, beat % 8 === 0 ? 0.16 : 0.08, "highpass", 8000);
      }
    },
  });
}

// ---------- Visualizer ----------

const BAR_COUNT = 36;
const bars = Array.from({ length: BAR_COUNT }, () => ({ h: 0, target: 0 }));

// Light the bars around a pitch — the display maps ~3 octaves (C2..C7).
function glow(midi: number) {
  const center = Mathf.clamp(((midi - 36) / 48) * BAR_COUNT, 0, BAR_COUNT - 1);
  for (let i = 0; i < BAR_COUNT; i++) {
    const d = Math.abs(i - center);
    if (d < 3) bars[i].target = Math.max(bars[i].target, 1 - d * 0.3);
  }
}

// ---------- Input ----------

function handleInput() {
  // Keyboard plays the instrument (the on-screen keys mirror it): note keys,
  // Z/X octave, 1-4 waveform. Those keys still work AND stay in sync with the
  // SYNTH panel's tab strip + Octave slider; the mixer/backing controls are
  // UI-only.
  for (const k of [...WHITE_KEYS, ...BLACK_KEYS]) {
    if (Keys.pressed(k.code)) playNote(anchorMidi() + k.semi);
  }
  if (Keys.pressed("KeyZ")) octave = Math.max(2, octave - 1);
  if (Keys.pressed("KeyX")) octave = Math.min(6, octave + 1);
  for (let d = 0; d < 4; d++) {
    if (Keys.pressed(`Digit${d + 1}` as KeyCode)) wave = d;
  }

  // The on-screen piano plays too — hold the mouse/finger down and roll across
  // the keys; each new key under the pointer retriggers. Releasing clears the
  // last key so tapping the same one again fires.
  const p = piano();
  if (Pointer.down && Pointer.y >= p.y) {
    let semi = null;
    for (const k of BLACK_KEYS) {
      const r = blackRect(p, k);
      if (Pointer.x >= r.x && Pointer.x < r.x + r.w && Pointer.y < r.y + r.h) {
        semi = k.semi;
        break;
      }
    }
    if (semi === null) {
      const idx = Mathf.clamp(Math.floor(Pointer.x / p.keyW), 0, WHITE_KEYS.length - 1);
      semi = WHITE_KEYS[idx].semi;
    }
    const midi = anchorMidi() + semi;
    if (midi !== lastPointerMidi) {
      lastPointerMidi = midi;
      playNote(midi);
    }
  } else {
    lastPointerMidi = null;
  }
}

// ---------- Drawing ----------

const piano = () => {
  const h = Math.min(170, vp.h * 0.3);
  return { y: vp.h - h, h, keyW: vp.w / WHITE_KEYS.length };
};
const blackRect = (p: ReturnType<typeof piano>, k: { pos: number }) => ({
  x: (k.pos + 1) * p.keyW - p.keyW * 0.3,
  y: p.y,
  w: p.keyW * 0.6,
  h: p.h * 0.58,
});
const isLit = (midi: number) => (litUntil.get(midi) ?? 0) > performance.now();

Loop.run({
  update() {
    handleInput();
    for (const b of bars) {
      b.h += (b.target - b.h) * 0.2;
      b.target *= 0.9;
    }
  },

  draw(ctx) {
    const p = piano();

    // Visualizer bars fill the space above the piano.
    const barW = vp.w / BAR_COUNT;
    const maxH = (p.y - 120) * 0.9;
    for (let i = 0; i < BAR_COUNT; i++) {
      const h = Math.max(2, bars[i].h * maxH);
      const hue = 180 + (i / BAR_COUNT) * 140;
      ctx.fillStyle = `hsl(${hue}, 70%, ${35 + bars[i].h * 30}%)`;
      ctx.fillRect(i * barW + 2, p.y - 16 - h, barW - 4, h);
    }

    // Every control is also a UI widget — the wave tab strip and Octave slider
    // MIRROR the live 1-4 / Z-X keyboard shortcuts (change either and both stay
    // in sync); groove is a select, filter/level amounts are sliders, toggles
    // are checkboxes, and the backing has a play/pause button. The group auto-
    // sizes to its content and is the only thing drawn in the top-left corner.
    UI.panel({ x: 12, y: 12, w: 340, title: "SYNTH" }, () => {
      wave = UI.tabs({ id: "mx-wave", items: WAVES, active: wave });
      octave = UI.slider({
        id: "mx-oct",
        label: "Octave",
        min: 2,
        max: 6,
        step: 1,
        value: octave,
        w: 210,
        format: (v) => `C${v}`,
      });
      // The backing groove lives in its own group: pick the groove, and the
      // play/pause button starts/stops it. The Mute checkbox is bound to
      // `Audio.Music.muted`; persistence, when desired, belongs to
      // `minimotor/storage` rather than the audio engine.
      UI.panel({ title: "Music" }, () => {
        UI.row({ gap: 12 }, () => {
          const groove = UI.select({
            id: "mx-groove",
            value: grooveIdx,
            w: 150,
            options: GROOVES.map((g, i) => ({ label: g.name, value: i })),
          });
          if (groove.value !== grooveIdx) grooveIdx = groove.value;
          if (UI.button({ id: "mx-play", label: backing ? "❚❚ Pause" : "▶ Play" })) {
            if (!backing) ensureBacking();
            backing = !backing;
          }
        });
        const muteNow = UI.toggle({ id: "mx-mute", label: "Muted", on: Audio.Music.muted });
        if (muteNow !== Audio.Music.muted) Audio.Music.muted = muteNow;
      });
      UI.row({ gap: 18 }, () => {
        const rv = UI.toggle({ id: "mx-reverb", label: "Reverb", on: reverbOn });
        if (rv !== reverbOn) {
          reverbOn = rv;
          applyReverb();
        }
        const dl = UI.toggle({ id: "mx-delay", label: "Delay", on: delayOn });
        if (dl !== delayOn) {
          delayOn = dl;
          applyDelay();
        }
        const ff = UI.toggle({ id: "mx-filter", label: "Filter", on: filterOn });
        if (ff !== filterOn) {
          filterOn = ff;
          applyFilter();
        }
      });
      const mv = UI.slider({
        id: "mx-master",
        label: "Master",
        value: masterVol,
        w: 210,
        format: (v) => `${Math.round(v * 100)}%`,
      });
      if (mv !== masterVol) {
        masterVol = mv;
        Audio.master.volume = mv;
      }
      const rw = UI.slider({
        id: "mx-wet",
        label: "Verb",
        value: reverbWet,
        w: 210,
        format: (v) => `${Math.round(v * 100)}%`,
      });
      if (rw !== reverbWet) {
        reverbWet = rw;
        reverbOn = rw > 0; // dragging Verb up engages reverb (the checkbox follows)
        applyReverb();
      }
      const cf = UI.slider({
        id: "mx-cut",
        label: "Cutoff",
        min: 200,
        max: 20000,
        step: 50,
        value: cutoff,
        w: 210,
        format: (v) => `${(v / 1000).toFixed(1)}k`,
      });
      if (cf !== cutoff) {
        cutoff = cf;
        filterOn = cf < 20000; // lowering Cutoff engages the filter (the checkbox follows)
        applyFilter();
      }
    });

    // Piano — white keys…
    for (let i = 0; i < WHITE_KEYS.length; i++) {
      const k = WHITE_KEYS[i];
      const lit = isLit(anchorMidi() + k.semi);
      ctx.fillStyle = lit ? "#4ecdc4" : "#e8e6e3";
      ctx.fillRect(i * p.keyW + 1, p.y, p.keyW - 2, p.h);
      ctx.fillStyle = lit ? "#083" : "#99a";
      ctx.font = "13px monospace";
      ctx.fillText(WHITE_NOTES[i % 7], i * p.keyW + p.keyW / 2 - 4, vp.h - 10);
    }
    // …then black keys on top.
    for (const k of BLACK_KEYS) {
      const r = blackRect(p, k);
      const lit = isLit(anchorMidi() + k.semi);
      ctx.fillStyle = lit ? "#4ecdc4" : "#1a1c24";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = lit ? "#083" : "#667";
      ctx.font = "11px monospace";
      ctx.fillText(`${WHITE_NOTES[k.pos % 7]}#`, r.x + r.w / 2 - 6, r.y + r.h - 8);
    }

    if (litUntil.size === 0) {
      Draw.text("play with the keyboard or click the keys · shape it in SYNTH", {
        x: vp.w / 2,
        y: p.y - 26,
        font: "15px monospace",
        color: "#aab",
        align: "center",
      });
    }
  },
});
