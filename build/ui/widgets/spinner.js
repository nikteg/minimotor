// ---------- spinner ----------
import { ensureWired, onStep, place, uiSlot, theme, uiCtx } from "../../ui/core/index.js";
// Rotation phase, advanced on the fixed step (via onStep) so it pauses with the
// loop. ~7 rad/s at 60 steps.
const spin = uiSlot(() => ({ angle: 0 }));
let hooksRegistered = false;
function ensureSpinnerHooks() {
    if (hooksRegistered)
        return;
    hooksRegistered = true;
    onStep(() => {
        spin().angle += 0.12;
    });
}
/** A rotating "busy" arc for in-flight work (loading, refreshing). Advances
 *  on the fixed step, so it pauses with the loop:
 *
 *    if (refreshing) UI.spinner({ x, y });   // x/y = arc center
 *    if (busy) UI.spinner();                 // auto-flows into the current row */
export function spinner(opts = {}) {
    const ctx = uiCtx();
    ensureWired();
    ensureSpinnerHooks(); // the step hook advances the angle
    const r = opts.r ?? 8;
    // Pinned: x/y are the arc CENTER (a spinner is a point, not a box). Flowing:
    // reserve a 2r square and spin in its middle.
    let cx, cy;
    if (opts.x !== undefined || opts.y !== undefined) {
        cx = opts.x ?? 0;
        cy = opts.y ?? 0;
    }
    else {
        const box = place(opts, r * 2, r * 2, "spinner");
        cx = box.x + box.w / 2;
        cy = box.y + box.h / 2;
    }
    ctx.save();
    ctx.strokeStyle = opts.color ?? theme.accent;
    ctx.lineWidth = opts.lineWidth ?? 3;
    ctx.beginPath();
    const angle = spin().angle;
    ctx.arc(cx, cy, r, angle, angle + Math.PI * 1.4);
    ctx.stroke();
    ctx.restore();
}
