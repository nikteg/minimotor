import { createApp, Mathf } from "minimotor";

const app = createApp("game", { background: "#12141c" });
const { Loop, Keys, Draw } = app;
const player = { x: 150, y: 90, size: 28, speed: 3 };

Loop.run({
  update() {
    if (Keys.down("ArrowLeft") || Keys.down("KeyA")) player.x -= player.speed;
    if (Keys.down("ArrowRight") || Keys.down("KeyD")) player.x += player.speed;
    if (Keys.down("ArrowUp") || Keys.down("KeyW")) player.y -= player.speed;
    if (Keys.down("ArrowDown") || Keys.down("KeyS")) player.y += player.speed;
    player.x = Mathf.clamp(player.x, 0, app.viewport.w - player.size);
    player.y = Mathf.clamp(player.y, 0, app.viewport.h - player.size);
  },
  draw() {
    Draw.rect(player.x, player.y, player.size, player.size, "#4ecdc4");
  },
});
