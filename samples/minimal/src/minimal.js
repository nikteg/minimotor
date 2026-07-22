// Absolute minimal game: colored square that moves with arrow keys
import { Draw, Keys, Loop, Perf, Stage, UI } from "minimotor";

// The viewport is LIVE (mutated on resize) — no rebinding needed; the engine
// owns clearing via `background`.
const view = Stage.init("game", { background: "#222", plugins: [Perf.plugin()] });

let x = view.w / 2 - 25;
let y = view.h / 2 - 25;

Loop.run({
  update() {
    if (Keys.down("ArrowLeft")) x -= 3;
    if (Keys.down("ArrowRight")) x += 3;
    if (Keys.down("ArrowUp")) y -= 3;
    if (Keys.down("ArrowDown")) y += 3;
    x = Math.max(0, Math.min(view.w - 50, x));
    y = Math.max(0, Math.min(view.h - 50, y));
  },
  draw() {
    Draw.rect(x, y, 50, 50, "#4ecdc4");
    UI.text("Arrow keys to move", { x: 10, y: 6, size: 14 });
  },
});
