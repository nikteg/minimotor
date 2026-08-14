// ---------- Scene transitions ----------
// Cover → swap → reveal: an overlay ramps to full coverage, the scene switches
// behind it at the midpoint, then the overlay ramps back out. Pass one to the
// scene stack's `go`:
//
//   scenes.go("play", { transition: Transitions.fade(400) });
//   scenes.go("over", { transition: Transitions.wipe(500, "down") });
//
// A `Transition` is plain data (duration + how to draw coverage `t`), so custom
// ones are one object literal. The runner (`run`) is pure and fixed-step —
// testable without an engine; an app-bound scene stack drives it for you.
import { clamp } from "../math/mathf.js";
/** Classic fade through a solid color. `durationMs` defaults to 400 ms,
 *  `color` to "#000". */
export function fade(durationMs = 400, color = "#000") {
    return {
        durationMs,
        render(ctx, t, vp) {
            ctx.save();
            ctx.globalAlpha = t;
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, vp.w, vp.h);
            ctx.restore();
        },
    };
}
/** A solid curtain sweeping across the screen. `dir` is the direction the
 *  leading edge travels while covering (default "left"). `durationMs` defaults
 *  to 400 ms, `color` to "#000". */
export function wipe(durationMs = 400, dir = "left", color = "#000") {
    return {
        durationMs,
        render(ctx, t, vp) {
            ctx.save();
            ctx.fillStyle = color;
            const w = vp.w * t;
            const h = vp.h * t;
            if (dir === "left")
                ctx.fillRect(vp.w - w, 0, w, vp.h);
            else if (dir === "right")
                ctx.fillRect(0, 0, w, vp.h);
            else if (dir === "up")
                ctx.fillRect(0, vp.h - h, vp.w, h);
            else
                ctx.fillRect(0, 0, vp.w, h);
            ctx.restore();
        },
    };
}
/** Two solid panels closing toward the middle, then opening again. */
export function curtain(durationMs = 400, color = "#000") {
    return {
        durationMs,
        render(ctx, t, vp) {
            const half = (vp.w * t) / 2;
            ctx.save();
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, half, vp.h);
            ctx.fillRect(vp.w - half, 0, half, vp.h);
            ctx.restore();
        },
    };
}
/** Start a transition: `swap` is called at full coverage (the scene switch the
 *  viewer never sees happen). Pure — no engine dependency. */
export function run(spec, phases) {
    const half = spec.durationMs / 2;
    let elapsed = 0;
    let swapped = false;
    let revealed = false;
    phases.beforeCover?.();
    return {
        advance(dtMs) {
            elapsed += dtMs;
            if (!swapped && elapsed >= half) {
                swapped = true;
                phases.swap();
            }
            if (!revealed && elapsed >= spec.durationMs) {
                revealed = true;
                phases.afterReveal?.();
            }
        },
        draw(ctx, vp) {
            const t = elapsed < half ? elapsed / half : 1 - (elapsed - half) / half;
            spec.render(ctx, clamp(t, 0, 1), vp);
        },
        get done() {
            return elapsed >= spec.durationMs;
        },
    };
}
