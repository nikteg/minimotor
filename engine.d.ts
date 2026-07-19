export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}
export interface EngineShape {
    canvas: HTMLCanvasElement | null;
    ctx: CanvasRenderingContext2D | null;
    onUpdate: (() => void) | null;
    onDraw: (() => void) | null;
    onKeyDown?: (code: string) => void;
    lastTime: number;
    accumulator: number;
    frameScale: number;
    readonly STEP_MS: number;
    paused: boolean;
    loop: (time: number) => void;
    init(canvas: HTMLCanvasElement): void;
    start(update: () => void, draw: () => void): void;
}
export declare const Engine: EngineShape;
export declare function rectsOverlap(a: Rect, b: Rect): boolean;
