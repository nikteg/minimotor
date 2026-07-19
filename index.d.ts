import { Engine, rectsOverlap } from "./engine.js";
import * as audio from "./audio.js";
export { Engine, rectsOverlap, audio };
export type { Rect, EngineShape } from "./engine.js";
export type { SfxBuilder, MusicConfig } from "./audio.js";
export declare const Minimotor: {
    Engine: import("./engine.js").EngineShape;
    rectsOverlap: typeof rectsOverlap;
    audio: typeof audio;
};
export default Minimotor;
