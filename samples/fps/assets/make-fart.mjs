import { writeFileSync } from "node:fs";

const RATE = 44100;
const SECONDS = 1.35;
const N = Math.round(RATE * SECONDS);

// Deterministic noise so the committed asset is reproducible from this script.
let seed = 0x2f6e2b1;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000) * 2 - 1;

// A fart is a relaxation oscillator: tissue buckles, releases, buckles again.
// The buzz is therefore a PULSE TRAIN whose period wanders, not a tone — the
// wander is what stops it sounding like a bass note. Everything else (the
// sag, the closing resonant filter, the turbulence) is shaping on top.
const out = new Float32Array(N);
let phase = 0;
// Two-pole state-variable lowpass, swept.
let lp = 0,
  bp = 0;
// Slow wobble oscillators for the flutter.
let w1 = 0,
  w2 = 0;

for (let i = 0; i < N; i++) {
  const t = i / RATE;

  // Pitch: starts high-ish, sags away. The sag is the single most important
  // cue; a steady version of this is just a rude bass note.
  const sag = 118 * Math.exp(-2.3 * t) + 46;
  w1 += 0.00055;
  w2 += 0.00191;
  const flutter = 1 + 0.22 * Math.sin(w1 * 60) + 0.11 * Math.sin(w2 * 60 + 1.3);
  const f0 = sag * flutter;

  phase += f0 / RATE;
  if (phase >= 1) phase -= 1;

  // Asymmetric pulse: a fast rising edge and a slow fall reads as "buzzy"
  // rather than "square". Duty wanders with the flutter too.
  const duty = 0.32 + 0.12 * Math.sin(w1 * 37);
  const pulse = phase < duty ? 1 - (phase / duty) * 2 : -1 + ((phase - duty) / (1 - duty)) * 2;

  // Turbulence, gated by the pulse so the hiss pumps with the buzz instead of
  // sitting behind it as a flat layer.
  const gate = 0.45 + 0.55 * Math.abs(pulse);
  const air = rnd() * 0.5 * gate;

  // Amplitude: quick opening, an uneven middle, and two late puffs — the
  // afterthought is what sells it.
  const body = Math.min(1, t / 0.02) * Math.exp(-1.9 * t);
  const stutter = 1 + 0.35 * Math.sin(w1 * 148) * Math.sin(w2 * 91);
  const puff1 = Math.exp(-90 * (t - 0.92) ** 2) * 0.5;
  const puff2 = Math.exp(-140 * (t - 1.12) ** 2) * 0.32;
  const amp = body * stutter + puff1 + puff2;

  // Resonant lowpass closing as the pitch falls — the mouth of it shutting.
  const cutoff = Math.min(0.42, ((f0 * 5.5) / RATE) * 2 * Math.PI);
  const q = 1 / 3.2;
  bp += cutoff * (pulse * 0.8 + air - lp - q * bp);
  lp += cutoff * bp;

  out[i] = lp * amp;
}

// Normalise with a little headroom, then soft-clip so the peaks have grit.
let peak = 0;
for (const v of out) peak = Math.max(peak, Math.abs(v));
for (let i = 0; i < N; i++) out[i] = Math.tanh((out[i] / peak) * 1.6) * 0.86;
// De-click the tail.
const fade = Math.round(RATE * 0.03);
for (let i = 0; i < fade; i++) out[N - 1 - i] *= i / fade;

const data = Buffer.alloc(N * 2);
for (let i = 0; i < N; i++)
  data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(out[i] * 32767))), i * 2);
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(data.length, 40);
writeFileSync(process.argv[2], Buffer.concat([header, data]));
console.log("wrote", process.argv[2], (44 + data.length) / 1024, "KiB");
