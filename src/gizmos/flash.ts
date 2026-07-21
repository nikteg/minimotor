// ---------- Hit flash ----------
// The "took damage" white blink: a tiny latch you trigger on a hit and read as
// a 0..1 intensity that fades out. Built on the composable `Anim.animate`
// value tween (a 1 → 0 ramp), so it's a thin, familiar recipe. It only tracks
// the timing — the game decides how to show it: blend a fill toward white for
// vector art, or draw a white silhouette over a sprite (`Sprites.tint`).

import { animate } from "../anim/index.js";

export interface Flash {
  /** Trigger the flash (intensity jumps to 1). */
  hit(): void;
  /** Fade toward 0 by `dtMs`. */
  tick(dtMs: number): void;
  /** Current intensity, easing from 1 → 0 over `durationMs`. */
  readonly value: number;
  /** True while the flash is visible. */
  readonly active: boolean;
}

/** A hit-flash latch: `hit()` on impact, `tick(stepMs)` each step, and read
 *  `value` (1 → 0) as the flash strength. Cross-genre juice — enemies blinking
 *  when shot, the player on damage, a button on press. `ease` shapes the fade.
 *
 *    const flash = Minimotor.Gizmos.flash(120);
 *    // on damage: flash.hit();   // each step: flash.tick(Loop.step);
 *    // vector art:  draw normally, then overlay white at `flash.value` alpha.
 *    // sprite art:  ctx.globalAlpha = flash.value;
 *    //              ctx.drawImage(Sprites.tint(frame, "#fff"), x, y); ctx.globalAlpha = 1; */
export function flash(durationMs: number, ease?: (t: number) => number): Flash {
  const motion = animate({ from: 1, to: 0, ms: durationMs, ease });
  let live = false;
  return {
    hit() {
      motion.reset();
      live = true;
    },
    tick(dtMs) {
      if (!live) return;
      motion.tick(dtMs);
      if (motion.done) live = false;
    },
    get value() {
      return live ? motion.value : 0;
    },
    get active() {
      return live;
    },
  };
}
