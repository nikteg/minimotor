// Minimotor - minimal game engine for small 2D canvas games.
// The whole engine is reached through PascalCase `Minimotor.*` namespaces.
// Engine runtime: Stage / Loop / Draw / Keys / Pointer / Mouse (backed by one default
// game built via Stage.init). Services & helpers: Audio, Sprites, Storage, etc.
// `createGame` is exported for isolated instances (tests / multiple games).

import { createGame, Stage, Loop, Draw, Keys, Pointer, Mouse } from "./engine/index.js";
import {
  rectsOverlap,
  circleHit,
  crossedDown,
  pointInRect,
  sweptAABB,
  circleRect,
  separateCircles,
  bounceInBounds,
} from "./collision.js";
import * as UI from "./ui/index.js";
import { Particles } from "./particles.js";
import { Scenes } from "./scenes.js";
import { Clock, Tween } from "./clock.js";
import { Signals } from "./signals.js";
import { Assets } from "./assets.js";
import * as ECS from "./ecs/index.js";
import * as Anim from "./anim/index.js";
import * as Fsm from "./fsm.js";
import * as Timers from "./timers.js";
import * as Audio from "./audio/index.js";
import * as Mathf from "./mathf.js";
import * as Input from "./input/index.js";
import * as Storage from "./storage.js";
import * as Physics from "./physics.js";
import * as Sprites from "./sprites.js";
import * as Net from "./net/index.js";
import * as Perf from "./perf/index.js";
import * as Camera from "./camera/index.js";
import * as Game from "./game.js";
import * as Goodies from "./goodies/index.js";
import * as Gizmos from "./gizmos/index.js";
import * as Fullscreen from "./fullscreen.js";
import * as Text from "./text.js";
import * as Tiles from "./tiles.js";
import * as Transitions from "./transitions.js";

export {
  createGame,
  Stage,
  Loop,
  Draw,
  Keys,
  Pointer,
  Mouse,
  Audio,
  Input,
  Storage,
  Physics,
  Sprites,
  Net,
  Perf,
  Camera,
  Game,
  Goodies,
  Gizmos,
  Fullscreen,
  Text,
  Tiles,
  Transitions,
  Mathf,
  Scenes,
  ECS,
  Clock,
  Tween,
  Signals,
  Assets,
  Anim,
  Fsm,
  Timers,
  Particles,
};
export type {
  Rect,
  Viewport,
  EnginePlugin,
  FrameTimings,
  GameCallbacks,
  Game as GameHost,
  GameBuilder,
  GameOptions,
  StageOptions,
} from "./engine/index.js";
export type { Scene, SceneManager } from "./scenes.js";
export type {
  Component,
  ComponentInit,
  Entity,
  World,
  System,
  RenderSystem,
  SpriteData,
  DrawSpritesOptions,
} from "./ecs/index.js";
export type { ClockManager, Cancel } from "./clock.js";
export type { SignalBus } from "./signals.js";
export type { AssetStore, AssetManifest, AssetSpec, ProgressFn } from "./assets.js";
export type {
  Animation,
  AnimationStates,
  SheetConfig,
  FrameRect,
  AnimDrawOptions,
  Motion,
  AnimateOptions,
  Parallel,
} from "./anim/index.js";
export type { Sweep, Contact, BounceFaces } from "./collision.js";
export type { ShakeState } from "./camera/index.js";
export type { ParticleSystem, BurstOptions, Range } from "./particles.js";
export type {
  PerfStats,
  PerfTracker,
  NetStats,
  NetMeter,
  PerfHudOptions,
  PerfOptions,
  Sparkline,
} from "./perf/index.js";
export type { GamepadState } from "./input/index.js";
export type { State, AnimBridge, FsmOptions, Machine } from "./fsm.js";
export type { Window, Buffer, Cooldown, JumpGate, JumpGateOptions } from "./timers.js";
export type { TileMap, TilesConfig, MoveOptions, MoveResult, MoveDir } from "./tiles.js";
export type { Transition, TransitionRender, TransitionRun } from "./transitions.js";

// A shared default world (`Minimotor.World`) for the common single-world case;
// games that need isolation or per-scene worlds call `ECS.world()` for their own.
const defaultWorld = ECS.world();
export type {
  SfxBuilder,
  MusicConfig,
  Bus,
  Filter,
  Effect,
  DelayEffect,
  ToneOptions,
  ToneSweep,
} from "./audio/index.js";
export type { PhysicsBody } from "./physics.js";
export type { SpriteCanvas, AtlasOptions } from "./sprites.js";
export type {
  Weighted,
  GridPoint,
  GridNeighborOptions,
  LeadTarget,
  TimingGrade,
  DamageRoll,
  ItemStack,
  WaveScale,
  DayPhase,
  DistanceField,
  Beat,
} from "./goodies/index.js";
export type {
  ShuffleBag,
  CheckpointRoute,
  Combo,
  Charges,
  Flash,
  Patrol,
  Trail,
  UndoStack,
  Car,
  CarConfig,
  DriveInput,
  DrivableBody,
} from "./gizmos/index.js";
export type {
  Transport,
  WsConfig,
  RtcConfig,
  Signal,
  Interpolator,
  InterpolatorOptions,
  Roster,
  RosterOptions,
} from "./net/index.js";

const Collision = {
  rectsOverlap,
  circleHit,
  crossedDown,
  pointInRect,
  sweptAABB,
  circleRect,
  separateCircles,
  bounceInBounds,
};
export {
  Collision,
  rectsOverlap,
  circleHit,
  crossedDown,
  pointInRect,
  sweptAABB,
  circleRect,
  separateCircles,
  bounceInBounds,
};
export { UI };
export type {
  BarStyle,
  ButtonOptions,
  ButtonStyle,
  ButtonVariant,
  ConfirmOptions,
  DialogOptions,
  DragSourceOptions,
  DragSourceState,
  DraggedItem,
  DropResult,
  DropTargetOptions,
  DropTargetState,
  FloatManager,
  FloatOptions,
  GridOptions,
  GroupOptions,
  IdPart,
  LayoutChildren,
  LayoutOptions,
  ListOptions,
  ListItemOptions,
  ModalOptions,
  PanelOptions,
  PopoverOptions,
  ScrollbarOptions,
  SliderOptions,
  SpinnerOptions,
  Stack,
  StackOptions,
  TableColumn,
  TableSort,
  TableOptions,
  TableResult,
  TabsOptions,
  TextOptions,
  TextInputOptions,
  TextInputResult,
  SelectOption,
  SelectOptions,
  SelectResult,
  Theme,
  ToggleOptions,
} from "./ui/index.js";

export const Minimotor = {
  createGame,
  Stage,
  Loop,
  Draw,
  Keys,
  Pointer,
  Mouse,
  Audio,
  Input,
  Storage,
  Physics,
  Sprites,
  Net,
  Perf,
  Camera,
  Game,
  Goodies,
  Gizmos,
  Fullscreen,
  Text,
  Tiles,
  Transitions,
  Mathf,
  Scenes,
  ECS,
  World: defaultWorld,
  Clock,
  Tween,
  Signals,
  Assets,
  Anim,
  Fsm,
  Timers,
  Particles,
  Collision,
  UI,
};

export default Minimotor;
