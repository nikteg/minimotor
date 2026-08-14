// ---------- Hit flash ----------
// The "took damage" white blink: a tiny latch you trigger on a hit and read as
// a 0..1 intensity that fades out. Built on the clock-derived `Anim.animate`
// (a 1 → 0 ramp) — nothing to tick; it fades on its clock and freezes with it.
// It only tracks the timing — the game decides how to show it: blend a fill
// toward white for vector art, or draw a white silhouette over a sprite
// (`Sprites.tint`).
import { animate } from "../anim/index.js";
/** A hit-flash latch: `hit()` on impact, read `value` (1 → 0) as the flash
 *  strength. Cross-genre juice — enemies blinking when shot, the player on
 *  damage, a button on press. `ease` shapes the fade; lives in game time
 *  unless given another clock.
 *
 *    const flash = Gizmos.flash(120);
 *    // on damage: flash.hit();
 *    // vector art:  draw normally, then overlay white at `flash.value` alpha.
 *    // sprite art:  ctx.globalAlpha = flash.value;
 *    //              ctx.drawImage(Sprites.tint(frame, "#fff"), x, y); ctx.globalAlpha = 1; */
export function flash(durationMs, clock, ease) {
    let motion = null;
    return {
        hit() {
            motion = animate({ from: 1, to: 0, ms: durationMs, ease, clock });
        },
        get value() {
            return motion && !motion.done ? motion.value : 0;
        },
        get active() {
            return motion !== null && !motion.done;
        },
    };
}
