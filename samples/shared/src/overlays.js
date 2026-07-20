// Opinionated game-over / level-complete overlays shared across the sample
// games. These are deliberately NOT part of minimotor — they bake in specific
// copy, colors and layout, which is a game concern, not an engine primitive.
// They lean on the engine's neutral Text helper for alignment.
import { Minimotor } from "minimotor";

const { Text } = Minimotor;

/** Dimmed "GAME OVER" screen with score/best and an optional restart hint.
 *  `w`/`h` is the visible game area (not the full canvas if letterboxed). */
export function drawGameOver(ctx, w, h, score, best, restartHint) {
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0, 0, w, h);
  Text.drawCentered(ctx, "GAME OVER", w / 2, h / 2 - 16, {
    font: "bold 28px monospace",
    color: "#ff6b6b",
  });
  Text.drawCentered(ctx, `Score: ${score}  Best: ${best}`, w / 2, h / 2 + 20);
  if (restartHint) Text.drawCentered(ctx, restartHint, w / 2, h / 2 + 48);
}

/** Dimmed "LEVEL COMPLETE" screen with score, optional subtitle and hint. */
export function drawLevelComplete(ctx, w, h, score, subtitle, restartHint) {
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(0, 0, w, h);
  Text.drawCentered(ctx, "LEVEL COMPLETE! ⭐", w / 2, h / 2 - 30, {
    font: "bold 32px monospace",
    color: "#ffd700",
  });
  Text.drawCentered(ctx, `Score: ${score}`, w / 2, h / 2 + 10);
  if (subtitle) Text.drawCentered(ctx, subtitle, w / 2, h / 2 + 32);
  if (restartHint) Text.drawCentered(ctx, restartHint, w / 2, h / 2 + 58);
}
