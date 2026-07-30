import { App, Mathf } from "minimotor";

// `init` returns the LIVE viewport — a stable object mutated on resize, so
// `view.w` / `view.h` are always current without a resize handler.
const game = App.create("game", { background: "#12141c" });
const view = game.viewport;
const { Loop, Keys, Draw } = game;
const player = { x: 150, y: 90, size: 28, speed: 3 };

Loop.run({
  update() {
    if (Keys.down("ArrowLeft") || Keys.down("KeyA")) player.x -= player.speed;
    if (Keys.down("ArrowRight") || Keys.down("KeyD")) player.x += player.speed;
    if (Keys.down("ArrowUp") || Keys.down("KeyW")) player.y -= player.speed;
    if (Keys.down("ArrowDown") || Keys.down("KeyS")) player.y += player.speed;
    // Keep it on screen (clamp to the live viewport).
    player.x = Mathf.clamp(player.x, 0, view.w - player.size);
    player.y = Mathf.clamp(player.y, 0, view.h - player.size);
  },
  draw() {
    Draw.rect(player.x, player.y, player.size, player.size, "#4ecdc4");
  },
});
