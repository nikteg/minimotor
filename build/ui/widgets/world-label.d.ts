import type { CameraLens } from "../../camera/index.js";
import { type TextOptions } from "../../ui/core/index.js";
export interface WorldLabelTarget {
    x: number;
    y: number;
    w?: number;
    h?: number;
}
export interface WorldLabelOptions extends Pick<TextOptions, "size" | "bold" | "font" | "color"> {
    /** Camera used to map the target. */
    camera: Pick<CameraLens, "toScreen">;
    /** Label offset from the target's center in world pixels. Default y = -20. */
    offset?: {
        x?: number;
        y?: number;
    };
    /** Screen-edge inset in logical pixels. Default 24. */
    margin?: number;
    /** Draw a directional arrow while the target is off screen. Default true. */
    arrow?: boolean;
}
export interface WorldLabelResult {
    /** Final screen-space label anchor. */
    x: number;
    y: number;
    offscreen: boolean;
}
/** Draw a camera-aware label over a world target. On-screen labels track the
 * target; off-screen labels clamp to the viewport and point toward it. */
export declare function worldLabel(label: string, target: WorldLabelTarget, options: WorldLabelOptions): WorldLabelResult;
