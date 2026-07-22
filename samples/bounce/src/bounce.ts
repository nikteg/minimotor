// Bounce: a glowing ball ricochets around the walls; every wall hit counts a
// bounce AND speeds the ball up. Simple on purpose, but juiced — each bounce
// fires spark particles, a short Camera.shake and a soft synth boop, and the
// ball trails and glows. It plays itself; watch it escalate.
import {
  Audio,
  Camera,
  Collision,
  Draw,
  Gizmos,
  Loop,
  Mathf,
  Particles,
  Perf,
  Stage,
  UI,
  Vec2,
} from "minimotor";

// The viewport is LIVE (mutated on resize) — wall bounds read it directly.
const view = Stage.init("game", { plugins: [Perf.plugin()] });

Audio.Mixer.compressor(); // keep stacked bounce notes clean
Audio.Mixer.reverb("hall", { seconds: 0.9, decay: 2.2, wet: 0.4 });
Audio.Mixer.bus("sfx").send("hall", 0.08); // a little space/tail, not a wash

const BALL = 30;
const SPEEDUP = 1.06; // each bounce speeds the ball up…
const MAX_SPEED = 60; // …to a very high ceiling so it can't tunnel out
// The ball is a Vec2 (x/y) AND a Rect (w/h) with a nested velocity Vec2.
const ball = { x: view.w / 2, y: view.h / 2, w: BALL, h: BALL, vel: { x: 2.4, y: 3.1 } };

const clampSpeed = (v: number) => Mathf.clamp(v * SPEEDUP, -MAX_SPEED, MAX_SPEED);

// The bounce note layers a sub for body, a sine fundamental and a triangle
// octave of shimmer — [frequency ×, level, waveform].
const partials: { mul: number; gain: number; type: OscillatorType }[] = [
  { mul: 0.5, gain: 0.1, type: "sine" },
  { mul: 1, gain: 0.16, type: "sine" },
  { mul: 2, gain: 0.06, type: "triangle" },
];
const trail = Gizmos.trail(12); // bounded motion ring
let bounces = 0;
const ballFlash = Gizmos.flash(140); // white "hit" blink on the ball itself
const fx = Particles.create();

function bounceNote() {
  // A full, warm marimba-ish note (custom filter automation → the playSfx
  // escape hatch). Pitch rises with every bounce and never resets or caps.
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
}

function bounceFx(x: number, y: number) {
  Camera.shake(3, 120);
  ballFlash.hit();
  bounceNote();
  fx.burst({
    at: { x, y },
    count: 14,
    speed: [0.7, 3.2],
    size: [2, 5],
    life: [220, 520],
    color: ["#ffd36b", "#ff6b6b", "#ffffff"],
  });
}

const bounds = { x: 0, y: 0, w: view.w, h: view.h };

Loop.run({
  update() {
    Vec2.add(ball, ball.vel); // integrate position by velocity

    // Collision.bounceInBounds reflects the velocity off any wall it crossed
    // and clamps the ball back inside; we react per contact face — speed up,
    // spark, boop — and count it.
    bounds.w = view.w;
    bounds.h = view.h;
    const r = BALL / 2,
      cx = ball.x + r,
      cy = ball.y + r;
    const hit = Collision.bounceInBounds(ball, ball.vel, bounds);
    if (hit.hit) {
      if (hit.left || hit.right) ball.vel.x = clampSpeed(ball.vel.x);
      if (hit.top || hit.bottom) ball.vel.y = clampSpeed(ball.vel.y);
      bounces++;
      bounceFx(hit.left ? 0 : hit.right ? view.w : cx, hit.top ? 0 : hit.bottom ? view.h : cy);
    }

    trail.push(ball.x + r, ball.y + r);
  },
  draw() {
    // Background gradient (screen space, top level).
    Draw.rect(
      0,
      0,
      view.w,
      view.h,
      Draw.linear(0, 0, 0, view.h, [
        [0, "#141726"],
        [1, "#0a0b12"],
      ]),
    );

    // The default camera is identity — this block just applies the shake.
    Camera.render(() => {
      // Motion trail (oldest = faintest/smallest).
      const pts = trail.points;
      Draw.opacity(0.35, () => {
        for (let i = pts.length - 1; i >= 0; i--) {
          const p = pts[i],
            k = i / pts.length;
          Draw.opacity(1 - k, () => Draw.circle(p.x, p.y, (BALL / 2) * (1 - k * 0.6), "#ff6b6b"));
        }
      });

      // Ball: soft glow + body + a specular highlight.
      const r = BALL / 2,
        cx = ball.x + r,
        cy = ball.y + r;
      const glow = Draw.radial(cx, cy, 2, cx, cy, r * 2.2, [
        [0, "rgba(255,150,150,0.5)"],
        [1, "rgba(255,107,107,0)"],
      ]);
      Draw.rect(cx - r * 2.2, cy - r * 2.2, r * 4.4, r * 4.4, glow);
      Draw.circle(cx, cy, r, "#ff6b6b");
      Draw.circle(cx - r * 0.3, cy - r * 0.3, r * 0.28, "rgba(255,255,255,0.6)");

      // Hit flash (Gizmos.flash): blink the ball toward white on each bounce.
      if (ballFlash.value > 0) {
        Draw.opacity(ballFlash.value, () => Draw.circle(cx, cy, r, "#ffffff"));
      }

      Draw.particles(fx);
    });

    UI.group({ x: 10, y: 10, w: 200, h: 60, title: "BOUNCE" }, (body) => {
      UI.text(`Bounces ${bounces}`, { h: body.remaining, size: 13 });
    });
  },
});
