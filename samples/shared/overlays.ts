// Opinionated game-over / level-complete overlays shared across the sample
// games. These are deliberately NOT part of minimotor — they bake in specific
// copy, colors and layout, which is a game concern, not an engine primitive.
// They lean on the engine's Draw.text primitive for alignment.
import { Draw } from "minimotor";

/** Dimmed "GAME OVER" screen with score/best and an optional restart hint.
 *  `w`/`h` is the visible game area (not the full canvas if letterboxed).
 *  (The ctx first argument is gone — Draw owns rendering now; callers pass
 *  the same remaining arguments.) */
export function drawGameOver(
  w: number,
  h: number,
  score: number,
  best: number,
  restartHint?: string,
) {
  Draw.rect(0, 0, w, h, "rgba(0,0,0,0.6)");
  Draw.text("GAME OVER", {
    x: w / 2,
    y: h / 2 - 16,
    font: "bold 28px monospace",
    color: "#ff6b6b",
    align: "center",
    baseline: "middle",
  });
  Draw.text(`Score: ${score}  Best: ${best}`, {
    x: w / 2,
    y: h / 2 + 20,
    align: "center",
    baseline: "middle",
  });
  if (restartHint) {
    Draw.text(restartHint, { x: w / 2, y: h / 2 + 48, align: "center", baseline: "middle" });
  }
}

/** Dimmed "LEVEL COMPLETE" screen with score, optional subtitle and hint. */
export function drawLevelComplete(
  w: number,
  h: number,
  score: number,
  subtitle?: string,
  restartHint?: string,
) {
  Draw.rect(0, 0, w, h, "rgba(0,0,0,0.5)");
  Draw.text("LEVEL COMPLETE! ⭐", {
    x: w / 2,
    y: h / 2 - 30,
    font: "bold 32px monospace",
    color: "#ffd700",
    align: "center",
    baseline: "middle",
  });
  Draw.text(`Score: ${score}`, { x: w / 2, y: h / 2 + 10, align: "center", baseline: "middle" });
  if (subtitle) {
    Draw.text(subtitle, { x: w / 2, y: h / 2 + 32, align: "center", baseline: "middle" });
  }
  if (restartHint) {
    Draw.text(restartHint, { x: w / 2, y: h / 2 + 58, align: "center", baseline: "middle" });
  }
}
