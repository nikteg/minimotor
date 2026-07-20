// Synth: a playable instrument + a scheduled backing band.
// Demonstrates: Audio.playSfx (custom voices on the SFX bus), Audio.Music
// (look-ahead scheduler: note/kick/noiseHit), polled Keys/Pointer input.
//
// Play it: A S D F G H J K L ; are the white keys (C major from C4), W E T Y U
// O P the black keys. Z/X shift octaves, 1-4 pick the waveform. Click the
// on-screen piano too. B toggles a backing groove, N picks the next one.
import { Minimotor } from "minimotor";

let vp = Minimotor.Stage.init("game", { plugins: [Minimotor.Perf.plugin()] });
Minimotor.Stage.onResize((next) => (vp = next)); // piano + bars lay out from vp
const { Audio, Keys, Pointer, Text, Mathf, Loop } = Minimotor;

const midiFreq = (m) => 440 * 2 ** ((m - 69) / 12);

// ---------- The instrument ----------

const WAVES = ["sine", "triangle", "square", "sawtooth"];
let wave = 1; // triangle default — soft but present
let octave = 4; // C4 anchor; Z/X shifts

// Two slightly-detuned oscillators through a closing low-pass: a warm pluck.
function playNote(midi) {
  const freq = midiFreq(midi);
  Audio.playSfx((ctx, now, out) => {
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(Math.min(freq * 8, 9000), now);
    f.frequency.exponentialRampToValueAtTime(freq * 2, now + 0.5);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.3, now + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
    f.connect(g).connect(out);
    for (const cents of [-5, 4]) {
      const o = ctx.createOscillator();
      o.type = WAVES[wave];
      o.frequency.value = freq;
      o.detune.value = cents;
      o.connect(f);
      o.start(now);
      o.stop(now + 1.2);
    }
  });
  glow(midi);
  litUntil.set(midi, performance.now() + 180);
}

// Keyboard layout: semitone offsets from the anchor C. `pos` is the white-key
// index a black key sits to the right of.
const WHITE_KEYS = [
  { code: "KeyA", semi: 0, label: "A" },
  { code: "KeyS", semi: 2, label: "S" },
  { code: "KeyD", semi: 4, label: "D" },
  { code: "KeyF", semi: 5, label: "F" },
  { code: "KeyG", semi: 7, label: "G" },
  { code: "KeyH", semi: 9, label: "H" },
  { code: "KeyJ", semi: 11, label: "J" },
  { code: "KeyK", semi: 12, label: "K" },
  { code: "KeyL", semi: 14, label: "L" },
  { code: "Semicolon", semi: 16, label: ";" },
];
const BLACK_KEYS = [
  { code: "KeyW", semi: 1, pos: 0, label: "W" },
  { code: "KeyE", semi: 3, pos: 1, label: "E" },
  { code: "KeyT", semi: 6, pos: 3, label: "T" },
  { code: "KeyY", semi: 8, pos: 4, label: "Y" },
  { code: "KeyU", semi: 10, pos: 5, label: "U" },
  { code: "KeyO", semi: 13, pos: 7, label: "O" },
  { code: "KeyP", semi: 15, pos: 8, label: "P" },
];

const anchorMidi = () => 12 * (octave + 1); // C of the current octave
const litUntil = new Map(); // midi → until-timestamp, for key highlights

// ---------- Backing grooves (Music scheduler) ----------
// Each groove is 4 chords × 16 sixteenth-steps of composed melody + bass, plus
// a drum pattern. 0 = rest. All share the scheduler's fixed 150ms step.

/* oxfmt-ignore-start */
const GROOVES = [
  {
    name: "Chill", // C – G – Am – F, lazy arpeggios
    lead: "triangle", leadVol: 0.16,
    melody: [
      72, 0, 0, 0,  76, 0, 74, 0,  72, 0, 79, 0,  76, 0, 74, 0,
      71, 0, 0, 0,  74, 0, 71, 0,  67, 0, 74, 0,  79, 0, 74, 0,
      69, 0, 0, 0,  72, 0, 69, 0,  76, 0, 72, 0,  69, 0, 72, 0,
      69, 0, 0, 0,  72, 0, 69, 0,  77, 0, 76, 0,  72, 0, 74, 0,
    ],
    bass: [
      36, 0, 0, 0,  0, 0, 36, 0,  36, 0, 0, 0,  43, 0, 36, 0,
      43, 0, 0, 0,  0, 0, 43, 0,  43, 0, 0, 0,  50, 0, 43, 0,
      45, 0, 0, 0,  0, 0, 45, 0,  45, 0, 0, 0,  52, 0, 45, 0,
      41, 0, 0, 0,  0, 0, 41, 0,  41, 0, 0, 0,  48, 0, 41, 0,
    ],
    kick: [0, 8], snare: [4, 12], hatEvery: 4,
  },
  {
    name: "Night", // Am – F – C – G, sparse and moody
    lead: "sine", leadVol: 0.2,
    melody: [
      69, 0, 0, 0,  0, 0, 72, 0,  71, 0, 69, 0,  0, 0, 0, 0,
      72, 0, 0, 0,  0, 0, 76, 0,  74, 0, 72, 0,  0, 0, 0, 0,
      76, 0, 0, 0,  0, 0, 79, 0,  76, 0, 74, 0,  0, 0, 0, 0,
      74, 0, 0, 0,  0, 0, 71, 0,  69, 0, 67, 0,  0, 0, 71, 0,
    ],
    bass: [
      33, 0, 0, 0,  0, 0, 0, 0,  33, 0, 40, 0,  0, 0, 0, 0,
      29, 0, 0, 0,  0, 0, 0, 0,  29, 0, 36, 0,  0, 0, 0, 0,
      36, 0, 0, 0,  0, 0, 0, 0,  36, 0, 43, 0,  0, 0, 0, 0,
      31, 0, 0, 0,  0, 0, 0, 0,  31, 0, 38, 0,  0, 0, 0, 0,
    ],
    kick: [0, 10], snare: [8], hatEvery: 8,
  },
  {
    name: "Bounce", // C – Am – F – G, driving eighths
    lead: "square", leadVol: 0.12,
    melody: [
      72, 0, 72, 0,  76, 0, 72, 0,  79, 0, 76, 0,  72, 76, 74, 0,
      72, 0, 72, 0,  76, 0, 72, 0,  81, 0, 79, 0,  76, 0, 74, 0,
      69, 0, 69, 0,  72, 0, 69, 0,  77, 0, 76, 0,  74, 0, 72, 0,
      71, 0, 71, 0,  74, 0, 71, 0,  79, 0, 74, 0,  71, 74, 76, 0,
    ],
    bass: [
      36, 0, 43, 0,  36, 0, 43, 0,  36, 0, 43, 0,  36, 0, 43, 0,
      33, 0, 40, 0,  33, 0, 40, 0,  33, 0, 40, 0,  33, 0, 40, 0,
      29, 0, 36, 0,  29, 0, 36, 0,  29, 0, 36, 0,  29, 0, 36, 0,
      31, 0, 38, 0,  31, 0, 38, 0,  31, 0, 38, 0,  31, 0, 38, 0,
    ],
    kick: [0, 4, 8, 12], snare: [4, 12], hatEvery: 2,
  },
];
/* oxfmt-ignore-end */

let grooveIdx = 0;
let backing = false;
let musicStarted = false;

function ensureBacking() {
  if (musicStarted) return;
  musicStarted = true;
  Audio.Music.start({
    volume: 0.3,
    stepMs: 150,
    storageKey: "synth_muted",
    schedule(step, when) {
      if (!backing || !Audio.Music.on) return;
      const g = GROOVES[grooveIdx];
      const i = step % 64;
      const m = g.melody[i];
      if (m) {
        Audio.Music.note(midiFreq(m), 0.3, g.lead, g.leadVol, when);
        glow(m);
      }
      const b = g.bass[i];
      if (b) Audio.Music.note(midiFreq(b), 0.34, "sine", 0.4, when);
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
function glow(midi) {
  const center = Mathf.clamp(((midi - 36) / 48) * BAR_COUNT, 0, BAR_COUNT - 1);
  for (let i = 0; i < BAR_COUNT; i++) {
    const d = Math.abs(i - center);
    if (d < 3) bars[i].target = Math.max(bars[i].target, 1 - d * 0.3);
  }
}

// ---------- Input ----------

function handleInput() {
  for (const k of [...WHITE_KEYS, ...BLACK_KEYS]) {
    if (Keys.pressed(k.code)) playNote(anchorMidi() + k.semi);
  }
  if (Keys.pressed("KeyZ")) octave = Math.max(2, octave - 1);
  if (Keys.pressed("KeyX")) octave = Math.min(6, octave + 1);
  for (let d = 0; d < 4; d++) {
    if (Keys.pressed(`Digit${d + 1}`)) wave = d;
  }
  if (Keys.pressed("KeyB")) {
    ensureBacking();
    backing = !backing;
  }
  if (Keys.pressed("KeyN")) grooveIdx = (grooveIdx + 1) % GROOVES.length;
  if (Keys.pressed("KeyM")) Audio.Music.setOn(!Audio.Music.on);

  // Click/tap the on-screen piano.
  if (Pointer.pressed) {
    const p = piano();
    if (Pointer.y >= p.y) {
      for (const k of BLACK_KEYS) {
        const r = blackRect(p, k);
        if (Pointer.x >= r.x && Pointer.x < r.x + r.w && Pointer.y < r.y + r.h) {
          return playNote(anchorMidi() + k.semi);
        }
      }
      const idx = Mathf.clamp(Math.floor(Pointer.x / p.keyW), 0, WHITE_KEYS.length - 1);
      playNote(anchorMidi() + WHITE_KEYS[idx].semi);
    }
  }
}

// ---------- Drawing ----------

const piano = () => {
  const h = Math.min(170, vp.h * 0.3);
  return { y: vp.h - h, h, keyW: vp.w / WHITE_KEYS.length };
};
const blackRect = (p, k) => ({
  x: (k.pos + 1) * p.keyW - p.keyW * 0.3,
  y: p.y,
  w: p.keyW * 0.6,
  h: p.h * 0.58,
});
const isLit = (midi) => (litUntil.get(midi) ?? 0) > performance.now();

Loop.run({
  update() {
    handleInput();
    for (const b of bars) {
      b.h += (b.target - b.h) * 0.2;
      b.target *= 0.9;
    }
  },

  draw(ctx) {
    ctx.fillStyle = "#12141c";
    ctx.fillRect(0, 0, vp.w, vp.h);
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

    // Info
    ctx.fillStyle = "#fff";
    ctx.font = "15px monospace";
    ctx.fillText(`wave: ${WAVES[wave]}   octave: C${octave}`, 12, 26);
    ctx.fillStyle = backing && Audio.Music.on ? "#6bff9e" : "#667";
    ctx.fillText(
      `backing: ${backing ? GROOVES[grooveIdx].name : "off"}${Audio.Music.on ? "" : " (muted)"}`,
      12,
      48,
    );
    ctx.fillStyle = "#889";
    ctx.font = "13px monospace";
    ctx.fillText("A–; white keys · W–P black keys · Z/X octave · 1–4 wave", 12, 74);
    ctx.fillText("B backing on/off · N next groove · M mute music", 12, 92);

    // Piano — white keys…
    for (let i = 0; i < WHITE_KEYS.length; i++) {
      const k = WHITE_KEYS[i];
      const lit = isLit(anchorMidi() + k.semi);
      ctx.fillStyle = lit ? "#4ecdc4" : "#e8e6e3";
      ctx.fillRect(i * p.keyW + 1, p.y, p.keyW - 2, p.h);
      ctx.fillStyle = lit ? "#083" : "#99a";
      ctx.font = "13px monospace";
      ctx.fillText(k.label, i * p.keyW + p.keyW / 2 - 4, vp.h - 10);
    }
    // …then black keys on top.
    for (const k of BLACK_KEYS) {
      const r = blackRect(p, k);
      const lit = isLit(anchorMidi() + k.semi);
      ctx.fillStyle = lit ? "#4ecdc4" : "#1a1c24";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = lit ? "#083" : "#667";
      ctx.font = "11px monospace";
      ctx.fillText(k.label, r.x + r.w / 2 - 3, r.y + r.h - 8);
    }

    if (!musicStarted) {
      Text.drawCentered(ctx, "play the keys — or press B for a backing groove", vp.w / 2, 130, {
        font: "15px monospace",
        color: "#aab",
      });
    }
  },
});
