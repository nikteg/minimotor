// Bounce: a glowing ball ricochets around the walls; every wall hit counts a
// bounce AND speeds the ball up. Simple on purpose, but juiced — each bounce
// fires spark Particles, a short Camera.shake and a soft synth boop, and the
// ball trails and glows. It plays itself; watch it escalate.
import { Minimotor } from "minimotor";

const { Stage, Loop, Draw, UI, Audio, Particles, Camera, Goodies } = Minimotor;

let vp = Stage.init("game", { plugins: [Minimotor.Perf.plugin()] });
Stage.onResize((next) => (vp = next)); // wall bounds read vp live

Audio.Mixer.compressor(); // keep stacked bounce notes clean
Audio.Mixer.reverb("hall", { seconds: 0.9, decay: 2.2, wet: 0.4 });
Audio.Mixer.bus("sfx").send("hall", 0.08); // a little space/tail, not a wash

const BALL = 30;
const SPEEDUP = 1.06; // each bounce speeds the ball up…
const MAX_SPEED = 60; // …to a very high ceiling so it can't tunnel out
const ball = { x: vp.w / 2, y: vp.h / 2, w: BALL, h: BALL, vx: 2.4, vy: 3.1 };

const clampSpeed = (v) => Math.max(-MAX_SPEED, Math.min(MAX_SPEED, v * SPEEDUP));

// The bounce note layers a sub for body, a sine fundamental and a triangle
// octave of shimmer — [frequency ×, level, waveform].
const partials = [
  { mul: 0.5, gain: 0.1, type: "sine" },
  { mul: 1, gain: 0.16, type: "sine" },
  { mul: 2, gain: 0.06, type: "triangle" },
];
const trail = [];
let bounces = 0;
const ballFlash = Goodies.flash(140); // white "hit" blink on the ball itself

function bounceFx(x, y) {
  Camera.shake(3, 120);
  ballFlash.hit();
  // A full, warm marimba-ish note (not a thin blip): a sub for body, a sine
  // fundamental and an octave of triangle shimmer, all glided down slightly and
  // shaped by a lowpass that opens then closes, plus a soft fade. Pitch rises
  // with every bounce and never resets or caps.
  Audio.playSfx((ctx, now, out) => {
    const f = 300 + bounces * 12;
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.setValueAtTime(Math.min(f * 6, 9000), now);
    filt.frequency.exponentialRampToValueAtTime(Math.max(f * 2, 500), now + 0.2);
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(1, now + 0.008);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    filt.connect(master).connect(out);
    for (const p of partials) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = p.type;
      osc.frequency.setValueAtTime(f * p.mul * 1.4, now); // slight downward glide
      osc.frequency.exponentialRampToValueAtTime(f * p.mul, now + 0.1);
      g.gain.value = p.gain;
      osc.connect(g).connect(filt);
      osc.start(now);
      osc.stop(now + 0.32);
    }
  });
  Particles.burst(x, y, {
    count: 14, speed: [40, 190], size: [2, 5], life: [220, 520],
    colors: ["#ffd36b", "#ff6b6b", "#ffffff"],
  });
}

Loop.run({
  update() {
    ball.x += ball.vx;
    ball.y += ball.vy;

    // Each wall hit reflects AND speeds the ball up (clamped very high), so runs
    // escalate without the ball ever tunnelling through a wall.
    const r = BALL / 2, cx = ball.x + r, cy = ball.y + r;
    let scored = false;
    if (ball.x < 0) { ball.x = 0; ball.vx = clampSpeed(-ball.vx); scored = true; bounceFx(0, cy); }
    if (ball.x + ball.w > vp.w) { ball.x = vp.w - ball.w; ball.vx = clampSpeed(-ball.vx); scored = true; bounceFx(vp.w, cy); }
    if (ball.y < 0) { ball.y = 0; ball.vy = clampSpeed(-ball.vy); scored = true; bounceFx(cx, 0); }
    if (ball.y + ball.h > vp.h) { ball.y = vp.h - ball.h; ball.vy = clampSpeed(-ball.vy); scored = true; bounceFx(cx, vp.h); }
    if (scored) bounces++;

    ballFlash.tick(Loop.step);

    trail.unshift({ x: cx, y: cy });
    if (trail.length > 12) trail.pop();
  },
  draw() {
    const { ctx } = Draw;
    const bg = ctx.createLinearGradient(0, 0, 0, vp.h);
    bg.addColorStop(0, "#141726");
    bg.addColorStop(1, "#0a0b12");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, vp.w, vp.h);

    ctx.save();
    ctx.translate(Camera.shakeX(), Camera.shakeY());

    // Motion trail (oldest = faintest/smallest).
    for (let i = trail.length - 1; i >= 0; i--) {
      const p = trail[i], k = i / trail.length;
      ctx.globalAlpha = (1 - k) * 0.35;
      ctx.fillStyle = "#ff6b6b";
      ctx.beginPath();
      ctx.arc(p.x, p.y, (BALL / 2) * (1 - k * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Ball: soft glow + body + a specular highlight.
    const r = BALL / 2, cx = ball.x + r, cy = ball.y + r;
    const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, r * 2.2);
    glow.addColorStop(0, "rgba(255,150,150,0.5)");
    glow.addColorStop(1, "rgba(255,107,107,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(cx - r * 2.2, cy - r * 2.2, r * 4.4, r * 4.4);
    ctx.fillStyle = "#ff6b6b";
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.beginPath(); ctx.arc(cx - r * 0.3, cy - r * 0.3, r * 0.28, 0, Math.PI * 2); ctx.fill();

    // Hit flash (Goodies.flash): blink the ball toward white on each bounce.
    if (ballFlash.value > 0) {
      ctx.globalAlpha = ballFlash.value;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    Particles.draw(ctx);
    ctx.restore();

    UI.group({ x: 10, y: 10, w: 200, h: 60, title: "BOUNCE" }, (body) => {
      UI.text(`Bounces ${bounces}`, { h: body.remaining, size: 13 });
    });
  },
});
