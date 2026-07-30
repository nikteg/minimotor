import { createPerformanceMonitoring } from "minimotor/performance";
// Tilemap demo: Minimotor.Tiles.
// - The level is an ASCII grid ("g" grass, "d" dirt, "b" brick) built below;
//   tiles blit from a small procedurally-baked atlas via the skin.
// - Collision.moveAndSlide drives the platformer collision: it sweeps the
//   player rect against the solid tiles and reports which faces made contact.
// - Draw.tiles culls to the camera view.
// - Works with keyboard (←→/AD + Space) and a gamepad (left stick + A).
import { createAudio } from "minimotor/audio";
import { createCamera } from "minimotor/camera";
import { createInput } from "minimotor/input";
import { createUI } from "minimotor/ui";
import { Collision, Mathf, Sprites, App, Tiles } from "minimotor";

const game = App.create("game", { background: "#1b2432" });
createPerformanceMonitoring(game);
const { Draw, Keys, Loop } = game;
const Audio = createAudio(game);
const Camera = createCamera(game);
const Input = createInput(game);
const UI = createUI(game, Input);

const TW = 24;
const COLS = 120;
const ROWS = 20;

// ---- Level: ground with gaps, platforms, brick pillars ----
// Same procedural shape as ever, emitted as the ASCII grid Tiles.grid parses.
const cells = Array.from({ length: ROWS }, () => new Array(COLS).fill("."));
for (let cx = 0; cx < COLS; cx++) {
  if (cx % 19 === 17 || cx % 19 === 18) continue; // gaps to jump
  cells[ROWS - 2][cx] = "g"; // grass
  cells[ROWS - 1][cx] = "d"; // dirt below
}
for (let i = 0; i < 14; i++) {
  const px = 8 + i * 8;
  const py = ROWS - 5 - (i % 3) * 2;
  for (let cx = px; cx < Math.min(px + 4, COLS); cx++) cells[py][cx] = "g";
}
for (let i = 0; i < 6; i++) {
  const px = 14 + i * 18;
  for (let cy = ROWS - 4; cy < ROWS - 2; cy++) cells[cy][px] = "b"; // brick pillars
}
const ascii = cells.map((row) => row.join("")).join("\n");

const level = Tiles.grid(ascii, {
  size: TW,
  legend: {
    g: { solid: true },
    d: { solid: true },
    b: { solid: true },
  },
});

// ---- Atlas: three 24px tiles baked once (grass / dirt / brick) ----
// Sprites.atlas owns the canvas/context; each tile draws from its own top-left
// corner (the default origin). The skin maps legend chars to atlas cells.
const atlas = Sprites.atlas(TW, TW, 3, (g, i) => {
  if (i === 0) {
    g.fillStyle = "#7a5230"; // grass tile: dirt body…
    g.fillRect(0, 0, TW, TW);
    g.fillStyle = "#69db7c"; // …green top
    g.fillRect(0, 0, TW, 7);
  } else if (i === 1) {
    g.fillStyle = "#7a5230"; // dirt tile
    g.fillRect(0, 0, TW, TW);
    g.fillStyle = "#5c3d23";
    for (let d = 0; d < 5; d++) g.fillRect(((d * 7) % 20) + 2, ((d * 11) % 20) + 2, 3, 2);
  } else {
    g.fillStyle = "#b0575a"; // brick tile
    g.fillRect(0, 0, TW, TW);
    g.fillStyle = "#8d4245";
    for (let y = 0; y < TW; y += 6) {
      g.fillRect(0, y, TW, 1);
      g.fillRect(y % 12 ? 6 : 14, y, 2, 6);
    }
  }
});

const cell = (i: number) => ({ image: atlas, sx: i * TW, sy: 0, sw: TW, sh: TW });
const skin = { g: cell(0), d: cell(1), b: cell(2) };

// ---- Player: an AABB moved by the engine's kinematic tile solver ----
const player = { x: TW * 2, y: 0, w: 16, h: 22, vel: { x: 0, y: 0 }, grounded: false };

Camera.follow(player, { world: level.rect, damping: 0.12 });
Camera.snap();

const pad = Input.gamepad();

Loop.run({
  update() {
    const stick = pad.axis(0);
    const move =
      (Keys.down("ArrowLeft") || Keys.down("KeyA") ? -1 : 0) +
      (Keys.down("ArrowRight") || Keys.down("KeyD") ? 1 : 0) +
      stick;
    player.vel.x = Mathf.clamp(move, -1, 1) * 3.4;

    const jump = Keys.pressed("Space") || Keys.pressed("KeyW") || pad.pressed(Input.Buttons.A);
    if (jump && player.grounded) {
      player.vel.y = -11;
      Audio.Sfx.jump();
    }
    player.vel.y = Math.min(player.vel.y + 0.55, 12);

    // One kinematic step: sweep the player rect by its velocity against the
    // solid tiles. Blocked components are zeroed and `grounded` maintained.
    Collision.moveAndSlide(player, level);

    // Fell into a gap → respawn at the start.
    if (player.y > level.rect.h + 200) {
      player.x = TW * 2;
      player.y = 0;
      player.vel.y = 0;
      Camera.snap();
      Audio.Sfx.blip(140, 0.3); // fell — respawn
    }
  },

  draw() {
    Camera.render(() => {
      Draw.tiles(level, skin);
      Draw.rect(player, "#ffd43b");
      Draw.rect(player.x + (player.vel.y < 0 ? 4 : 3), player.y + 5, 3, 3, "#14141c");
      Draw.rect(player.x + 10, player.y + 5, 3, 3, "#14141c");
    });

    UI.text("←→/AD move   Space/W jump   (gamepad: stick + A)", { x: 12, y: 10, color: "dim" });
    UI.text(
      `${COLS}×${ROWS} tiles (drawing culls to the camera view)` +
        (pad.connected ? "   🎮 connected" : ""),
      { x: 12, y: 28, color: "dim" },
    );
  },
});
