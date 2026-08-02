import { createDebug } from "minimotor/debug";
// Absolute minimal game: colored square that moves with arrow keys
import { createUI } from "minimotor/ui";
import { Mathf, createApp } from "minimotor";

// The viewport is LIVE (mutated on resize) — no rebinding needed; the engine
// owns clearing via `background`.
const game = createApp("game", { background: "#222" });
createDebug(game, { initial: "performance" });
const view = game.viewport;
const { Draw, Keys, Loop } = game;
const UI = createUI(game);

let x = view.w / 2 - 25;
let y = view.h / 2 - 25;

Loop.run({
  update() {
    if (Keys.down("ArrowLeft")) x -= 3;
    if (Keys.down("ArrowRight")) x += 3;
    if (Keys.down("ArrowUp")) y -= 3;
    if (Keys.down("ArrowDown")) y += 3;
    x = Mathf.clamp(x, 0, view.w - 50);
    y = Mathf.clamp(y, 0, view.h - 50);
  },
  draw() {
    Draw.rect(x, y, 50, 50, "#4ecdc4");
    UI.text("Arrow keys to move", { x: 10, y: 6, size: 14 });
  },
});
