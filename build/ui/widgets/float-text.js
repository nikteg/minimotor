// ---------- Floating text ----------
// Rising, fading score pops / damage numbers / pickup labels. The default pool
// ages on the kernel's fixed step (registered via onStep), so it pauses with the
// loop; make your own pool with createFloatText and drive advance(dt) yourself.
import { currentUiScale, ensureWired, lastWidgetRect, onReset, lifecycleOnce, onStep, uiSlot, uiCtx, uiApp, uiFont, uiToScreen, } from "../../ui/core/index.js";
/** Create a fresh, empty `FloatTextManager` pool. App-bound `UI` keeps a
 *  shared one (`UI.floatText`); make your own for an isolated set of texts. */
export function createFloatText() {
    const texts = [];
    return {
        spawn(text, x, y, opts = {}) {
            const scale = opts.scale ?? 1;
            texts.push({
                text,
                x,
                y,
                vy: (opts.vy ?? -50) * scale,
                vx: (opts.vx ?? 0) * scale,
                life: opts.life ?? 900,
                remaining: opts.life ?? 900,
                color: opts.color ?? "#fff",
                stroke: opts.stroke ?? "",
                strokeWidth: opts.strokeWidth ?? 3,
                font: opts.font ?? uiFont(opts.size ?? 14, opts.bold ?? true),
                scale,
            });
        },
        advance(dt) {
            for (let i = texts.length - 1; i >= 0; i--) {
                const t = texts[i];
                t.remaining -= dt;
                if (t.remaining <= 0) {
                    texts.splice(i, 1);
                    continue;
                }
                t.y += (t.vy * dt) / 1000;
                t.x += (t.vx * dt) / 1000;
            }
        },
        draw(ctx) {
            if (texts.length === 0)
                return;
            ctx.save();
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.lineJoin = "round"; // no spikes off the corners of a thick outline
            for (const t of texts) {
                // Full strength, then fade out over the last half of the lifetime.
                ctx.globalAlpha = Math.min(1, (2 * t.remaining) / t.life);
                ctx.fillStyle = t.color;
                ctx.font = t.font;
                if (t.stroke) {
                    ctx.strokeStyle = t.stroke;
                    ctx.lineWidth = t.strokeWidth;
                }
                if (t.scale === 1) {
                    if (t.stroke)
                        ctx.strokeText(t.text, t.x, t.y);
                    ctx.fillText(t.text, t.x, t.y);
                }
                else {
                    // Scale about the text's own position — the font string is opaque, so
                    // zoom the glyphs with the transform instead of rewriting it (which
                    // takes the outline width along, as it should).
                    ctx.save();
                    ctx.translate(t.x, t.y);
                    ctx.scale(t.scale, t.scale);
                    if (t.stroke)
                        ctx.strokeText(t.text, 0, 0);
                    ctx.fillText(t.text, 0, 0);
                    ctx.restore();
                }
            }
            ctx.restore();
        },
        clear() {
            texts.length = 0;
        },
        get size() {
            return texts.length;
        },
    };
}
// The per-runtime default pool behind `floatText`/`drawFloatText`, aged on the
// fixed step (via `onStep`) so it pauses with the loop like Clock/Tween.
const floats = uiSlot(createFloatText);
const ensureFloatTextHooks = lifecycleOnce(() => {
    onStep(() => {
        const app = uiApp();
        floats().advance(app.Loop.step);
    });
    onReset(() => {
        floats().clear();
    });
});
export function floatText(str, xOrOpts, y, opts) {
    ensureWired();
    ensureFloatTextHooks();
    let px, py;
    if (typeof xOrOpts === "number") {
        px = xOrOpts;
        py = y ?? 0;
    }
    else {
        opts = xOrOpts;
        const anchor = lastWidgetRect();
        px = anchor ? anchor.x + anchor.w / 2 : 0;
        py = anchor ? anchor.y - 4 : 0;
    }
    // Position AND size follow the space the text was spawned in: the point maps
    // out to screen, and the active `UI.scaled` factor rides along as the draw
    // scale (`drawFloatText` paints after the transform is gone).
    const p = uiToScreen(px, py);
    floats().spawn(str, p.x, p.y, { scale: currentUiScale(), ...opts });
}
/** Draw all live floating texts. Call late in `draw` so they sit on top. */
export function drawFloatText() {
    floats().draw(uiCtx());
}
/** Remove all floating texts (e.g. on scene change). */
export function clearFloatText() {
    floats().clear();
}
