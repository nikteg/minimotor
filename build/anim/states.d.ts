import type { ClockHandle } from "../clock/index.js";
import { type AnimationCursor, type AnimationSource, type FrameRect, type PlaybackOptions, type SheetImage } from "./sheet.js";
/** One state's clip: an image plus how to read frames out of it. */
export interface StateClip {
    /** The state's image — a horizontal strip of `frames` cells, or (with
     *  `frames` omitted/1) a single static frame. */
    image: SheetImage;
    /** Cells laid out left-to-right in `image`. Default 1 (static). */
    frames?: number;
    /** Playback speed in frames/second. Default 12 (ignored for 1 frame). */
    fps?: number;
    /** Source cell size in px. Defaults to `image.width / frames` × full height —
     *  override only for padded strips or non-strip layouts. */
    frame?: {
        w: number;
        h: number;
    };
}
/** A per-entity playback head over a state kit. Everything derives from the
 *  cursor's clock at read time. Satisfies `SpriteLike`, so it drops straight
 *  into `Draw.sprite` — and `sheet.image` returns the ACTIVE state's image. */
export interface ImageAnimationCursor<K extends string = string> extends AnimationCursor<K> {
    /** The active state's image, exposed as `SpriteLike` expects. Switches with
     *  `set` — this is what makes multi-image kits work in `Draw.sprite`. */
    readonly sheet: {
        readonly image: SheetImage;
    };
    /** The active state name. */
    readonly state: K;
    /** Switch state. Same-state calls are no-ops (call it every step freely);
     *  switching resets the new state's timeline. */
    set(state: K): void;
    /** Restart the current state's timeline. */
    reset(): void;
    /** Freeze on the current frame. */
    pause(): void;
    /** Continue from the frozen frame. */
    resume(): void;
    /** Whether playback is currently frozen. */
    readonly paused: boolean;
    /** Current frame index within the state. */
    readonly frame: number;
    /** Source rect of the current frame (reused scratch — read, don't hold). */
    readonly rect: FrameRect;
    /** True once a non-looping state has reached its last frame. */
    readonly done: boolean;
}
/** A shared, immutable multi-image animation source (one image per state). */
export interface ImageAnimationSource<K extends string = string> extends AnimationSource<K, ImageAnimationCursor<K>> {
    /** Start a playback cursor, on this kit's clock unless `opts` names one. */
    play(initial: K, opts?: PlaybackOptions): ImageAnimationCursor<K>;
    /** Play one state once, hold its final frame, and report `done`. */
    once(initial: K, opts?: PlaybackOptions): ImageAnimationCursor<K>;
    /** Source rect for an arbitrary state/frame (manual draws, HUD icons).
     *  Reused scratch — read, don't hold. */
    rect(state: K, frame: number): FrameRect;
    /** The image backing a state (e.g. to pass to `Draw.sprite`'s sibling APIs). */
    image(state: K): SheetImage;
}
/** Assemble named states, each from its own image, into a shared kit. */
export declare function fromImages<K extends string>(clips: Record<K, StateClip>, options?: {
    clock?: ClockHandle;
}): ImageAnimationSource<K>;
