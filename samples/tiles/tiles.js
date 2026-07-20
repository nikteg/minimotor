// Tilemap demo: Minimotor.Tiles.
// - The level is a plain number[][] built below (0 = air, 1 = grass, 2 = dirt,
//   3 = brick); tiles blit from a small procedurally-baked atlas.
// - map.solidInRect drives the platformer collision: move one axis, test, snap.
// - map.draw culls to the camera view — the HUD shows drawn vs total tiles.
// - Works with keyboard (←→/AD + Space) and a gamepad (left stick + A).
import { Minimotor } from "minimotor";

const vp = Minimotor.Stage.init("game", { plugins: [Minimotor.Perf.plugin()] });
const { Loop, Keys, Draw, Tiles, Camera, Input, Audio } = Minimotor;

const TW = 24;
const COLS = 120;
const ROWS = 20;

// ---- Level: ground with gaps, platforms, brick pillars ----
const level = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
for (let cx = 0; cx < COLS; cx++) {
  if (cx % 19 === 17 || cx % 19 === 18) continue; // gaps to jump
  level[ROWS - 2][cx] = 1; // grass
  level[ROWS - 1][cx] = 2; // dirt below
}
for (let i = 0; i < 14; i++) {
  const px = 8 + i * 8;
  const py = ROWS - 5 - (i % 3) * 2;
  for (let cx = px; cx < Math.min(px + 4, COLS); cx++) level[py][cx] = 1;
}
for (let i = 0; i < 6; i++) {
  const px = 14 + i * 18;
  for (let cy = ROWS - 4; cy < ROWS - 2; cy++) level[cy][px] = 3; // brick pillars
}

// ---- Atlas: three 24px tiles baked once (grass / dirt / brick) ----
const atlas = document.createElement("canvas");
atlas.width = TW * 3;
atlas.height = TW;
{
  const g = atlas.getContext("2d");
  g.fillStyle = "#7a5230"; // grass tile: dirt body…
  g.fillRect(0, 0, TW, TW);
  g.fillStyle = "#69db7c"; // …green top
  g.fillRect(0, 0, TW, 7);
  g.fillStyle = "#7a5230"; // dirt tile
  g.fillRect(TW, 0, TW, TW);
  g.fillStyle = "#5c3d23";
  for (let i = 0; i < 5; i++) g.fillRect(TW + ((i * 7) % 20) + 2, ((i * 11) % 20) + 2, 3, 2);
  g.fillStyle = "#b0575a"; // brick tile
  g.fillRect(TW * 2, 0, TW, TW);
  g.fillStyle = "#8d4245";
  for (let y = 0; y < TW; y += 6) {
    g.fillRect(TW * 2, y, TW, 1);
    g.fillRect(TW * 2 + (y % 12 ? 6 : 14), y, 2, 6);
  }
}

const map = Tiles.grid(level, { tw: TW, atlas });

// ---- Player: AABB + axis-separated tile collision ----
const player = { x: TW * 2, y: 0, w: 16, h: 22, vy: 0, onGround: false };

function moveX(dx) {
  player.x += dx;
  if (!map.solidInRect(player)) return;
  // Snap to the tile boundary we ran into (edge-touching doesn't collide).
  if (dx > 0) player.x = Math.floor((player.x + player.w) / TW) * TW - player.w;
  else player.x = Math.floor(player.x / TW + 1) * TW;
}

function moveY(dy) {
  player.y += dy;
  player.onGround = false;
  if (!map.solidInRect(player)) return;
  if (dy > 0) {
    player.y = Math.floor((player.y + player.h) / TW) * TW - player.h;
    player.onGround = true;
  } else {
    player.y = Math.floor(player.y / TW + 1) * TW;
  }
  player.vy = 0;
}

const cam = Camera.createCamera({
  worldW: map.worldW,
  worldH: map.worldH, // shorter than the view → the camera centers it vertically
  viewW: vp.w,
  viewH: vp.h,
  damping: 0.12,
});
cam.snapTo(player.x, player.y);

const pad = Input.gamepad();
let tilesDrawn = 0;

Loop.run({
  update() {
    const stick = pad.axis(0);
    const move =
      (Keys.down("ArrowLeft") || Keys.down("KeyA") ? -1 : 0) +
      (Keys.down("ArrowRight") || Keys.down("KeyD") ? 1 : 0) +
      stick;
    moveX(Math.max(-1, Math.min(1, move)) * 3.4);

    const jump =
      Keys.pressed("Space") || Keys.pressed("KeyW") || pad.pressed(Input.Buttons.A);
    if (jump && player.onGround) {
      player.vy = -11;
      Audio.Sfx.jump();
    }
    player.vy = Math.min(player.vy + 0.55, 12);
    moveY(player.vy);

    // Fell into a gap → respawn at the start.
    if (player.y > map.worldH + 200) {
      player.x = TW * 2;
      player.y = 0;
      player.vy = 0;
      cam.snapTo(player.x, player.y);
      Audio.Sfx.blip(140, 0.3); // fell — respawn
    }

    cam.update(player.x + player.w / 2, player.y + player.h / 2);
  },

  draw() {
    const { ctx } = Draw;
    ctx.fillStyle = "#1b2432"; // sky
    ctx.fillRect(0, 0, vp.w, vp.h);

    ctx.save();
    // Round the camera offset: a fractional translate antialiases every tile
    // edge and shows as hairline seams between them.
    const camX = Math.round(cam.x);
    const camY = Math.round(cam.y);
    ctx.translate(-camX, -camY);
    tilesDrawn = map.draw(ctx, { x: camX, y: camY, w: vp.w, h: vp.h });

    ctx.fillStyle = "#ffd43b";
    ctx.fillRect(player.x, player.y, player.w, player.h);
    ctx.fillStyle = "#14141c";
    ctx.fillRect(player.x + (player.vy < 0 ? 4 : 3), player.y + 5, 3, 3);
    ctx.fillRect(player.x + 10, player.y + 5, 3, 3);
    ctx.restore();

    ctx.fillStyle = "#8aa";
    ctx.font = "13px monospace";
    ctx.fillText("←→/AD move   Space/W jump   (gamepad: stick + A)", 12, 22);
    const total = COLS * ROWS;
    ctx.fillText(
      `tiles drawn: ${tilesDrawn} of ${total} (culled to camera)` +
        (pad.connected ? "   🎮 connected" : ""),
      12,
      40,
    );
  },
});
