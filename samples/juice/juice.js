// Juice demo: impact feedback with the engine's Particles, Camera.shake and
// Input.vibrate (plus Mathf randoms for variety).
// Demonstrates: Minimotor.Particles.burst (CPU emitter, aged on the fixed step),
// Camera.shake (decaying screen-shake — translate the scene by shakeX/Y),
// Input.vibrate (haptics, no-op on desktop) and Mathf.randRange / randItem.
import { Minimotor } from "minimotor";

let vp = Minimotor.Stage.init("game");
Minimotor.Stage.onResize((next) => (vp = next)); // bounce bounds read vp live
const { Particles, Camera, Input, Mathf, Pointer, Draw, Loop, Audio } = Minimotor;

const COLORS = ["#ff6b6b", "#4ecdc4", "#ffe066", "#a06bff", "#6bff9e", "#ff9f43"];

// One shared "impact" — a burst, a shake and a buzz, all scaled by `power`.
function impact(x, y, power) {
  Particles.burst(x, y, {
    count: Math.round(14 * power),
    colors: COLORS,
    speed: [50 * power, 220 * power],
    size: [2, 5],
    life: [400, 900],
    gravity: 500,
  });
  Camera.shake(5 * power, 200 + 60 * power);
  Input.vibrate(Math.min(80, 12 * power));
  // Bigger impacts thump lower and longer.
  Audio.Sfx.blip(320 / power, 0.06 * power, 0.3);
}

// A ball bouncing around the box — every wall hit fires a small impact at the
// contact point, so the juice is always in motion (no clicking required).
const ball = {
  x: vp.w / 2,
  y: vp.h / 2,
  vx: Mathf.randRange(4, 7),
  vy: Mathf.randRange(3, 6),
  r: 16,
  color: Mathf.randItem(COLORS),
};

function step() {
  ball.x += ball.vx;
  ball.y += ball.vy;
  let hit = false;
  if (ball.x - ball.r < 0) {
    ball.x = ball.r;
    ball.vx = Math.abs(ball.vx);
    hit = true;
  } else if (ball.x + ball.r > vp.w) {
    ball.x = vp.w - ball.r;
    ball.vx = -Math.abs(ball.vx);
    hit = true;
  }
  if (ball.y - ball.r < 0) {
    ball.y = ball.r;
    ball.vy = Math.abs(ball.vy);
    hit = true;
  } else if (ball.y + ball.r > vp.h) {
    ball.y = vp.h - ball.r;
    ball.vy = -Math.abs(ball.vy);
    hit = true;
  }
  if (hit) {
    ball.color = Mathf.randItem(COLORS);
    impact(ball.x, ball.y, 1); // speed of a bounce → a modest impact
  }
}

let sprayTick = 0;

Loop.run({
  update() {
    // Click / tap anywhere for a big impact right under the pointer…
    if (Pointer.pressed) impact(Pointer.x, Pointer.y, 3);
    // …and keep spraying while held, with a low rumble and a soft crackle.
    else if (Pointer.down) {
      Particles.burst(Pointer.x, Pointer.y, {
        count: 4,
        colors: COLORS,
        speed: [40, 170],
        size: [2, 4],
        life: [300, 700],
        gravity: 500,
      });
      Camera.shake(2, 120);
      if (sprayTick++ % 4 === 0) Audio.Sfx.blip(Mathf.randRange(180, 320), 0.04, 0.08);
    }
    step();
  },

  draw() {
    const { ctx } = Draw;
    ctx.clearRect(0, 0, vp.w, vp.h);

    // Everything except the HUD is drawn under the shake offset, so the whole
    // scene kicks on impact while the label stays readable.
    ctx.save();
    ctx.translate(Camera.shakeX(), Camera.shakeY());

    // Faint grid — makes the screen-shake obvious.
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= vp.w; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, vp.h);
      ctx.stroke();
    }
    for (let y = 0; y <= vp.h; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(vp.w, y);
      ctx.stroke();
    }

    ctx.fillStyle = ball.color;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();

    Particles.draw(ctx);
    ctx.restore();

    ctx.fillStyle = "#fff";
    ctx.font = "14px monospace";
    ctx.fillText(`Particles: ${Particles.count}   —   click for a big impact, hold to spray`, 12, 24);
  },
});
