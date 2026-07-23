// Minimotor - minimal game engine for small 2D canvas games.
// The whole engine is reached through PascalCase `Minimotor.*` namespaces.
// Engine runtime: Stage / Loop / Draw / Keys / Pointer / Mouse (backed by one default
// game built via Stage.init). Services & helpers: Audio, Sprites, Storage, etc.
// Isolated game instances (tests / multiple games) are created with
// `Stage.create`; extra camera lenses with `Camera.create`.

import { Stage, Loop, Draw, Keys, Pointer, Mouse } from "./engine/index.js";
import { Vec2 } from "./vec2.js";
import {
  rectsOverlap,
  circleHit,
  crossedDown,
  pointInRect,
  sweptAABB,
  circleRect,
  separateCircles,
  bounceInBounds,
  slide,
  moveAndSlide,
} from "./collision.js";
/** Immediate-mode UI: buttons, panels, lists, tables, dialogs, drag-and-drop.
 *  Widgets are drawn and polled every frame from their options — no retained
 *  widget tree, no event handlers to wire up. */
import * as UI from "./ui/index.js";
import { Particles } from "./particles.js";
import { Scenes } from "./scenes.js";
import { Clock } from "./clock.js";
import { Signals } from "./signals.js";
import { Assets } from "./assets.js";
/** Tiny archetype-free entity-component-system. `ECS.component` declares a
 *  component and `ECS.create` builds a world; then `world.spawn`,
 *  `world.query`/`world.dense` and `world.system` handle iteration and per-step
 *  logic. Content-agnostic — render via `Sprites.Sprite` + `Draw.sprites`. */
import * as ECS from "./ecs/index.js";
/** Frame-based sprite animation: `Anim.sheet` (one strip, many frames),
 *  `Anim.states` (one image per state, switched by key) and composable value
 *  tweens (`Anim.animate`, `Anim.sequence`, `Anim.parallel`). Cursors here are
 *  `Draw.sprite`-ready. */
import * as Anim from "./anim/index.js";
/** General finite state machine: `Fsm.create(states, initial)` builds a machine
 *  of named states with `enter`/`update`/`exit`. `machine.update()` runs the
 *  active state and transitions on the name it returns; `machine.go(name)`
 *  forces one. Drives per-entity behavior (idle/run/jump, AI) and anim states. */
import * as Fsm from "./fsm.js";
/** Polled timing latches read as booleans, derived from a `Clock` (so pause and
 *  slow-mo affect them). `Timers.window` (coyote grace), `Timers.buffer` (early
 *  press buffering), `Timers.cooldown` (reuse gate), and `Timers.jumpGate` (the
 *  first two composed into forgiving-jump timing). */
import * as Timers from "./timers.js";
/** WebAudio helpers that own the `AudioContext`, timing and volume. `Audio.sfx`
 *  builds crash-safe sound effects, `Audio.music` schedules a song,
 *  `Audio.bus`/`Audio.master` mix, and `Audio.tone`/`Audio.engine` synthesize. */
import * as Audio from "./audio/index.js";
/** Small math helpers (named à la Unity so it never shadows `Math`):
 *  interpolation (`Mathf.lerp`, `Mathf.damp`, `Mathf.approach`), ranges
 *  (`Mathf.clamp`, `Mathf.remap`), oscillators (`Mathf.pingPong`, `Mathf.wave`),
 *  plus randomness and 0..1 easing curves. */
import * as Mathf from "./mathf.js";
/** Keyboard/action mapping and device input. `Input.map` binds keys/pad buttons
 *  to named actions with edge state, `Input.gamepad` polls a pad, plus DOM
 *  helpers `Input.wireButton` and `Input.vibrate`. */
import * as Input from "./input/index.js";
/** Crash-safe `localStorage` wrapper: `Storage.load(key, fallback)` and
 *  `Storage.save(key, value)` round-trip any JSON-serializable value and never
 *  throw — private browsing, quota, or corrupt data all fall back silently. */
import * as Storage from "./storage.js";
/** Offscreen pre-rendering and sprite-sheet baking. `Sprites.getSprite`/
 *  `Sprites.getLayer` cache expensive draws, `Sprites.tint` recolors, and
 *  `Sprites.atlas`/`Sprites.packAtlas` build sheets for `Anim.sheet`/`Tiles.grid`
 *  — plus the standard `Sprites.Sprite` ECS component. */
import * as Sprites from "./sprites.js";
/** Dependency-free multiplayer building blocks. `Net.join(url, { room })` opens
 *  a symmetric room and `Net.sync` declaratively replicates state, with
 *  `Net.createInterpolator` smoothing snapshots and `Net.createRoster` tracking
 *  peers; host/guest star sessions back host-authoritative designs. */
import * as Net from "./net/index.js";
/** FPS / frame-time monitoring. `Perf.createPerfTracker` rolls min/max/avg over
 *  a window, `Perf.drawPerfHud` renders an on-canvas overlay, `Perf.plugin`
 *  wires both into the loop, and `Perf.createNetMeter` tracks throughput. */
import * as Perf from "./perf/index.js";
import { Camera } from "./camera/index.js";
/** Neutral game building blocks: `Game.createScoreTracker` persists score/best,
 *  `Game.letterbox`/`Game.letterboxView` fit a fixed logical area into the
 *  viewport (with screen→logical pointer hit-testing), and `Game.formatClock`
 *  renders `m:ss`. */
import * as Game from "./game.js";
/** Pure, dependency-free game recipes (call one, get a value) that recur across
 *  genres: `Goodies.leadTarget`/`Goodies.nearest` (steering), `Goodies.floodFill`/
 *  `Goodies.lineOfSight` (grid), `Goodies.weightedPick`/`Goodies.rollDice`
 *  (random), `Goodies.wrap` (toroidal). Stateful gadgets live in `Gizmos`. */
import * as Goodies from "./goodies/index.js";
/** Stateful game gadgets you create once then tick/mutate (the sibling of
 *  `Goodies`): `Gizmos.combo`, `Gizmos.patrol`, `Gizmos.trail`, `Gizmos.charges`,
 *  `Gizmos.checkpointRoute`, `Gizmos.seedRng`/`Gizmos.shuffleBag`,
 *  `Gizmos.undoStack`, and `Gizmos.car`/`Gizmos.skidmarks`. */
import * as Gizmos from "./gizmos/index.js";
/** ASCII-grid levels as pure data: `Tiles.grid(ascii, { size, legend })` builds
 *  a queryable, `SolidSource` `Level` (feed to `Collision.moveAndSlide`);
 *  `Tiles.set` slices a tileset image into named cells plus `pick`/`anim`/
 *  `auto16` selectors, joined to a level by a `Skin` at `Draw.tiles`. */
import * as Tiles from "./tiles.js";
/** Cover → swap → reveal scene transitions passed to `Scenes.go`. `Transitions.fade`
 *  and `Transitions.wipe` are ready-made; a `Transition` is plain data, and the
 *  pure fixed-step runner `Transitions.run` fires the swap at full coverage. */
import * as Transitions from "./transitions.js";
/** Opt-in on-screen touch gamepad. `OnscreenInput.gamepad(config)` returns a
 *  `GamepadState` for `Input.map({ pad })` and `OnscreenInput.drawControls(pad)`
 *  renders it — touch and a hardware pad share one code path. */
import * as OnscreenInput from "./onscreen.js";

export {
  Stage,
  Loop,
  Draw,
  Keys,
  Pointer,
  Mouse,
  Audio,
  Input,
  Storage,
  Sprites,
  Net,
  Perf,
  Camera,
  Game,
  Goodies,
  Gizmos,
  Tiles,
  Transitions,
  Mathf,
  Scenes,
  ECS,
  Clock,
  Signals,
  Assets,
  Anim,
  Fsm,
  Timers,
  Particles,
  OnscreenInput,
};
export type {
  Anchor,
  StickSpec,
  ButtonSpec,
  HapticsConfig,
  OnscreenGamepadConfig,
  OnscreenPad,
} from "./onscreen.js";
export type {
  Rect,
  Viewport,
  KeyCode,
  EnginePlugin,
  FrameTimings,
  GameCallbacks,
  Game as GameHost,
  GameOptions,
  StageOptions,
  DrawTextOptions,
  DrawSpriteOptions,
  DrawSprite,
  DrawSpritesOptions,
  SpriteLike,
  ParticleLike,
  TilesLike,
  Fill,
  GradientStops,
} from "./engine/index.js";
export type { SceneSpec, SceneStack, GoOptions, SceneStackOptions } from "./scenes.js";
export type { Component, ComponentInit, Entity, Ecs, System, RenderSystem } from "./ecs/index.js";
export type { ClockHandle, Cancel } from "./clock.js";
export type { SignalBus } from "./signals.js";
export type {
  AssetStore,
  AssetManifest,
  AssetSpec,
  ProgressFn,
  Loaded,
  LoadedAsset,
} from "./assets.js";
export type {
  Sheet,
  SheetCursor,
  SheetOptions,
  SheetStateSpec,
  SheetImage,
  FrameRect,
  StateKit,
  StateCursor,
  StateClip,
  Motion,
  AnimateOptions,
  SequenceStep,
  Parallel,
} from "./anim/index.js";
export type {
  Sweep,
  Contact,
  BounceFaces,
  Solid,
  SolidSource,
  Solids,
  Contacts,
  MoverBody,
} from "./collision.js";
export type { CameraOptions, CameraLens, RenderOptions, FollowTarget } from "./camera/index.js";
export type {
  ParticleSystem,
  BurstOptions,
  EmitOptions,
  ParticleOptions,
  Range,
} from "./particles.js";
export type {
  PerfStats,
  PerfTracker,
  NetStats,
  NetMeter,
  PerfHudOptions,
  PerfOptions,
  Sparkline,
} from "./perf/index.js";
export type {
  GamepadState,
  PadButton,
  PadCode,
  Binding,
  ActionState,
  InputMap,
  InputMapOptions,
} from "./input/index.js";
export type { State, FsmOptions, Machine } from "./fsm.js";
export type { Window, Buffer, Cooldown, JumpGate, JumpGateOptions } from "./timers.js";
export type {
  Level,
  GridOptions as TileGridOptions,
  TileSpec,
  Cell,
  Selector,
  SelectorCell,
  Skin,
  SkinValue,
  TileSet,
  TileSetOptions,
} from "./tiles.js";
export type { Transition, TransitionRender, TransitionRun } from "./transitions.js";

export type {
  SfxBuilder,
  MusicConfig,
  SfxSpec,
  SfxHandle,
  PlayOptions,
  BusHandle,
  EngineOptions,
  EngineDrive,
  EngineHandle,
  MusicOptions,
  MusicHandle,
  Bus,
  Filter,
  Effect,
  DelayEffect,
  ToneOptions,
  ToneSweep,
} from "./audio/index.js";
export type { SpriteCanvas, AtlasOptions, SpriteData } from "./sprites.js";
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
  Skidmarks,
  SkidmarksOptions,
  TraceInput,
} from "./gizmos/index.js";
export type {
  Transport,
  WsConfig,
  RtcConfig,
  Signal,
  RtcSessionOptions,
  HostSession,
  GuestSession,
  Room,
  RoomOptions,
  SyncOptions,
  PeerStates,
  Interpolator,
  InterpolatorOptions,
  Roster,
  RosterOptions,
} from "./net/index.js";

/** Pure, allocation-free collision geometry. `Collision.moveAndSlide`/
 *  `Collision.slide` do swept platformer resolution against `Solids`, plus
 *  overlap tests `Collision.rectsOverlap`, `Collision.circleRect`,
 *  `Collision.sweptAABB` and the `Collision.bounceInBounds` wall reflector. */
const Collision = {
  rectsOverlap,
  slide,
  moveAndSlide,
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
  slide,
  moveAndSlide,
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
  FloatTextManager,
  FloatTextOptions,
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

export { Vec2 } from "./vec2.js";

export const Minimotor = {
  Stage,
  Vec2,
  Loop,
  Draw,
  Keys,
  Pointer,
  Mouse,
  Audio,
  Input,
  Storage,
  Sprites,
  Net,
  Perf,
  Camera,
  Game,
  Goodies,
  Gizmos,
  Tiles,
  Transitions,
  Mathf,
  Scenes,
  ECS,
  Clock,
  Signals,
  Assets,
  Anim,
  Fsm,
  Timers,
  Particles,
  Collision,
  UI,
  OnscreenInput,
};

export default Minimotor;
