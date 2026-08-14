import type { Scene3D } from "./scene.js";
/** Which transform component a track drives. */
export type TrackProperty = "position" | "rotation" | "scale";
/** How values between keyframes are found. */
export type Interpolation = "linear" | "step";
/** One animated property of one node. */
export interface Track {
    /** Index into `Scene3D.nodes`. */
    node: number;
    /** What it drives. */
    property: TrackProperty;
    /** Keyframe times in seconds, ASCENDING. Sampling assumes this and binary
     *  searches; an unsorted track reads the wrong keyframes rather than
     *  erroring. */
    times: Float32Array;
    /** Keyframe values, flattened: 3 floats per key for position/scale, 4 for
     *  rotation (a quaternion, slerped rather than lerped). */
    values: Float32Array;
    /** Default `"linear"`. `"step"` holds each key until the next — for a
     *  visibility flicker or a hard cut. */
    interpolation?: Interpolation;
}
/** A named set of tracks with a duration. */
export interface Clip {
    name: string;
    /** Length in seconds. Sampling past it either loops or clamps. */
    duration: number;
    tracks: Track[];
}
/** Build a clip and derive its duration from the tracks — the duration is
 *  almost always "as long as the longest track", and computing it by hand is
 *  a reliable source of a clip that ends a frame early. */
export declare function createClip(name: string, tracks: Track[], duration?: number): Clip;
/** Write a clip's value at `time` into the scene's nodes.
 *
 *  Does NOT update world matrices — call `updateWorldMatrices` after sampling
 *  every clip you intend to apply, so that layering two clips costs one
 *  hierarchy walk rather than two.
 *
 *  `loop` wraps the time into the clip; false clamps to the ends, which is
 *  what a one-shot needs so it settles on its final pose instead of snapping
 *  back to the first frame. */
export declare function sampleClip(scene: Scene3D, clip: Clip, time: number, loop?: boolean): void;
/** A rotation track that spins a node about an axis, as three keys a third of
 *  a turn apart.
 *
 *  Three keys, not two: slerp takes the SHORTEST arc, so a full turn expressed
 *  as start → end would find the two identical and never move, and a half turn
 *  would pick an arbitrary direction. Thirds make each hop unambiguous. */
export declare function spinTrack(node: number, seconds: number, axis?: {
    x: number;
    y: number;
    z: number;
}): Track;
