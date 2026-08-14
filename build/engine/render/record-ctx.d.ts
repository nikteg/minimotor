import type { SceneRenderer } from "./target.js";
export interface DrawRecorder {
    readonly ctx: CanvasRenderingContext2D;
    begin(overlay: CanvasRenderingContext2D, scene: SceneRenderer): void;
}
export declare function createDrawRecorder(): DrawRecorder;
