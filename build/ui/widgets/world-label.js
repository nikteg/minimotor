import { clamp } from "../../math/mathf.js";
import { currentUiTransform, resolveColor, text, uiApp, uiCtx, } from "../../ui/core/index.js";
function drawArrow(tipX, tipY, dx, dy, color) {
    const distance = Math.hypot(dx, dy) || 1;
    const ux = dx / distance;
    const uy = dy / distance;
    const tailX = tipX - ux * 20;
    const tailY = tipY - uy * 20;
    const ctx = uiCtx();
    ctx.save();
    if (typeof ctx.setTransform === "function") {
        const app = uiApp();
        if (app.ctx === ctx) {
            app.resetTransform();
            const transform = currentUiTransform();
            if (transform) {
                ctx.translate(transform.ox, transform.oy);
                ctx.scale(transform.scale, transform.scale);
            }
        }
    }
    ctx.strokeStyle = resolveColor(color);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(tipX, tipY);
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - ux * 7 + uy * 5, tipY - uy * 7 - ux * 5);
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - ux * 7 - uy * 5, tipY - uy * 7 + ux * 5);
    ctx.stroke();
    ctx.restore();
    // The name sits just beyond the arrow's tail, away from the target.
    return { x: tailX - ux * 5, y: tailY - uy * 5 };
}
/** Draw a camera-aware label over a world target. On-screen labels track the
 * target; off-screen labels clamp to the viewport and point toward it. */
export function worldLabel(label, target, options) {
    const camera = options.camera;
    const app = uiApp();
    const view = app.viewport;
    const wx = target.x + (target.w ?? 0) / 2;
    const wy = target.y + (target.h ?? 0) / 2;
    const center = camera.toScreen({ x: wx, y: wy });
    const labelAt = camera.toScreen({
        x: wx + (options.offset?.x ?? 0),
        y: wy + (options.offset?.y ?? -20),
    });
    const offscreen = center.x < 0 || center.x > view.w || center.y < 0 || center.y > view.h;
    const margin = options.margin ?? 24;
    const point = offscreen ? center : labelAt;
    const tipX = clamp(point.x, view.safeLeft + margin, view.w - view.safeRight - margin);
    const tipY = clamp(point.y, view.safeTop + margin, view.h - view.safeBottom - margin);
    const at = offscreen && options.arrow !== false
        ? drawArrow(tipX, tipY, center.x - tipX, center.y - tipY, options.color)
        : { x: tipX, y: tipY };
    text(label, {
        x: at.x,
        y: at.y,
        align: "center",
        size: options.size,
        bold: options.bold,
        font: options.font,
        color: options.color,
    });
    return { ...at, offscreen };
}
