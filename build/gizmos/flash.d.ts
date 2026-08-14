import type { ClockHandle } from "../clock/index.js";
/** A hit-flash latch returned by `flash()`: `hit()` to trigger, read `value` (1 → 0). */
export interface Flash {
    /** Trigger the flash (intensity jumps to 1). */
    hit(): void;
    /** Current intensity, easing from 1 → 0 over `durationMs`. */
    readonly value: number;
    /** True while the flash is visible. */
    readonly active: boolean;
}
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
export declare function flash(durationMs: number, clock: ClockHandle, ease?: (t: number) => number): Flash;
