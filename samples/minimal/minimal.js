// Absolute minimal game: colored square that moves with arrow keys
import { Minimotor } from "minimotor";

let vp = Minimotor.Stage.init("game", { plugins: [Minimotor.Perf.plugin()] });
Minimotor.Stage.onResize((next) => (vp = next)); // bounds below read vp live

let x = vp.w / 2 - 25;
let y = vp.h / 2 - 25;

Minimotor.Loop.run({
  update() {
    const { Keys } = Minimotor;
    if (Keys.down("ArrowLeft")) x -= 3;
    if (Keys.down("ArrowRight")) x += 3;
    if (Keys.down("ArrowUp")) y -= 3;
    if (Keys.down("ArrowDown")) y += 3;
    x = Math.max(0, Math.min(vp.w - 50, x));
    y = Math.max(0, Math.min(vp.h - 50, y));
  },
  draw() {
    const { ctx } = Minimotor.Draw;
    ctx.clearRect(0, 0, vp.w, vp.h);
    ctx.fillStyle = "#4ecdc4";
    ctx.fillRect(x, y, 50, 50);
    ctx.fillStyle = "#fff";
    ctx.font = "14px monospace";
    ctx.fillText("Arrow keys to move", 10, 20);
  },
});
