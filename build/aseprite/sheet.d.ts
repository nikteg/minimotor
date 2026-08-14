import type { ClockHandle } from "../clock/index.js";
import { type FrameRect, type PlaybackOptions, type SheetImage } from "../anim/sheet.js";
export interface AsepriteFrame {
    filename?: string;
    frame: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    duration: number;
    rotated?: boolean;
    trimmed?: boolean;
    spriteSourceSize?: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    sourceSize?: {
        w: number;
        h: number;
    };
}
export interface AsepriteTag<N extends string = string> {
    name: N;
    from: number;
    to: number;
    direction?: "forward" | "reverse" | "pingpong" | "pingpong_reverse";
}
export interface AsepriteJson<N extends string = string> {
    frames: readonly AsepriteFrame[] | Readonly<Record<string, AsepriteFrame>>;
    meta: {
        frameTags?: readonly AsepriteTag<N>[];
        image?: string;
        layers?: readonly AsepriteLayer[];
        slices?: readonly AsepriteSlice[];
    };
}
export type AsepriteState<D> = D extends {
    meta: {
        frameTags: readonly (infer T)[];
    };
} ? T extends {
    name: infer N extends string;
} ? N : string : string;
export interface AsepriteLayer {
    name: string;
    group?: string;
    opacity?: number;
    blendMode?: string;
}
export interface AsepriteSliceKey {
    frame: number;
    bounds: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    center?: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    pivot?: {
        x: number;
        y: number;
    };
}
export interface AsepriteSlice {
    name: string;
    color?: string;
    keys: readonly AsepriteSliceKey[];
}
export interface AsepriteCursor<K extends string = string> {
    readonly sheet: AsepriteSheet<K>;
    readonly state: K;
    set(state: K): void;
    reset(): void;
    pause(): void;
    resume(): void;
    readonly paused: boolean;
    readonly frame: number;
    /** Current frame index in the exported atlas (not the tag-local index). */
    readonly sourceFrame: number;
    readonly rect: FrameRect;
    /** Resolve a named Aseprite slice for the current source frame. */
    slice(name: string): AsepriteSliceKey | undefined;
    readonly done: boolean;
}
export interface AsepriteSheet<K extends string = string> {
    readonly image: SheetImage;
    /** First frame size, convenient for fixed-cell sheets. */
    readonly frame: {
        w: number;
        h: number;
    };
    readonly states: readonly K[];
    /** Exported frame names, usable as a static atlas even without tags. */
    readonly frames: readonly string[];
    readonly layers: readonly AsepriteLayer[];
    readonly slices: readonly string[];
    play(initial: K, opts: PlaybackOptions): AsepriteCursor<K>;
    /** Play one tag once, hold its final frame, and report `done`. */
    once(initial: K, opts: PlaybackOptions): AsepriteCursor<K>;
    rect(state: K, frame: number): FrameRect;
    /** Resolve an exported frame by filename/hash key or numeric index. */
    region(frame: string | number): FrameRect;
    /** Use an exported frame as a static sprite. */
    sprite(frame: string | number): {
        readonly sheet: {
            readonly image: SheetImage;
        };
        rect: FrameRect;
    };
    /** Resolve slice bounds/pivot/9-slice center at a source frame. */
    slice(name: string, frame?: number): AsepriteSliceKey | undefined;
    /** Reuse the parsed clips with another image, e.g. a tinted outline. */
    withImage(image: SheetImage): AsepriteSheet<K>;
}
/** Read Aseprite CLI JSON (array or hash format) as a pull-derived animation sheet. */
export declare function sheet<const D extends AsepriteJson>(image: SheetImage, data: D, options?: {
    clock?: ClockHandle;
}): AsepriteSheet<AsepriteState<D>>;
export type { AsepriteCursor as Cursor, AsepriteFrame as Frame, AsepriteJson as Json, AsepriteLayer as Layer, AsepriteSheet as Sheet, AsepriteSlice as Slice, AsepriteSliceKey as SliceKey, AsepriteState as State, AsepriteTag as Tag, };
