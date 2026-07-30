import { createPerformanceMonitoring } from "minimotor/performance";
import { createInput } from "minimotor/input";
import { createOnscreenInput } from "minimotor/onscreen-input";
import { createUI } from "minimotor/ui";
import { App, Goodies, Gizmos } from "minimotor";

const game = App.create("game", { background: "#0f141a" });
createPerformanceMonitoring(game);
const view = game.viewport;
const { Loop, Draw } = game;
const Input = createInput(game);
const UI = createUI(game, Input);
const OnscreenInput = createOnscreenInput(game, Input);

// An on-screen gamepad: a left analog stick + two face buttons. `autohide:false`
// keeps it on screen on desktop too — a mouse drives it while it's visible, and
// touch always does. On a phone it's the whole controller.
const pad = OnscreenInput.gamepad({
  autohide: false,
  opacity: 0.6,
  haptics: true,
  stick: { anchor: { side: "left", x: 92, y: 92 }, radius: 62 },
  buttons: [
    { anchor: { side: "right", x: 138, y: 78 }, r: 36, button: "a", label: "GO" },
    { anchor: { side: "right", x: 74, y: 146 }, r: 30, button: "b", label: "◼" },
  ],
});

// The pad feeds the SAME action map as the keyboard — one code path.
const input = Input.map(
  {
    up: ["KeyW", "ArrowUp", "pad:lstick-up"],
    down: ["KeyS", "ArrowDown", "pad:lstick-down"],
    left: ["KeyA", "ArrowLeft", "pad:lstick-left"],
    right: ["KeyD", "ArrowRight", "pad:lstick-right"],
    boost: ["Space", "pad:a"],
    brake: ["ShiftLeft", "pad:b"],
  },
  { pad },
);

const rover = { x: view.w / 2, y: view.h / 2 };
const trail = Gizmos.trail(42);

Loop.run({
  update() {
    const move = input.vector("left", "right", "up", "down"); // analog, no diagonal boost
    const speed = (input.brake.down ? 0.5 : 1) * (input.boost.down ? 6 : 3.4);
    rover.x = Goodies.wrap(rover.x + move.x * speed, view.w);
    rover.y = Goodies.wrap(rover.y + move.y * speed, view.h);
    trail.push(rover.x, rover.y);
  },
  draw() {
    // points are newest-first; fade toward the oldest tail end.
    const pts = trail.points;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      Draw.opacity(((pts.length - 1 - i) / pts.length) * 0.5, () =>
        Draw.circle(p.x, p.y, 4, "#2a6f78"),
      );
    }
    Draw.circle(rover.x, rover.y, 12, input.boost.down ? "#ffd166" : "#4ecdc4");
    UI.text("Drive with the stick + GO — or WASD / arrows + Space", {
      x: 12,
      y: 10,
      size: 13,
      color: "dim",
    });
    OnscreenInput.drawControls(pad); // screen space — call in draw
  },
});
