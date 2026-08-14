import type { AppCallbacks, Runtime, FrameTimings } from "./app.js";
export interface LoopApi {
    run(callbacks: AppCallbacks): void;
    pause(): void;
    resume(): void;
    stop(): void;
    onStep(handler: () => void): () => void;
    onStepStart(handler: () => void): () => void;
    onFrame(handler: () => void): () => void;
    readonly step: number;
    readonly steps: number;
    readonly frameDelta: number;
    /** Draw-rate cap in frames per second; 0 is uncapped. The simulation keeps
     *  its own fixed rate either way — see `AppOptions.maxFps`. */
    maxFps: number;
    readonly interpolation: number;
    readonly paused: boolean;
    readonly timings: FrameTimings;
}
/** Create loop controls permanently bound to one app. */
export declare function createLoop(app: Runtime): LoopApi;
