// Minimotor — a minimal 2D canvas framework for small games and playful apps.
// createApp creates isolated apps. Optional stateful capabilities live at explicit
// subpaths (`minimotor/audio`, `minimotor/net`, `minimotor/ui`, ...).

import { createApp } from "./engine/index.js";
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
  dropThrough,
  slopeY,
  climbLadder,
  grid,
  contacts,
} from "./collision.js";
/** Tiny archetype-free entity-component-system. `ECS.component` declares a
 *  component and `ECS.create` builds a world; then `world.spawn`,
 *  `world.query`/`world.dense` and `world.system` handle iteration and per-step
 *  logic. Content-agnostic — render via `Sprites.Sprite` + `Draw.sprites`.
 *
 *    const Pos = ECS.component<{ x: number; y: number }>("Pos");
 *    const world = ECS.create();
 *    world.spawn(Pos.with({ x: 0, y: 0 }));
 *    for (const [id, p] of world.query(Pos)) p.x += 1;
 */
import * as ECS from "./ecs/index.js";
/** General finite state machine: `Fsm.create(states, initial)` builds a machine
 *  of named states with `enter`/`update`/`exit`. `machine.update()` runs the
 *  active state and transitions on the name it returns; `machine.go(name)`
 *  forces one. Drives per-entity behavior (idle/run/jump, AI) and anim states. */
import * as Fsm from "./fsm.js";
/** Small math helpers (named à la Unity so it never shadows `Math`):
 *  interpolation (`Mathf.lerp`, `Mathf.damp`, `Mathf.approach`), ranges
 *  (`Mathf.clamp`, `Mathf.remap`), oscillators (`Mathf.pingPong`, `Mathf.wave`),
 *  plus randomness and 0..1 easing curves. */
import * as Mathf from "./mathf.js";
/** Offscreen pre-rendering and sprite-sheet baking. `Sprites.getSprite`/
 *  `Sprites.getLayer` cache expensive draws, `Sprites.tint` recolors, and
 *  `Sprites.atlas`/`Sprites.packAtlas` build sheets for `Anim.sheet`/`Tiles.grid`
 *  — plus the standard `Sprites.Sprite` ECS component. */
import * as Sprites from "./sprites.js";
/** Pure, dependency-free game recipes (call one, get a value) that recur across
 *  genres: `Goodies.leadTarget`/`Goodies.nearest` (steering), `Goodies.floodFill`/
 *  `Goodies.lineOfSight` (grid), `Goodies.weightedPick`/`Goodies.rollDice`
 *  (random), `Goodies.wrap` (toroidal), `Goodies.formatClock` (HUD readout).
 *  Stateful gadgets live in `Gizmos`. */
import * as Goodies from "./goodies/index.js";
/** Stateful game gadgets you create once then tick/mutate (the sibling of
 *  `Goodies`): `Gizmos.combo`, `Gizmos.scoreTracker`, `Gizmos.patrol`,
 *  `Gizmos.trail`, `Gizmos.charges`, `Gizmos.checkpointRoute`,
 *  `Gizmos.seedRng`/`Gizmos.shuffleBag`, `Gizmos.undoStack`, and
 *  `Gizmos.car`/`Gizmos.skidmarks`. */
import * as Gizmos from "./gizmos/index.js";
/** ASCII and Tiled levels as pure data: `Tiles.grid` and `Tiles.Tiled.grid`
 *  build the same queryable `SolidSource` `Level` (feed
 *  it to `Collision.moveAndSlide`). `Tiles.Tiled.set(image, tsj)` reads atlas
 *  names, regions, animations, and Wang terrain directly from Tiled JSON.
 *  `Tiles.world` gives
 *  ordinary string maps the same multi-level portal/transition contract.
 *  `span` lets one map char own a multi-cell collision shape. `Tiles.set`
 *  slices a tileset image into cells/regions plus `pick`/`anim`/`auto9`/`auto16`
 *  selectors, joined to a level by a `Skin` at `Draw.tiles`.
 *
 *    const level = Tiles.grid("R.######\\n#..P...#", {
 *      size: 16,
 *      legend: {
 *        "#": { solid: true },
 *        R: { slope: "up-right", span: [2, 1] },
 *      },
 *    });
 *    const tiles = Tiles.set(terrainImage, { size: 16, names: { ground: [0, 0] } });
 *    const skin = { "#": tiles.ground, R: tiles.region(4, 2, 2, 2) };
 *    const start = level.spawnOne("P");
 */
import * as Tiles from "./tiles/index.js";
/** Cover → swap → reveal scene transitions passed to `Scenes.go`. `Transitions.fade`
 *  and `Transitions.wipe` are ready-made; a `Transition` is plain data, and the
 *  pure fixed-step runner `Transitions.run` fires the swap at full coverage. */
import * as Transitions from "./transitions.js";

export { createApp, Sprites, Goodies, Gizmos, Tiles, Transitions, Mathf, ECS, Fsm };
/** One isolated app, as returned by `createApp`. This is the type every
 *  lifecycle-owned factory takes: `createAudio(app)`, `createUI(app)`,
 *  `createNet(app)` — so it's also the type to annotate your own helpers with.
 *
 *    function spawnHud(app: App) { ... }
 */
export type { App } from "./engine/index.js";
export type {
  PlatformerAnimationState,
  PlatformerAnimationBody,
  PlatformerAnimationCursor,
  PlatformerAnimations,
} from "./features/platformer/index.js";
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
  AppCallbacks,
  AppOptions,
  DrawApi,
  DrawTextOptions,
  DrawSpriteOptions,
  DrawSprite,
  DrawSpritesOptions,
  DrawTilesOptions,
  SpriteLike,
  ParticleLike,
  TilesLike,
  Fill,
  GradientStops,
} from "./engine/index.js";
export type { SceneSpec, SceneStack, GoOptions, SceneStackOptions } from "./scenes.js";
export type {
  Portal,
  PortalArea,
  PortalBody,
  PortalDestination,
  PortalOptions,
  PortalRouter,
  PortalTravel,
} from "./portals.js";
export type { Component, ComponentInit, Entity, Ecs, System, RenderSystem } from "./ecs/index.js";
export type { ClockHandle, Cancel } from "./clock.js";
export type { SignalBus } from "./signals.js";
export { createSignals } from "./signals.js";
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
  SlopeDirection,
  LadderSource,
  Ladders,
  ClimbLadderOptions,
  SolidGrid,
  Contacts,
  MoverBody,
} from "./collision.js";
export type {
  CameraOptions,
  CameraLens,
  RenderOptions,
  ScreenMapOptions,
  FollowTarget,
} from "./camera/index.js";
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
  GamepadNavigation,
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
  TileSetEntry,
  TileSetOptions,
} from "./tiles/index.js";
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
  CarPresetId,
  DriveInput,
  DrivableBody,
  Skidmarks,
  SkidmarksOptions,
  TraceInput,
  ScoreTracker,
  ScoreStore,
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
  Protocol,
  ProtocolShape,
  StateOf,
  EventsOf,
  RequestsOf,
  ClientMessageOf,
  ServerMessageOf,
  ProtocolTransport,
  SharedItemId,
  SharedItem,
  SharedItemsOptions,
  SharedItems,
  Shared,
  BodyState,
} from "./net/index.js";

/** Pure, allocation-free collision geometry. `Collision.moveAndSlide`/
 *  `Collision.slide` do swept platformer resolution against `Solids`, plus
 *  overlap tests `Collision.rectsOverlap`, `Collision.circleRect`,
 *  `Collision.sweptAABB` and the `Collision.bounceInBounds` wall reflector.
 *
 *    body.vel.y += GRAVITY;
 *    Collision.moveAndSlide(body, level);   // moves body, zeroes blocked axes
 *    climbing = Collision.climbLadder(body, level, input.axis("up", "down"));
 *    if (body.grounded && input.jump.pressed) body.vel.y = -JUMP;
 */
const Collision = {
  rectsOverlap,
  slide,
  moveAndSlide,
  dropThrough,
  slopeY,
  climbLadder,
  grid,
  contacts,
  circleHit,
  crossedDown,
  pointInRect,
  sweptAABB,
  circleRect,
  separateCircles,
  bounceInBounds,
};
// One way in, not three: collision reaches users through the `Collision`
// namespace only. The loose per-function re-exports that used to sit here were
// a duplicate of it (and of the default export's `Collision`), so they bought
// no capability — just more surface to keep honest.
export { Collision };
export type {
  BarOptions,
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
  Fillable,
  FloatTextManager,
  FloatTextOptions,
  Flowable,
  GridOptions,
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
  Flow,
  FlowOptions,
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
} from "./features/ui/api.js";

export { Vec2 } from "./vec2.js";
