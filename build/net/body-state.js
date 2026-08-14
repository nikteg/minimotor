import { sync } from "./room.js";
import { lerp, lerpAngle } from "../math/mathf.js";
import { bodiesCodec, bodyCodec } from "./body-codec.js";
import { syncEntities } from "./entities.js";
/** Convert a lightweight or Physics2D body into interpolation-friendly state. */
export function bodyState(body) {
    const source = body;
    const flat = "vel" in body;
    const out = {
        x: body.x,
        y: body.y,
        vx: flat ? body.vel.x : body.vx,
        vy: flat ? body.vel.y : body.vy,
    };
    for (const key of [
        "w",
        "h",
        "rot",
        "spin",
        "grounded",
        "facing",
        "color",
        "active",
        "state",
        "area",
    ]) {
        if (key in source)
            out[key] = source[key];
    }
    return out;
}
/** Blend body snapshots, taking the shortest arc for Physics2D rotation. */
export function lerpBodyState(a, b, t) {
    if (a.area !== b.area)
        return { ...b };
    const out = { ...b };
    for (const key of ["x", "y", "vx", "vy", "spin", "facing"]) {
        if (typeof a[key] === "number" && typeof b[key] === "number") {
            out[key] = lerp(a[key], b[key], t);
        }
    }
    if (typeof a.rot === "number" && typeof b.rot === "number")
        out.rot = lerpAngle(a.rot, b.rot, t);
    return out;
}
/** Project body position/rotation from its two newest snapshots. Velocity units
 * do not matter: projection derives motion from the observed positions. */
export function extrapolateBodyState(a, b, t) {
    if (a.area !== b.area)
        return { ...b };
    const out = { ...b };
    out.x = lerp(a.x, b.x, t);
    out.y = lerp(a.y, b.y, t);
    if (typeof a.rot === "number" && typeof b.rot === "number")
        out.rot = lerpAngle(a.rot, b.rot, t);
    return out;
}
/** Apply a snapshot to a lightweight body or remote Physics2D proxy. */
export function applyBodyState(body, state) {
    body.x = state.x;
    body.y = state.y;
    if ("vel" in body) {
        body.vel.x = state.vx;
        body.vel.y = state.vy;
    }
    else {
        body.vx = state.vx;
        body.vy = state.vy;
    }
    const target = body;
    for (const key of [
        "w",
        "h",
        "rot",
        "spin",
        "grounded",
        "facing",
        "color",
        "active",
        "state",
        "area",
    ]) {
        const value = state[key];
        if (key in target && value !== undefined)
            target[key] = value;
    }
    return body;
}
/** Replicate a lightweight or Physics2D body with one call. Defaults to 60 Hz
 * plus 50ms-bounded snapshot extrapolation for responsive motion; adaptive
 * jitter restores buffering when needed. Pass a getter when the body instance
 * can be replaced on respawn. */
export function syncBody(room, body, options = {}) {
    const read = typeof body === "function" ? body : () => body;
    return sync(room, {
        ...options,
        hz: options.hz ?? 60,
        lerp: options.lerp ?? lerpBodyState,
        extrapolate: options.extrapolate ?? extrapolateBodyState,
        maxExtrapolationMs: options.maxExtrapolationMs ?? 50,
        codec: options.codec ?? bodyCodec(),
        state: () => bodyState(read()),
    });
}
/** Replicate a dynamic collection of lightweight or Physics2D bodies. */
export function syncBodies(room, bodies, options) {
    return syncEntities(room, {
        ...options,
        entities: bodies,
        state: bodyState,
        lerp: options.lerp ?? lerpBodyState,
        extrapolate: options.extrapolate ?? extrapolateBodyState,
        maxExtrapolationMs: options.maxExtrapolationMs ?? 50,
        codec: options.codec ?? bodiesCodec(),
    });
}
