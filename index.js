// Minimotor - minimal spelmotor för små 2D-canvas-spel.
// All funktionalitet samlas under ett enda Minimotor-objekt; enskilda
// exports finns också för den som vill importera selektivt.
import { Engine, rectsOverlap } from "./engine.js";
import * as audio from "./audio.js";
export { Engine, rectsOverlap, audio };
export const Minimotor = {
    Engine,
    rectsOverlap,
    audio,
};
export default Minimotor;
