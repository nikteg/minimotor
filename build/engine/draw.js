import { drawText, monoFont } from "../engine/text.js";
import { blitPixelAligned } from "./pixel-raster.js";
import { createDrawRecorder } from "./render/record-ctx.js";
import { readTransform } from "./render/math.js";
function rect(a, b, c, d, e) {
    const ctx = this.ctx;
    if (typeof a === "number") {
        ctx.fillStyle = e;
        ctx.fillRect(a, b, c, d);
    }
    else {
        ctx.fillStyle = b;
        ctx.fillRect(a.x, a.y, a.w, a.h);
    }
}
function circle(xOrCenter, yOrRadius, radiusOrColor, maybeColor) {
    const ctx = this.ctx;
    let x, y, r, color;
    if (typeof xOrCenter === "number") {
        x = xOrCenter;
        y = yOrRadius;
        r = radiusOrColor;
        color = maybeColor;
    }
    else {
        x = xOrCenter.x;
        y = xOrCenter.y;
        r = yOrRadius;
        color = radiusOrColor;
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
}
function line(x1OrFrom, y1OrTo, x2OrColor, y2OrWidth, maybeColor, maybeWidth) {
    const ctx = this.ctx;
    let x1, y1, x2, y2, color, width;
    if (typeof x1OrFrom === "number") {
        x1 = x1OrFrom;
        y1 = y1OrTo;
        x2 = x2OrColor;
        y2 = y2OrWidth;
        color = maybeColor;
        width = maybeWidth ?? 1;
    }
    else {
        x1 = x1OrFrom.x;
        y1 = x1OrFrom.y;
        x2 = y1OrTo.x;
        y2 = y1OrTo.y;
        color = x2OrColor;
        width = y2OrWidth ?? 1;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
}
function rectStroke(a, b, 
// In the structural form this slot carries the line width, not a dimension.
c, d, e, f) {
    const ctx = this.ctx;
    if (typeof a === "number") {
        ctx.strokeStyle = e;
        ctx.lineWidth = f ?? 1;
        ctx.strokeRect(a, b, c, d);
    }
    else {
        ctx.strokeStyle = b;
        ctx.lineWidth = c ?? 1;
        ctx.strokeRect(a.x, a.y, a.w, a.h);
    }
}
function circleStroke(xOrCenter, yOrRadius, radiusOrColor, colorOrWidth, maybeWidth) {
    const ctx = this.ctx;
    let x, y, r, color, width;
    if (typeof xOrCenter === "number") {
        x = xOrCenter;
        y = yOrRadius;
        r = radiusOrColor;
        color = colorOrWidth;
        width = maybeWidth ?? 1;
    }
    else {
        x = xOrCenter.x;
        y = xOrCenter.y;
        r = yOrRadius;
        color = radiusOrColor;
        width = colorOrWidth ?? 1;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
}
/** Fill a closed polygon through `points` — the shape primitive that isn't a
 *  rect or a circle (a triangle ship, a health-bar chevron, a hit spark).
 *  Fewer than 3 points draw nothing.
 *
 *      Draw.poly([{ x: 0, y: -10 }, { x: 8, y: 8 }, { x: -8, y: 8 }], "#0af"); */
function poly(points, color) {
    if (points.length < 3)
        return;
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++)
        ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    ctx.fill();
}
/** Blit a plain image — a loaded `HTMLImageElement`, an offscreen canvas from
 *  `Sprites.getSprite`, an `ImageBitmap`. The missing primitive between
 *  `Draw.rect` and the sheet-based `Draw.sprite`/`Draw.sprites`; anchored at
 *  its top-left, unlike the bottom-center `Draw.sprite`.
 *
 *  `w`/`h` default to the image's intrinsic size, so `Draw.image(logo, 20, 20)`
 *  draws it 1:1. Pass one or both to scale. */
function image(img, x, y, w, h) {
    const ctx = this.ctx;
    const prevSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    try {
        // Intrinsic size: `naturalWidth` for a loaded <img>, plain `width` for a
        // canvas/bitmap. SVGImageElement's `width` is an SVGAnimatedLength, not a
        // number, hence the typeof guard.
        const src = img;
        const iw = src.naturalWidth ?? (typeof src.width === "number" ? src.width : 0);
        const ih = src.naturalHeight ?? (typeof src.height === "number" ? src.height : 0);
        blitPixelAligned(ctx, img, x, y, w ?? iw, h ?? ih);
    }
    finally {
        ctx.imageSmoothingEnabled = prevSmoothing;
    }
}
/** A linear-gradient fill from (x0,y0) to (x1,y1). Pass the result as any
 *  `Draw`/`UI` color: `Draw.rect(r, Draw.linear(0, 0, 0, h, [[0,"#0af"],[1,"#014"]]))`.
 *  Gradients are immutable and reusable — for static geometry, create the
 *  gradient once and reuse it rather than calling this per frame. */
function linear(x0, y0, x1, y1, stops) {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    for (const [at, color] of stops)
        g.addColorStop(at, color);
    return g;
}
function radial(x0, y0, r0, x1OrStops, y1, r1, maybeStops) {
    const ctx = this.ctx;
    const g = Array.isArray(x1OrStops)
        ? ctx.createRadialGradient(x0, y0, 0, x0, y0, r0)
        : ctx.createRadialGradient(x0, y0, r0, x1OrStops, y1, r1);
    for (const [at, color] of Array.isArray(x1OrStops) ? x1OrStops : maybeStops)
        g.addColorStop(at, color);
    return g;
}
/** Run `fn` with a global opacity multiplier applied (nests correctly and
 *  restores after) — fade-outs, ghosts, dimmed layers without touching ctx. */
function opacity(value, fn) {
    const ctx = this.ctx;
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * value;
    try {
        fn();
    }
    finally {
        ctx.globalAlpha = prev;
    }
}
/** Blit a single animated sprite: `spr` is anything `SpriteLike` (an
 *  `Anim.fromGrid`/`Anim.fromImages` cursor), `at` is the destination `Rect`. Anchored
 *  bottom-center (feet planted). `opts`: `flipX`/`flipY`, `scaleX`/`scaleY`
 *  (squash & stretch), `rot`, `alpha`. For many ECS sprites at once use
 *  `Draw.sprites`. When a scene renderer is attached, this is the same GPU
 *  path as `Draw.sprites` — not a Canvas2D overlay blit. */
function sprite(spr, at, opts = {}) {
    const r = spr.rect;
    const sourceW = r.sourceW ?? r.sw;
    const sourceH = r.sourceH ?? r.sh;
    const dw = (r.sw / sourceW) * at.w;
    const dh = (r.sh / sourceH) * at.h;
    const dx = ((r.offsetX ?? 0) / sourceW) * at.w;
    const dy = ((r.offsetY ?? 0) / sourceH) * at.h;
    if (this.scene) {
        this.scene.setTransform(readTransform(this.ctx));
        const scaleX = opts.scaleX ?? 1;
        const scaleY = opts.scaleY ?? 1;
        const one = this.spriteOne;
        one.img = spr.sheet.image;
        one.x = at.x + at.w / 2;
        one.y = at.y + at.h;
        one.w = dw * Math.abs(scaleX);
        one.h = dh * Math.abs(scaleY);
        one.ax = dw === 0 ? 0.5 : (at.w / 2 - dx) / dw;
        one.ay = dh === 0 ? 1 : (at.h - dy) / dh;
        one.rot = opts.rot ?? 0;
        one.scale = 1;
        one.flipX = !!opts.flipX !== scaleX < 0;
        one.flipY = !!opts.flipY !== scaleY < 0;
        one.alpha = opts.alpha ?? 1;
        one.sx = r.sx;
        one.sy = r.sy;
        one.sw = r.sw;
        one.sh = r.sh;
        one.visible = true;
        one.z = 0;
        one.px = undefined;
        one.py = undefined;
        this.scene.sprites(this.spriteOneList);
        return;
    }
    const ctx = this.ctx;
    // Fast path: no flip/squash/rotation/alpha means the transform below is
    // identity apart from position (translate to the bottom-center anchor, then
    // blit back up-left by the same amounts) — one direct drawImage, no
    // save/translate/scale/restore.
    if (!opts.flipX &&
        !opts.flipY &&
        (opts.scaleX ?? 1) === 1 &&
        (opts.scaleY ?? 1) === 1 &&
        !opts.rot &&
        opts.alpha === undefined) {
        const prev = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = false;
        blitPixelAligned(ctx, spr.sheet.image, r.sx, r.sy, r.sw, r.sh, at.x + dx, at.y + dy, dw, dh);
        ctx.imageSmoothingEnabled = prev;
        return;
    }
    ctx.save();
    // Nearest-neighbour: interpolated sampling bleeds edge pixels from the
    // ADJACENT sheet cells into the frame (ghost lines above heads); pixel
    // art wants crisp scaling anyway.
    ctx.imageSmoothingEnabled = false;
    ctx.translate(at.x + at.w / 2, at.y + at.h); // bottom-center anchor
    ctx.scale((opts.flipX ? -1 : 1) * (opts.scaleX ?? 1), (opts.flipY ? -1 : 1) * (opts.scaleY ?? 1));
    if (opts.rot)
        ctx.rotate(opts.rot);
    if (opts.alpha !== undefined)
        ctx.globalAlpha = opts.alpha;
    blitPixelAligned(ctx, spr.sheet.image, r.sx, r.sy, r.sw, r.sh, -at.w / 2 + dx, -at.h + dy, dw, dh);
    ctx.restore();
}
/** Blit an iterable of sprites, sorted by `z` (ties keep order). Honors
 *  anchor/rotation/scale/flip/alpha/visibility, culls to `view`, and
 *  interpolates px/py when `opts.interpolation` is given. */
function sprites(list, opts = {}) {
    if (this.scene) {
        this.scene.setTransform(readTransform(this.ctx));
        this.scene.sprites(list, opts);
        return;
    }
    const ctx = this.ctx;
    const spriteScratch = this.spriteScratch;
    const lerp = opts.interpolation;
    const view = opts.view;
    spriteScratch.length = 0;
    for (const s of list)
        spriteScratch.push(s);
    let ordered = true;
    for (let i = 1; i < spriteScratch.length; i++) {
        if ((spriteScratch[i].z ?? 0) < (spriteScratch[i - 1].z ?? 0)) {
            ordered = false;
            break;
        }
    }
    if (!ordered)
        spriteScratch.sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
    // Nearest-neighbour for the whole batch, toggled ONCE — `Draw.sprite` forces
    // smoothing off per blit and the two paths must render pixel art identically.
    const prevSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    let ctxAlpha = 1;
    for (const s of spriteScratch) {
        if (s.visible === false)
            continue;
        const alpha = s.alpha ?? 1;
        if (alpha <= 0)
            continue;
        const img = s.img;
        const clipped = s.sw !== undefined && s.sh !== undefined;
        const w = s.w ?? (clipped ? s.sw : (img.logicalSize ?? img.width));
        const h = s.h ?? (clipped ? s.sh : (img.logicalSize ?? img.height));
        const ax = s.ax ?? 0.5;
        const ay = s.ay ?? 0.5;
        const rot = s.rot ?? 0;
        const scale = s.scale ?? 1;
        const flipX = s.flipX === true;
        const flipY = s.flipY === true;
        let x = s.x;
        let y = s.y;
        if (lerp !== undefined && s.px !== undefined && s.py !== undefined) {
            x = s.px + (s.x - s.px) * lerp;
            y = s.py + (s.y - s.py) * lerp;
        }
        if (view) {
            const ext = (w + h) * scale;
            if (x + ext < view.x ||
                x - ext > view.x + view.w ||
                y + ext < view.y ||
                y - ext > view.y + view.h) {
                continue;
            }
        }
        if (alpha !== ctxAlpha) {
            ctx.globalAlpha = alpha;
            ctxAlpha = alpha;
        }
        if (rot === 0 && scale === 1 && !flipX && !flipY) {
            if (clipped) {
                blitPixelAligned(ctx, img, s.sx ?? 0, s.sy ?? 0, s.sw, s.sh, x - ax * w, y - ay * h, w, h);
            }
            else {
                blitPixelAligned(ctx, img, x - ax * w, y - ay * h, w, h);
            }
        }
        else {
            ctx.save();
            ctx.translate(x, y);
            if (rot !== 0)
                ctx.rotate(rot);
            const kx = scale * (flipX ? -1 : 1);
            const ky = scale * (flipY ? -1 : 1);
            if (kx !== 1 || ky !== 1)
                ctx.scale(kx, ky);
            if (clipped) {
                blitPixelAligned(ctx, img, s.sx ?? 0, s.sy ?? 0, s.sw, s.sh, -ax * w, -ay * h, w, h);
            }
            else {
                blitPixelAligned(ctx, img, -ax * w, -ay * h, w, h);
            }
            ctx.restore();
        }
    }
    if (ctxAlpha !== 1)
        ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = prevSmoothing;
}
function tiles(level, skin, opts) {
    if (this.scene && this.recorder) {
        this.recorder.begin(this.ctx, this.scene);
        const fake = this.recorder.ctx;
        if ("skinless" in level && level.skinless)
            level.render(fake);
        else
            level.render(fake, skin, opts);
        return;
    }
    const ctx = this.ctx;
    if ("skinless" in level && level.skinless)
        level.render(ctx);
    else
        level.render(ctx, skin, opts);
}
/** Render a particle system (`Particles.createSystem()`), typically inside a
 *  `Camera.render` block for world-space effects. */
function particles(sys) {
    if (this.scene && this.recorder) {
        this.recorder.begin(this.ctx, this.scene);
        sys.render(this.recorder.ctx);
        return;
    }
    sys.render(this.ctx);
}
/** Draw plain ambient-space text (world-anchored damage numbers, name tags) —
 *  see `DrawTextOptions` for `x`/`y`/`size`/`color`/`align`/`baseline`. For
 *  themed, screen-space HUD text use `UI.text`. */
function text(str, opts) {
    const ctx = this.ctx;
    if (opts.font !== undefined && typeof opts.font !== "string") {
        // A gradient means nothing to a tinted blit, so it is dropped rather than
        // stringified into a nonsense CSS color.
        opts.font.render(ctx, str, opts.x, opts.y, {
            ...(typeof opts.color === "string" ? { color: opts.color } : {}),
            ...(opts.scale !== undefined ? { scale: opts.scale } : {}),
            ...(opts.align !== undefined ? { align: opts.align } : {}),
            ...(opts.baseline !== undefined ? { baseline: opts.baseline } : {}),
            ...(opts.tracking !== undefined ? { tracking: opts.tracking } : {}),
            ...(opts.lineHeight !== undefined ? { lineHeight: opts.lineHeight } : {}),
            ...(opts.outline !== undefined ? { outline: opts.outline } : {}),
            ...(opts.outlineWidth !== undefined ? { outlineWidth: opts.outlineWidth } : {}),
            ...(opts.outlineStyle !== undefined ? { outlineStyle: opts.outlineStyle } : {}),
            ...(opts.shadow !== undefined ? { shadow: opts.shadow } : {}),
            ...(opts.shadowColor !== undefined ? { shadowColor: opts.shadowColor } : {}),
        });
        return;
    }
    drawText(ctx, str, opts.x, opts.y, {
        font: opts.font ?? (opts.size !== undefined ? monoFont(opts.size) : undefined),
        color: opts.color,
        align: opts.align,
        baseline: opts.baseline,
    });
}
/** Create a renderer permanently bound to one app/context. When `scene` is
 *  present, `sprite` / `sprites` / `tiles` / `particles` go there; everything
 *  else stays on the overlay 2D context. */
export function createDraw(host, scene) {
    const spriteOne = {
        x: 0,
        y: 0,
        img: { width: 1, height: 1 },
    };
    const target = {
        get ctx() {
            return host.ctx;
        },
        spriteScratch: [],
        spriteOne,
        spriteOneList: [spriteOne],
        scene: scene ?? null,
        recorder: scene ? createDrawRecorder() : null,
    };
    return {
        get ctx() {
            return target.ctx;
        },
        rect: rect.bind(target),
        circle: circle.bind(target),
        line: line.bind(target),
        rectStroke: rectStroke.bind(target),
        circleStroke: circleStroke.bind(target),
        poly: poly.bind(target),
        image: image.bind(target),
        linear: linear.bind(target),
        radial: radial.bind(target),
        opacity: opacity.bind(target),
        text: text.bind(target),
        sprite: sprite.bind(target),
        sprites: sprites.bind(target),
        tiles: tiles.bind(target),
        particles: particles.bind(target),
        clipScene(rect) {
            if (!target.scene)
                return;
            target.scene.setTransform(readTransform(target.ctx));
            target.scene.setClip(rect);
        },
    };
}
