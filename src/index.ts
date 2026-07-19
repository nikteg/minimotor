// Minimotor - minimal game engine for small 2D canvas games.
// The whole engine is reached through PascalCase `Minimotor.*` namespaces.
// Engine runtime: Stage / Loop / Draw / Keys / Pointer (backed by one default
// game built via Stage.init). Services & helpers: Audio, Sprites, Storage, etc.
// `createGame` is exported for isolated instances (tests / multiple games).

import { createGame, Stage, Loop, Draw, Keys, Pointer } from "./engine.js";
import { rectsOverlap, circleHit, crossedDown } from "./collision.js";
import { Scenes } from "./scenes.js";
import * as Audio from "./audio.js";
import * as Mathf from "./mathf.js";
import * as Input from "./input.js";
import * as Storage from "./storage.js";
import * as Physics from "./physics.js";
import * as Sprites from "./sprites.js";
import * as Net from "./net.js";
import * as Perf from "./perf.js";
import * as Camera from "./camera.js";
import * as Game from "./game.js";
import * as Fullscreen from "./fullscreen.js";
import * as Text from "./text.js";

export {
  createGame,
  Stage,
  Loop,
  Draw,
  Keys,
  Pointer,
  Audio,
  Input,
  Storage,
  Physics,
  Sprites,
  Net,
  Perf,
  Camera,
  Game,
  Fullscreen,
  Text,
  Mathf,
  Scenes,
};
export type {
  Rect,
  Viewport,
  EnginePlugin,
  GameCallbacks,
  Game as GameHost,
  GameBuilder,
  GameOptions,
  StageOptions,
} from "./engine.js";
export type { Scene, SceneManager } from "./scenes.js";
export type { SfxBuilder, MusicConfig } from "./audio.js";
export type { PhysicsBody } from "./physics.js";
export type { SpriteCanvas } from "./sprites.js";
export type { Transport, WsConfig, RtcConfig, Signal } from "./net.js";

const Collision = { rectsOverlap, circleHit, crossedDown };
export { Collision, rectsOverlap, circleHit, crossedDown };

export const Minimotor = {
  createGame,
  Stage,
  Loop,
  Draw,
  Keys,
  Pointer,
  Audio,
  Input,
  Storage,
  Physics,
  Sprites,
  Net,
  Perf,
  Camera,
  Game,
  Fullscreen,
  Text,
  Mathf,
  Scenes,
  Collision,
};

export default Minimotor;
