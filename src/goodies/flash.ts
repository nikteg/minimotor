// ---------- Hit flash ----------
// The "took damage" white blink: a tiny latch you trigger on a hit and read as
// a 0..1 intensity that fades out. It only tracks the timing — the game decides
// how to show it: blend a fill toward white for vector art, or draw a white
// silhouette over a sprite (`Sprites.tint`) at this alpha.

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
 *  when shot, the player on damage, a button on press.
 *
 *    const flash = Minimotor.Goodies.flash(120);
 *    // on damage: flash.hit();   // each step: flash.tick(Loop.step);
 *    // vector art:  draw normally, then overlay white at `flash.value` alpha.
 *    // sprite art:  ctx.globalAlpha = flash.value;
 *    //              ctx.drawImage(Sprites.tint(frame, "#fff"), x, y); ctx.globalAlpha = 1; */
export function flash(durationMs: number): Flash {
  const dur = Math.max(1, durationMs);
  let remaining = 0;
  return {
    hit() {
      remaining = dur;
    },
    tick(dtMs) {
      if (remaining > 0) remaining = Math.max(0, remaining - dtMs);
    },
    get value() {
      return remaining / dur;
    },
    get active() {
      return remaining > 0;
    },
  };
}
