const velocity = (body) => ({
    x: body.vel?.x ?? body.vx ?? 0,
    y: body.vel?.y ?? body.vy ?? 0,
});
/** Derive the conventional visual state from a platformer body or snapshot. */
export function animationState(body) {
    if (body.state === "climb")
        return "climb";
    if (body.grounded === false)
        return "jump";
    return Math.abs(velocity(body).x) > 0.5 ? "run" : "idle";
}
/**
 * Group ordinary animation cursors behind platformer-aware synchronization.
 * Anim itself stays ignorant of bodies, velocity, and climbing.
 */
export function animations(cursors) {
    return {
        cursors,
        sync(body) {
            const state = animationState(body);
            const climbing = state === "climb";
            const climbingNow = Math.abs(velocity(body).y) > 0.001;
            for (const cursor of Object.values(cursors)) {
                cursor.set(state);
                if (!climbing || climbingNow) {
                    cursor.resume();
                }
                else if (!cursor.paused) {
                    cursor.reset();
                    cursor.pause();
                }
            }
            return state;
        },
    };
}
