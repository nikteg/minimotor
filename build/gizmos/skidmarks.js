// ---------- Skid marks: rubber a car lays down while drifting ----------
// A little machine that, while the tyres are scrubbing, stitches dark segments
// end-to-end under each tyre — an unbroken streak, not dots or dashes: every new
// segment starts exactly where the last one ended, and a fresh slide only begins
// after the tyres stop marking. Tyre positions are given in car-local space, so
// any layout works (two rear wheels, all four, a bike's two, a six-wheeler…).
// Marks age out over `life` seconds, or set `life: Infinity` to make them
// permanent (capped by `max`). Emission is throttled so density is frame-rate-
// independent. Feed it the car's pose each fixed step; draw it in WORLD space
// (inside your camera block, under the car).
//
//    const skids = Gizmos.skidmarks();
//    // each fixed step:
//    skids.trace(body.x, body.y, body.rot, { marking: car.tireSlip > 40 }, dt);
//    // in draw, world space, before the car:
//    skids.draw(Draw.ctx);
/** Create a skid-mark gadget. `trace()` it each step with the car's pose and
 *  whether the tyres are scrubbing; `draw()` it under the car in world space. */
export function skidmarks(options = {}) {
    const life = options.life ?? 9;
    const permanent = !Number.isFinite(life);
    const fade = options.fade ?? 2;
    const max = options.max ?? 700;
    const emitEvery = options.emitEvery ?? 0.025;
    const color = options.color ?? "#080c0d";
    const width = options.width ?? 3;
    // Default tyre layout: two rear wheels either side of the axle.
    const rearAxle = options.rearAxle ?? 21;
    const spread = options.wheelSpread ?? 11;
    const wheels = options.wheels ?? [
        { along: -rearAxle, across: -spread },
        { along: -rearAxle, across: spread },
    ];
    const marks = [];
    // The world position each tyre last STAMPED (not last frame) — so the next
    // segment starts exactly where the last one ended and the streak is unbroken.
    // Null between drifts (pen up), so separate slides don't join across the gap.
    let anchor = null;
    let timer = 0;
    return {
        get count() {
            return marks.length;
        },
        trace(x, y, angle, input, dt) {
            if (!permanent) {
                for (let i = marks.length - 1; i >= 0; i--) {
                    marks[i].life -= dt;
                    if (marks[i].life <= 0)
                        marks.splice(i, 1);
                }
            }
            timer -= dt;
            if (!input.marking) {
                anchor = null; // pen up — end the current streak
                return;
            }
            const c = Math.cos(angle);
            const s = Math.sin(angle);
            // Each tyre's world position: along the heading + across it (right = +).
            const now = wheels.map((w) => ({
                x: x + c * w.along + s * w.across,
                y: y + s * w.along - c * w.across,
            }));
            if (!anchor) {
                anchor = now; // pen down — start a fresh streak from here (no segment yet)
                return;
            }
            if (timer <= 0) {
                const alpha = input.alpha ?? 0.45;
                for (let i = 0; i < now.length; i++) {
                    const p = anchor[i];
                    marks.push({ x: p.x, y: p.y, x2: now[i].x, y2: now[i].y, life, alpha });
                }
                if (marks.length > max)
                    marks.splice(0, marks.length - max);
                anchor = now; // advance the anchor so the next segment connects to this one
                timer = emitEvery;
            }
        },
        draw(ctx) {
            if (marks.length === 0)
                return;
            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.lineCap = "round";
            for (const m of marks) {
                // Permanent marks stay solid; timed marks fade over their final `fade` s.
                ctx.globalAlpha = permanent ? m.alpha : m.alpha * Math.min(1, m.life / fade);
                ctx.beginPath();
                ctx.moveTo(m.x, m.y);
                ctx.lineTo(m.x2, m.y2);
                ctx.stroke();
            }
            ctx.restore();
        },
        clear() {
            marks.length = 0;
            anchor = null;
            timer = 0;
        },
    };
}
