// Juice demo: impact feedback with the engine's Particles, Camera.shake and
// Input.vibrate (plus Mathf randoms for variety).
// Demonstrates: Particles.create() + fx.burst (CPU emitter, clock-derived),
// Camera.shake (decaying screen-shake — applied inside Camera.render),
// Input.vibrate (haptics, no-op on desktop) and Mathf.randRange / randItem.
import { Audio, Camera, Draw, Input, Loop, Mathf, Particles, Perf, Pointer, Stage, UI } from "minimotor";

const view = Stage.init("game", { background: "#14141c", plugins: [Perf.plugin()] });

const COLORS = ["#ff6b6b", "#4ecdc4", "#ffe066", "#a06bff", "#6bff9e", "#ff9f43"];

const fx = Particles.create();

// One shared "impact" — a burst, a shake and a buzz, all scaled by `power`.
function impact(x, y, power) {
  fx.burst({
    at: { x, y },
    count: Math.round(14 * power),
    color: COLORS,
    speed: [(50 * power) / 60, (220 * power) / 60], // old px/s ÷ 60 → px/step
    size: [2, 5],
    life: [400, 900],
    gravity: 500 / 3600, // old px/s² → px/step²
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
      fx.burst({
        at: { x: Pointer.x, y: Pointer.y },
        count: 4,
        color: COLORS,
        speed: [40 / 60, 170 / 60],
        size: [2, 4],
        life: [300, 700],
        gravity: 500 / 3600,
      });
      Camera.shake(2, 120);
      if (sprayTick++ % 4 === 0) Audio.Sfx.blip(Mathf.randRange(180, 320), 0.04, 0.08);
    }
  },

  draw() {
    // Everything except the HUD draws inside the camera block, where the
    // shake offset applies — the whole scene kicks on impact while the label
    // stays readable.
    Camera.render(() => {
      // Faint grid — makes the screen-shake obvious.
      for (let x = 0; x <= view.w; x += 40) Draw.line(x, 0, x, view.h, "rgba(255,255,255,0.05)");
      for (let y = 0; y <= view.h; y += 40) Draw.line(0, y, view.w, y, "rgba(255,255,255,0.05)");

      Draw.particles(fx);
    });

    UI.group({ x: 12, y: 12, w: Math.min(360, view.w - 24), h: 60, title: "JUICE" }, (body) => {
      UI.text(`Particles ${fx.count}   ·   click for a big impact, hold to spray`, {
        h: body.remaining,
        size: 12,
      });
    });
  },
});
