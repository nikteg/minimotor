import type { ClockHandle } from "../clock/index.js";
import { type Transition } from "../transitions/index.js";
/** One scene. Every hook is optional; hooks capture game state via closure. */
export interface SceneSpec {
    /** Runs when the scene becomes active (pushed, or navigated to). */
    enter?(): void;
    /** Runs when the scene leaves the stack (popped, or replaced by `go`). */
    exit?(): void;
    /** Fixed-step simulation — only while this scene is on TOP. */
    update?(): void;
    /** Render — every visible scene draws, bottom-to-top. Use `Draw.*`. */
    draw?(): void;
    /** This scene paints the full viewport: nothing beneath it draws. */
    opaque?: boolean;
    /** When pushed as a modal: hold `Clock.world` while on the stack (default
     *  true — hard freeze). `false` keeps world time flowing while updates
     *  stay gated: idle cycles and particles keep breathing under the menu. */
    holdsTime?: boolean;
}
/** Options for `SceneStack.go` — an optional covering `transition`. */
export interface GoOptions {
    /** Cover the swap with a transition (`Transitions.fade(300)`): the overlay
     *  covers the screen first, the swap happens behind it. */
    transition?: Transition;
    /** Runs immediately before the covering phase starts. */
    beforeCover?(): void;
    /** Runs at full coverage, before the destination scene enters. */
    onSwap?(): void;
    /** Runs once after the destination has been fully revealed. */
    afterReveal?(): void;
}
/** The typed scene stack — structurally `AppCallbacks`, so `Loop.run(scenes)`
 *  is the entire handoff. */
export interface SceneStack<K extends string> {
    /** Replace the whole stack with `name` (exits every current scene). */
    go(name: K, opts?: GoOptions): void;
    /** Push `name` on top as a modal; scenes beneath keep drawing, and
     *  `Clock.world` holds unless the scene says `holdsTime: false`. */
    push(name: K): void;
    /** Exit the top scene and resume beneath (releases the clock hold when no
     *  holding modal remains). */
    pop(): void;
    /** Name of the top (updating) scene. */
    readonly active: K;
    /** Scene names, bottom-to-top. */
    readonly stack: readonly K[];
    /** AppCallbacks: tick the top scene (wired by `Loop.run(scenes)`). */
    update(): void;
    /** AppCallbacks: draw the visible stack bottom-to-top. */
    draw(ctx: CanvasRenderingContext2D): void;
}
/** Config for `Scenes.create`. */
export interface SceneStackOptions {
    /** The clock that modal `push`es hold while they sit on the stack. */
    clock: ClockHandle;
    /** Interface clock for transitions. */
    uiClock?: ClockHandle;
    /** Live viewport used by transition overlays. */
    view?: {
        w: number;
        h: number;
    };
}
/** Build a typed scene stack from a `map` of named `SceneSpec`s. The first key
 *  is the opening scene (entered immediately). The result is structurally
 *  `AppCallbacks`, so `Loop.run(scenes)` is the whole handoff. Throws if `map`
 *  is empty. */
export declare function createSceneStack<K extends string>(map: Record<K, SceneSpec>, options: SceneStackOptions): SceneStack<K>;
