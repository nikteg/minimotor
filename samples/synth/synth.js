// Synth: audio demo with music scheduler and sound effects
// Demonstrates: Audio (music.start, music.note/kick/noiseHit), playSfx, input, visualizer
import { Minimotor } from "../../build/index.js";

const vp = Minimotor.Engine.initCanvas("game");

// ---------- Melodies ----------

// Pentatonic scale
const C = 261.63, D = 293.66, E = 329.63, G = 392.00, A = 440.00, C2 = 523.25;

const melodies = [
  // 1: simple ascending
  [C, E, G, C2, G, E, C],
  // 2: descending arpeggio
  [C2, A, G, E, D, C, E, G, A],
  // 3: bouncy
  [C, D, E, C, E, G, E, D, C],
  // 4: moody
  [E, G, A, C2, A, G, E, D, C],
];
let melodyIdx = 0;
let melodyStep = 0;

// ---------- Visualizer state ----------

const bars = [];
const BAR_COUNT = 32;
for (let i = 0; i < BAR_COUNT; i++) bars.push({ h: 5, target: 5 });

// ---------- Start music on first click ----------

let started = false;
let stepCount = 0;

function beginAudio() {
  if (started) return;
  started = true;

  Minimotor.Audio.music.start({
    volume: 0.3,
    stepMs: 180,
    storageKey: "synth_muted",
    schedule(step, when) {
      if (!Minimotor.Audio.music.on) return;

      // Kick on every beat
      if (step % 4 === 0) Minimotor.Audio.music.kick(when);

      // Hi-hat on offbeats
      if (step % 2 === 1) {
        Minimotor.Audio.music.noiseHit(when, 0.05, 0.15, "highpass", 8000);
      }

      // Melody note every 2 steps
      if (step % 2 === 0) {
        const melody = melodies[melodyIdx];
        const freq = melody[(step / 2) % melody.length];
        Minimotor.Audio.music.note(freq, 0.25, "square", 0.25, when);

        // Boost a visualizer bar
        const barIdx = Math.floor(
          ((step / 2) % melody.length / melody.length) * BAR_COUNT,
        );
        if (barIdx < BAR_COUNT) bars[barIdx].target = 0.8 + Math.random() * 0.2;
      }
    },
  });
}

// ---------- Input ----------

Minimotor.Engine.onKeyDown = (code) => {
  if (code === "Digit1") { melodyIdx = 0; bars.forEach((b) => (b.target = 0.9)); }
  if (code === "Digit2") { melodyIdx = 1; bars.forEach((b) => (b.target = 0.9)); }
  if (code === "Digit3") { melodyIdx = 2; bars.forEach((b) => (b.target = 0.9)); }
  if (code === "Digit4") { melodyIdx = 3; bars.forEach((b) => (b.target = 0.9)); }
  if (code === "Digit5") {
    Minimotor.Audio.music.setOn(false);
    bars.forEach((b) => (b.target = 0.1));
  }
  if (code === "KeyM") Minimotor.Audio.music.setOn(!Minimotor.Audio.music.on);
  if (code === "Space") {
    Minimotor.Audio.playSfx((ctx, now) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.15);
      g.gain.setValueAtTime(0.3, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.connect(g).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.3);
    });
    bars.forEach((b) => (b.target = 1));
  }
};

vp.canvas.addEventListener("click", () => beginAudio());

Minimotor.Perf.withHud(Minimotor.Engine)(
  () => {
    stepCount++;
    // Animate bars toward targets
    for (const b of bars) {
      b.h += (b.target - b.h) * 0.15;
      b.target *= 0.92; // decay
    }
  },
  () => {
    const ctx = Minimotor.Engine.ctx;
    ctx.clearRect(0, 0, vp.w, vp.h);

    const barW = vp.w / BAR_COUNT;
    const maxH = vp.h * 0.6;
    const baseY = vp.h * 0.7;

    // Bars
    for (let i = 0; i < BAR_COUNT; i++) {
      const h = Math.max(2, bars[i].h * maxH);
      const hue = (i / BAR_COUNT) * 360;
      const grad = ctx.createLinearGradient(0, baseY - h, 0, baseY);
      grad.addColorStop(0, `hsl(${hue}, 80%, 60%)`);
      grad.addColorStop(1, `hsl(${hue}, 60%, 30%)`);
      ctx.fillStyle = grad;
      ctx.fillRect(i * barW + 2, baseY - h, barW - 4, h);
    }

    // Center info
    ctx.fillStyle = "#fff";
    ctx.font = "18px monospace";
    ctx.textAlign = "center";
    if (!started) {
      ctx.fillText("Click or press Space to start", vp.w / 2, vp.h / 2 - 40);
    }
    const names = ["Ascending", "Arpeggio", "Bouncy", "Moody"];
    ctx.fillText(
      `Melody ${melodyIdx + 1}: ${names[melodyIdx]}  ${Minimotor.Audio.music.on ? "🔊" : "🔇"}`,
      vp.w / 2,
      vp.h / 2 - 10,
    );
    ctx.font = "13px monospace";
    ctx.fillStyle = "#888";
    ctx.fillText("1-4 melody · 5 stop · M mute · Space zap", vp.w / 2, vp.h / 2 + 20);
    ctx.textAlign = "start";
  },
);
