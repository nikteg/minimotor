// ---------- Animation ----------
// Public entry for frame animation and value motion. Implementation files stay
// app-independent; `createAnimation` binds clock arguments explicitly.
import { fromGrid, } from "./sheet.js";
import { fromImages } from "./states.js";
import { animate, parallel, sequence, } from "./value.js";
import { effects, keyed } from "./pools.js";
export * from "./sheet.js";
export * from "./states.js";
export * from "./value.js";
export * from "./pools.js";
/** Build the animation API over an explicit default clock. */
export function bindAnimation(clock) {
    return {
        fromGrid: (image, { clock: boundClock = clock, ...options }) => fromGrid(image, { ...options, clock: boundClock }),
        fromImages: (clips, { clock: boundClock = clock, ...options } = {}) => fromImages(clips, { ...options, clock: boundClock }),
        animate: ({ clock: boundClock = clock, ...options }) => animate({ ...options, clock: boundClock }),
        sequence: (steps, { clock: boundClock = clock, ...options } = {}) => sequence(steps, { ...options, clock: boundClock }),
        parallel: (specs, { clock: boundClock = clock, ...options } = {}) => parallel(specs, { ...options, clock: boundClock }),
        keyed,
        effects,
        play: (source, initial, { clock: boundClock = clock, ...options } = {}) => source.play(initial, { ...options, clock: boundClock }),
        once: (source, initial, { clock: boundClock = clock, ...options } = {}) => source.once(initial, { ...options, clock: boundClock }),
    };
}
/** Animation helpers bound to one app's world clock. */
export function createAnimation(app) {
    return bindAnimation(app.Clock.world);
}
