// ---------- Recording 2D context ----------
// A fake `CanvasRenderingContext2D` that `Tiles` / `Particles` can `render`
// into when the WebGL scene layer is active. It implements the subset those
// modules actually call (`drawImage` 3/5/9-arg, `fillRect`, path `arc`+`fill`,
// the transform stack, `globalAlpha`) and forwards blits to the batcher.
// `clip` is an axis-aligned scissor from the last `rect()`; `save`/`restore`
// only push that scissor when `clip()` actually ran, so a Camera.into clip
// on the scene is not wiped by a tile bake's save/restore.
import { IDENTITY, copyAffine, imageSize, multiplyAffine, readTransform, } from "./math.js";
import { parseRgba } from "./color.js";
export function createDrawRecorder() {
    const current = { ...IDENTITY };
    const stack = [];
    let scene = null;
    let alpha = 1;
    let fillStyle = "#000";
    let smoothing = false;
    let lastArc = null;
    let lastRect = null;
    let clipRect = null;
    let clipUsed = false;
    let canvasRef = { width: 1, height: 1 };
    function syncTransform() {
        if (scene)
            scene.setTransform(current);
    }
    function postMultiply(n) {
        multiplyAffine(current, n, current);
    }
    const fake = {
        get canvas() {
            return canvasRef;
        },
        get globalAlpha() {
            return alpha;
        },
        set globalAlpha(v) {
            alpha = v;
        },
        get fillStyle() {
            return fillStyle;
        },
        set fillStyle(v) {
            fillStyle = v;
        },
        get imageSmoothingEnabled() {
            return smoothing;
        },
        set imageSmoothingEnabled(v) {
            smoothing = v;
        },
        save() {
            stack.push({
                m: copyAffine(current),
                alpha,
                fillStyle: typeof fillStyle === "string" ? fillStyle : "#000",
                smoothing,
                clip: clipRect,
            });
        },
        restore() {
            const f = stack.pop();
            if (!f)
                return;
            copyAffine(f.m, current);
            alpha = f.alpha;
            fillStyle = f.fillStyle;
            smoothing = f.smoothing;
            clipRect = f.clip;
            if (clipUsed && scene) {
                syncTransform();
                scene.setClip(clipRect);
            }
        },
        translate(x, y) {
            postMultiply({ a: 1, b: 0, c: 0, d: 1, e: x, f: y });
        },
        scale(x, y) {
            postMultiply({ a: x, b: 0, c: 0, d: y, e: 0, f: 0 });
        },
        rotate(rad) {
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            postMultiply({ a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 });
        },
        setTransform(a, b, c, d, e, f) {
            if (typeof a === "number") {
                current.a = a;
                current.b = b ?? 0;
                current.c = c ?? 0;
                current.d = d ?? 1;
                current.e = e ?? 0;
                current.f = f ?? 0;
                return;
            }
            current.a = a.a ?? 1;
            current.b = a.b ?? 0;
            current.c = a.c ?? 0;
            current.d = a.d ?? 1;
            current.e = a.e ?? 0;
            current.f = a.f ?? 0;
        },
        getTransform() {
            return copyAffine(current);
        },
        resetTransform() {
            copyAffine(IDENTITY, current);
        },
        transform(a, b, c, d, e, f) {
            postMultiply({ a, b, c, d, e, f });
        },
        beginPath() {
            lastArc = null;
            lastRect = null;
        },
        arc(x, y, r) {
            lastArc = { x, y, r };
        },
        rect(x, y, w, h) {
            lastRect = { x, y, w, h };
        },
        clip() {
            if (!scene || !lastRect)
                return;
            clipRect = lastRect;
            clipUsed = true;
            syncTransform();
            scene.setClip(clipRect);
        },
        fill() {
            if (!scene || !lastArc)
                return;
            const col = parseRgba(typeof fillStyle === "string" ? fillStyle : "#fff");
            syncTransform();
            const { x, y, r } = lastArc;
            scene.fillQuad(x - r, y - r, r * 2, r * 2, [col[0], col[1], col[2], col[3] * alpha]);
        },
        fillRect(x, y, w, h) {
            if (!scene)
                return;
            const col = parseRgba(typeof fillStyle === "string" ? fillStyle : "#fff");
            syncTransform();
            scene.fillQuad(x, y, w, h, [col[0], col[1], col[2], col[3] * alpha]);
        },
        drawImage(image, a, b, c, d, e, f, g, h) {
            if (!scene)
                return;
            const src = imageSize(image);
            syncTransform();
            if (e !== undefined) {
                scene.blitImage(image, a, b, c, d, e, f, g, h, alpha);
            }
            else if (c !== undefined) {
                scene.blitImage(image, 0, 0, src.w, src.h, a, b, c, d, alpha);
            }
            else {
                scene.blitImage(image, 0, 0, src.w, src.h, a, b, src.w, src.h, alpha);
            }
        },
    };
    return {
        get ctx() {
            return fake;
        },
        begin(overlay, next) {
            scene = next;
            canvasRef = overlay.canvas;
            copyAffine(readTransform(overlay), current);
            stack.length = 0;
            alpha = typeof overlay.globalAlpha === "number" ? overlay.globalAlpha : 1;
            fillStyle = "#000";
            smoothing = false;
            lastArc = null;
            lastRect = null;
            clipRect = null;
            clipUsed = false;
        },
    };
}
