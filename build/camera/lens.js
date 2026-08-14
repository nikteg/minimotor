// ---------- Camera lens implementation ----------
// A camera is a LENS: it maps a world rect onto a screen rect. The default
// camera maps its visible world slice onto the whole canvas; `Draw.*` calls
// inside `Camera.render(fn)` are world space, everything outside is screen space.
// Extra lenses (`createLens`) map onto screen sub-rects via `into` for
// minimaps and split screen.
//
// Advancement is pull-based (API_PLAN law 4): follow damping and shake catch up
// forward by the number of fixed steps elapsed since the last read. Dropped
// cameras cost nothing and GC away with their owning app or standalone lens.
import { lazySteps } from "../clock/lazySteps.js";
import { clamp } from "../math/mathf.js";
const STEPS_PER_MS = 60 / 1000;
/** Deterministic per-step jitter in [-1, 1] — pull-derived shake needs no
 *  stored randomness. */
function wobble(seed) {
    const s = Math.sin(seed) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
}
function normRect(r) {
    return { x: r.x ?? 0, y: r.y ?? 0, w: r.w, h: r.h };
}
export function createLens(options) {
    const steps = options.steps;
    const draw = options.draw;
    let world = options.world ? normRect(options.world) : null;
    let target = options.follow ?? null;
    let deadzone = options.deadzone ?? null;
    let damping = options.damping ?? 0.15;
    let fit = options.fit ? normRect(options.fit) : null;
    const state = { x: 0, y: 0, zoom: options.zoom ?? 1 };
    const pendingSteps = lazySteps(steps, 1, 600);
    // Shake as a birth certificate: offset derives from the step counter.
    let shakeAmp = 0;
    let shakeStart = 0;
    let shakeSteps = 0;
    const scratchRect = { x: 0, y: 0, w: 0, h: 0 };
    // Per-lens scratch for the hot pull paths (catch-up runs per elapsed step, and
    // mapping runs on every render/pick) — these never escape the call.
    const scratchTarget = { x: 0, y: 0 };
    const scratchDesired = { x: 0, y: 0 };
    const scratchShake = { x: 0, y: 0 };
    const scratchMap = { scale: 1, tx: 0, ty: 0 };
    function view() {
        return options.view;
    }
    function targetPoint() {
        const t = target;
        scratchTarget.x = t.x + (t.w ?? 0) / 2;
        scratchTarget.y = t.y + (t.h ?? 0) / 2;
        return scratchTarget;
    }
    /** Where the camera wants its top-left, honoring deadzone + world clamp. */
    function desired() {
        const v = view();
        const effW = v.w / state.zoom;
        const effH = v.h / state.zoom;
        let wantX = state.x;
        let wantY = state.y;
        if (target) {
            const t = targetPoint();
            const dzW = deadzone?.w ?? 0;
            const dzH = deadzone?.h ?? 0;
            // The deadzone box, centered in the current view:
            const left = state.x + (effW - dzW) / 2;
            const right = left + dzW;
            const top = state.y + (effH - dzH) / 2;
            const bottom = top + dzH;
            if (t.x < left)
                wantX -= left - t.x;
            else if (t.x > right)
                wantX += t.x - right;
            if (t.y < top)
                wantY -= top - t.y;
            else if (t.y > bottom)
                wantY += t.y - bottom;
        }
        if (world) {
            // Center the world when it's smaller than the view; clamp otherwise.
            wantX =
                world.w < effW
                    ? world.x + (world.w - effW) / 2
                    : clamp(wantX, world.x, world.x + world.w - effW);
            wantY =
                world.h < effH
                    ? world.y + (world.h - effH) / 2
                    : clamp(wantY, world.y, world.y + world.h - effH);
        }
        scratchDesired.x = wantX;
        scratchDesired.y = wantY;
        return scratchDesired;
    }
    /** Fold forward by the steps elapsed since the last read. */
    function updatePending() {
        let n = pendingSteps.take();
        if (fit) {
            const v = view();
            state.zoom = Math.min(v.w / fit.w, v.h / fit.h);
            state.x = fit.x;
            state.y = fit.y;
            return;
        }
        if (!target || n <= 0)
            return;
        while (n-- > 0) {
            const want = desired();
            state.x += (want.x - state.x) * damping;
            state.y += (want.y - state.y) * damping;
        }
    }
    /** Is a shake still inside its fade window? Asked directly rather than
     *  inferred from a nonzero offset — `wobble` legitimately returns 0 on some
     *  steps, and treating those as "no shake" drops a live one. */
    function shakeLive(now) {
        return shakeAmp > 0 && now - shakeStart < shakeSteps;
    }
    function shakeOffset() {
        const now = steps();
        if (!shakeLive(now)) {
            scratchShake.x = 0;
            scratchShake.y = 0;
            return scratchShake;
        }
        const k = 1 - (now - shakeStart) / shakeSteps; // linear falloff
        scratchShake.x = shakeAmp * k * wobble(now * 1.7 + 0.3);
        scratchShake.y = shakeAmp * k * wobble(now * 2.3 + 7.1);
        return scratchShake;
    }
    function visibleRect() {
        updatePending();
        const v = view();
        scratchRect.x = state.x;
        scratchRect.y = state.y;
        scratchRect.w = fit ? fit.w : v.w / state.zoom;
        scratchRect.h = fit ? fit.h : v.h / state.zoom;
        return scratchRect;
    }
    /** The lens's world→screen affine, `screen = scale * world + t`, written
     *  into `out`. THE single definition of this camera's mapping: `applyLens`
     *  pushes it onto the canvas and `toWorld`/`toScreen` invert it, so a pick
     *  can never disagree with what was actually drawn (shake and the pixel snap
     *  included). Folds pending steps via `visibleRect`. */
    function mapping(into, out) {
        const r = visibleRect();
        const sh = shakeOffset();
        if (into) {
            const s = Math.min(into.w / r.w, into.h / r.h); // uniform, letterboxed
            out.scale = s;
            out.tx = into.x + (into.w - r.w * s) / 2 - s * (r.x + sh.x);
            out.ty = into.y + (into.h - r.h * s) / 2 - s * (r.y + sh.y);
        }
        else {
            const z = state.zoom;
            out.scale = z;
            // Whole-pixel translate: keeps integer world geometry on integer device
            // pixels — no tile seams, no sprite shimmer. Snap AFTER the zoom, in
            // device space: rounding the world coordinate first would quantize
            // camera motion to zoom-sized jumps (3 px at zoom 3), which is worse
            // than not snapping. A sub-device-pixel quantize is imperceptible.
            out.tx = -Math.round((state.x + sh.x) * z);
            out.ty = -Math.round((state.y + sh.y) * z);
        }
        return out;
    }
    function applyLens(ctx, into) {
        if (into) {
            ctx.beginPath();
            ctx.rect(into.x, into.y, into.w, into.h);
            ctx.clip();
            draw.clipScene(into);
        }
        const m = mapping(into, scratchMap);
        ctx.translate(m.tx, m.ty);
        ctx.scale(m.scale, m.scale);
    }
    function render(a, b) {
        const [opts, fn] = typeof a === "function" ? [{}, a] : [a, b];
        const ctx = draw.ctx;
        ctx.save();
        applyLens(ctx, opts.into ?? null);
        try {
            fn();
        }
        finally {
            draw.clipScene(null);
            ctx.restore();
        }
    }
    const cam = {
        get x() {
            updatePending();
            return state.x;
        },
        set x(v) {
            updatePending();
            state.x = v;
        },
        get y() {
            updatePending();
            return state.y;
        },
        set y(v) {
            updatePending();
            state.y = v;
        },
        get zoom() {
            return state.zoom;
        },
        set zoom(v) {
            state.zoom = v;
        },
        get rect() {
            return visibleRect();
        },
        follow(t, opts = {}) {
            target = t;
            if (opts.world !== undefined)
                world = opts.world ? normRect(opts.world) : null;
            if (opts.deadzone !== undefined)
                deadzone = opts.deadzone;
            if (opts.damping !== undefined)
                damping = opts.damping;
            if (opts.zoom !== undefined)
                state.zoom = opts.zoom;
            if (opts.fit !== undefined)
                fit = opts.fit ? normRect(opts.fit) : null;
            pendingSteps.reset();
        },
        snap() {
            updatePending();
            if (target) {
                const want = desired();
                state.x = want.x;
                state.y = want.y;
            }
        },
        shake(amplitude, ms) {
            const now = steps();
            // Stack by keeping the stronger amplitude, restarting the fade.
            shakeAmp = Math.max(shakeLive(now) ? shakeAmp : 0, amplitude);
            shakeStart = now;
            shakeSteps = Math.max(1, Math.round(ms * STEPS_PER_MS));
        },
        toWorld(p, out, opts) {
            const m = mapping(opts?.into ?? null, scratchMap);
            const o = out ?? { x: 0, y: 0 };
            o.x = (p.x - m.tx) / m.scale;
            o.y = (p.y - m.ty) / m.scale;
            return o;
        },
        toScreen(p, out, opts) {
            const m = mapping(opts?.into ?? null, scratchMap);
            const o = out ?? { x: 0, y: 0 };
            o.x = m.scale * p.x + m.tx;
            o.y = m.scale * p.y + m.ty;
            return o;
        },
        render,
        layer(factor, fn) {
            updatePending();
            const sh = shakeOffset();
            const ctx = draw.ctx;
            ctx.save();
            ctx.translate(-Math.round((state.x + sh.x) * factor * state.zoom), -Math.round((state.y + sh.y) * factor * state.zoom));
            try {
                fn();
            }
            finally {
                ctx.restore();
            }
        },
    };
    return cam;
}
