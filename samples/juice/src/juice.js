// Juice demo: impact feedback with the engine's Particles, Camera.shake and
// Input.vibrate (plus Mathf randoms for variety).
// Demonstrates: Minimotor.Particles.burst (CPU emitter, aged on the fixed step),
// Camera.shake (decaying screen-shake — translate the scene by shakeX/Y),
// Input.vibrate (haptics, no-op on desktop) and Mathf.randRange / randItem.
import { Minimotor } from "minimotor";

let vp = Minimotor.Stage.init("game", { plugins: [Minimotor.Perf.plugin()] });
Minimotor.Stage.onResize((next) => (vp = next)); // impact positions read vp live
const { Particles, Camera, Input, Mathf, Pointer, Loop, Audio, UI } = Minimotor;

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
  },

  // The loop hands draw its ctx (update gets the fixed step in ms).
  draw(ctx) {
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

    Particles.draw(ctx);
    ctx.restore();

    UI.group({ x: 12, y: 12, w: Math.min(360, vp.w - 24), h: 60, title: "JUICE" }, (body) => {
      UI.text(`Particles ${Particles.count}   ·   click for a big impact, hold to spray`, {
        h: body.remaining,
        size: 12,
      });
    });
  },
});
