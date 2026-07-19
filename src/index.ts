// Minimotor - minimal game engine for small 2D canvas games.
// All functionality is gathered under a single Minimotor object;
// individual exports are also available for selective imports.

import { Engine, rectsOverlap } from "./engine.js";
import * as Audio from "./audio.js";
import * as Input from "./input.js";
import * as Storage from "./storage.js";
import * as Physics from "./physics.js";
import * as Sprites from "./sprites.js";
import * as Net from "./net.js";
import * as Perf from "./perf.js";
import * as Camera from "./camera.js";
import * as Game from "./game.js";

export { Engine, Audio, Input, Storage, Physics, Sprites, Net, Perf, Camera, Game };
export type { Rect, Viewport, EngineShape } from "./engine.js";
export type { SfxBuilder, MusicConfig } from "./audio.js";
export type { PhysicsBody } from "./physics.js";
export type { SpriteCanvas } from "./sprites.js";
export type { Transport, WsConfig, RtcConfig, Signal } from "./net.js";

const Collision = { rectsOverlap };
export { Collision, rectsOverlap };

export const Minimotor = {
  Engine,
  Audio,
  Input,
  Storage,
  Physics,
  Sprites,
  Net,
  Perf,
  Camera,
  Game,
  Collision,
};

export default Minimotor;
