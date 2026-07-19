// Absolute minimal game: colored square that moves with arrow keys
import { Minimotor } from "../../build/index.js";

Minimotor.Engine.use(Minimotor.Perf.plugin());

const vp = Minimotor.Engine.initCanvas("game");

let x = vp.w / 2 - 25;
let y = vp.h / 2 - 25;
const keys = {};

Minimotor.Engine.onKeyDown = (code) => { keys[code] = true; };
window.addEventListener("keyup", (e) => { keys[e.code] = false; });

Minimotor.Engine.start(
  () => {
    if (keys["ArrowLeft"]) x -= 3;
    if (keys["ArrowRight"]) x += 3;
    if (keys["ArrowUp"]) y -= 3;
    if (keys["ArrowDown"]) y += 3;
    x = Math.max(0, Math.min(vp.w - 50, x));
    y = Math.max(0, Math.min(vp.h - 50, y));
  },
  () => {
    const ctx = Minimotor.Engine.ctx;
    ctx.clearRect(0, 0, vp.w, vp.h);
    ctx.fillStyle = "#4ecdc4";
    ctx.fillRect(x, y, 50, 50);
    ctx.fillStyle = "#fff";
    ctx.font = "14px monospace";
    ctx.fillText("Arrow keys to move", 10, 20);
  },
);
