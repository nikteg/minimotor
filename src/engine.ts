"use strict";

// ---------- Minimal game framework ----------
// The engine is reached through PascalCase `Minimotor.*` namespaces, all backed
// by ONE default game that `Stage.init()` builds. Game code never imports an
// instance and never threads a per-frame context — it reads the namespaces:
//
//     const vp = Minimotor.Stage.init("game", { plugins: [Minimotor.Perf.plugin()] });
//
//     Minimotor.Loop.run({
//       update() { if (Minimotor.Keys.pressed("Space")) jump(); },
//       draw()   { Minimotor.Draw.ctx.clearRect(0, 0, vp.w, vp.h); },
//     });
//
// `createGame()` below returns an isolated `Game` and stays exported for tests
// (and anyone who genuinely needs multiple independent games). The namespaces
// are thin facades over the default instance it produces.
//
// Convention: read input (`Keys`/`Pointer`) in `update`, draw (`Draw.ctx`) in
// `draw`. It isn't type-enforced, but edge input (`pressed`/`released`) is only
// meaningful per fixed update step.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Viewport {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Logical width in CSS pixels */
  w: number;
  /** Logical height in CSS pixels */
  h: number;
  /** Device pixel ratio (capped at 2 for perf) */
  dpr: number;
  /** Safe area left inset (notch etc.) */
  safeLeft: number;
  /** Safe area top inset */
  safeTop: number;
}

/** Polled keyboard state. `down` is level-triggered (held); `pressed` and
 *  `released` are edge-triggered and true for exactly one update step per
 *  physical transition — that's why no `onKeyDown` callback is needed.
 *
 *    if (Minimotor.Keys.down("ArrowLeft")) move();   // held
 *    if (Minimotor.Keys.pressed("Space"))  jump();   // this step only
 *    if (Minimotor.Keys.released("KeyR"))  letGo(); */
export interface Keys {
  /** True while the key is held. */
  down(code: string): boolean;
  /** True for one update step when the key goes down (ignores auto-repeat). */
  pressed(code: string): boolean;
  /** True for one update step when the key goes up. */
  released(code: string): boolean;
}

/** Polled pointer (mouse + touch) in logical CSS pixels, relative to the
 *  canvas. `pressed`/`released` are edge-triggered like `Keys`. */
export interface Pointer {
  /** Logical x within the canvas; -1 before the first event. */
  readonly x: number;
  /** Logical y within the canvas; -1 before the first event. */
  readonly y: number;
  /** True while a button/touch is held. */
  readonly down: boolean;
  /** True for one update step when the press begins. */
  readonly pressed: boolean;
  /** True for one update step when the press ends. */
  readonly released: boolean;
}

/** Plugins hook into the game lifecycle; each hook receives the `Game`.
 *  Register with the builder's `use()` or `Loop.use()`. */
export interface EnginePlugin {
  name: string;
  /** Called once after the canvas is ready, before the first frame. */
  onInit?: (game: Game) => void;
  /** Called once per frame, before the user's update step(s). */
  beforeUpdate?: (game: Game) => void;
  /** Called once per frame, after the user's update step(s). */
  afterUpdate?: (game: Game) => void;
  /** Called before the user's draw. */
  beforeDraw?: (game: Game) => void;
  /** Called after the user's draw. */
  afterDraw?: (game: Game) => void;
  /** Called after a viewport resize. */
  onResize?: (game: Game) => void;
}

/** The per-frame callbacks. Both are no-arg; read state from the namespaces
 *  (`Minimotor.Keys` / `Minimotor.Draw`) or, for an isolated game, its props. */
export interface GameCallbacks {
  /** Fixed-timestep simulation. May run 0..N times per rendered frame. */
  update: () => void;
  /** Render. Runs once per rendered frame. */
  draw: () => void;
}

/** An isolated built game. Its state (`keys`, `ctx`, …) is read directly; the
 *  `Minimotor.*` namespaces expose the same surface on the default instance. */
export interface Game {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly viewport: Viewport;
  readonly keys: Keys;
  readonly pointer: Pointer;
  /** Real time since the previous frame, in fixed steps (interpolate in draw). */
  readonly frameScale: number;
  readonly paused: boolean;
  /** Subscribe to viewport changes (resize / orientation); returns unsubscribe. */
  onResize(handler: (vp: Viewport) => void): () => void;
  /** Subscribe to each fixed update step (runs after the user's `update`, before
   *  edge input is cleared). Deterministic — used by Clock/Tween. Returns
   *  unsubscribe. */
  onStep(handler: () => void): () => void;
  /** Register a plugin after build (calls its `onInit` immediately). */
  use(plugin: EnginePlugin): void;
  /** Register callbacks and start the loop (idempotent restart of callbacks). */
  run(callbacks: GameCallbacks): Game;
  /** Freeze updates; `draw` keeps running so overlays can render. */
  pause(): void;
  /** Resume from a `pause()`. */
  resume(): void;
  /** Stop the loop entirely. */
  stop(): void;
}

export interface GameOptions {
  /** Canvas element id (without `#`) or the element itself. */
  canvas: string | HTMLCanvasElement;
}

/** Fluent host-builder. Configure, then `build()` into a `Game`. */
export interface GameBuilder {
  /** Register a lifecycle plugin (e.g. `Perf.plugin()`). */
  use(plugin: EnginePlugin): GameBuilder;
  /** Auto-pause while a coarse-pointer device is held in portrait. */
  pauseOnPortrait(): GameBuilder;
  /** Initialise the canvas and produce a runnable `Game`. */
  build(): Game;
}

const STEP_MS = 1000 / 60;

/** Create an isolated game. Prefer `Minimotor.Stage.init()` for app code;
 *  this stays exported for tests and multi-game scenarios. */
export function createGame(options: GameOptions): GameBuilder {
  const plugins: EnginePlugin[] = [];
  let pauseOnPortrait = false;

  const builder: GameBuilder = {
    use(plugin) {
      plugins.push(plugin);
      return builder;
    },
    pauseOnPortrait() {
      pauseOnPortrait = true;
      return builder;
    },
    build() {
      return buildGame(options, plugins, pauseOnPortrait);
    },
  };
  return builder;
}

function resolveCanvas(canvas: string | HTMLCanvasElement): HTMLCanvasElement {
  if (typeof canvas !== "string") return canvas;
  const el = document.getElementById(canvas);
  if (!el) throw new Error(`Minimotor: canvas "#${canvas}" not found in the DOM`);
  return el as HTMLCanvasElement;
}

function buildGame(options: GameOptions, plugins: EnginePlugin[], pauseOnPortrait: boolean): Game {
  const canvas = resolveCanvas(options.canvas);
  let viewport = readViewport(canvas);
  const ctx = viewport.ctx;

  // ---- Input state (polled; edge sets are cleared once a step consumes them) ----
  const heldKeys = new Set<string>();
  const pressedKeys = new Set<string>();
  const releasedKeys = new Set<string>();

  const keys: Keys = {
    down: (code) => heldKeys.has(code),
    pressed: (code) => pressedKeys.has(code),
    released: (code) => releasedKeys.has(code),
  };

  const ptr = { x: -1, y: -1, down: false, pressed: false, released: false };
  const pointer: Pointer = {
    get x() {
      return ptr.x;
    },
    get y() {
      return ptr.y;
    },
    get down() {
      return ptr.down;
    },
    get pressed() {
      return ptr.pressed;
    },
    get released() {
      return ptr.released;
    },
  };

  // ---- Frame state ----
  let frameScale = 1;
  let paused = false;
  let callbacks: GameCallbacks | null = null;
  let running = false;
  let lastTime = 0;
  let accumulator = 0;

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") e.preventDefault();
    if (!heldKeys.has(e.code)) pressedKeys.add(e.code); // ignore auto-repeat
    heldKeys.add(e.code);
  });
  window.addEventListener("keyup", (e) => {
    heldKeys.delete(e.code);
    releasedKeys.add(e.code);
  });

  const setPointer = (e: { clientX: number; clientY: number }) => {
    const rect = canvas.getBoundingClientRect();
    ptr.x = e.clientX - rect.left;
    ptr.y = e.clientY - rect.top;
  };
  canvas.addEventListener("pointerdown", (e) => {
    setPointer(e);
    ptr.down = true;
    ptr.pressed = true;
  });
  canvas.addEventListener("pointermove", setPointer);
  window.addEventListener("pointerup", (e) => {
    setPointer(e);
    ptr.down = false;
    ptr.released = true;
  });

  /** Drop edge-triggered input once the update step it belongs to has run, so a
   *  press fires for exactly one step (never twice when a slow frame runs
   *  multiple steps). */
  function consumeEdges() {
    pressedKeys.clear();
    releasedKeys.clear();
    ptr.pressed = false;
    ptr.released = false;
  }

  const stepHandlers = new Set<() => void>();
  const resizeHandlers = new Set<(vp: Viewport) => void>();
  const handleResize = () => {
    viewport = readViewport(canvas);
    for (const p of plugins) p.onResize?.(game);
    for (const h of resizeHandlers) h(viewport);
  };
  window.addEventListener("resize", handleResize);
  // iOS doesn't fire resize on 180° rotation between landscape orientations.
  const handleOrient = () => {
    handleResize();
    setTimeout(handleResize, 300);
  };
  window.addEventListener("orientationchange", handleOrient);
  screen.orientation?.addEventListener?.("change", handleOrient);

  if (pauseOnPortrait) {
    const mq = window.matchMedia("(orientation: portrait) and (pointer: coarse)");
    const apply = () => {
      paused = mq.matches;
    };
    mq.addEventListener?.("change", apply);
    apply();
  }

  function loop(time: number) {
    if (!running) return;
    if (!lastTime) lastTime = time;

    if (paused) {
      lastTime = time;
      accumulator = 0;
      frameScale = 0;
      for (const p of plugins) p.beforeDraw?.(game);
      callbacks!.draw();
      for (const p of plugins) p.afterDraw?.(game);
      requestAnimationFrame(loop);
      return;
    }

    let elapsed = time - lastTime;
    lastTime = time;
    if (elapsed > 250) elapsed = 250;
    frameScale = elapsed / STEP_MS;
    accumulator += elapsed;

    for (const p of plugins) p.beforeUpdate?.(game);
    while (accumulator >= STEP_MS) {
      callbacks!.update();
      for (const h of stepHandlers) h(); // timers / tweens advance one step
      // Each step observes the current press, then it's consumed — so pressed()
      // is true for exactly one step, even if this frame runs several.
      consumeEdges();
      accumulator -= STEP_MS;
    }
    for (const p of plugins) p.afterUpdate?.(game);

    for (const p of plugins) p.beforeDraw?.(game);
    callbacks!.draw();
    for (const p of plugins) p.afterDraw?.(game);
    requestAnimationFrame(loop);
  }

  const game: Game = {
    canvas,
    ctx,
    get viewport() {
      return viewport;
    },
    keys,
    pointer,
    get frameScale() {
      return frameScale;
    },
    get paused() {
      return paused;
    },
    onResize(handler) {
      resizeHandlers.add(handler);
      return () => resizeHandlers.delete(handler);
    },
    onStep(handler) {
      stepHandlers.add(handler);
      return () => stepHandlers.delete(handler);
    },
    use(plugin) {
      plugins.push(plugin);
      plugin.onInit?.(game);
    },
    run(cb) {
      callbacks = cb;
      if (!running) {
        running = true;
        requestAnimationFrame(loop);
      }
      return game;
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    stop() {
      running = false;
    },
  };

  for (const p of plugins) p.onInit?.(game);
  return game;
}

function readViewport(canvas: HTMLCanvasElement): Viewport {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const rootStyle = getComputedStyle(document.documentElement);
  let safeLeft = parseFloat(rootStyle.getPropertyValue("--sai-left")) || 0;
  const safeTop = parseFloat(rootStyle.getPropertyValue("--sai-top")) || 0;

  // iPhone notch detection: the same inset appears on both sides in landscape.
  // 90 = notch left, -90 / 270 = notch right.
  if (/iPhone/.test(navigator.userAgent)) {
    let angle: number | null = null;
    const win = window as unknown as { orientation?: number };
    if (typeof win.orientation === "number") angle = win.orientation;
    else if (screen.orientation && typeof screen.orientation.angle === "number")
      angle = screen.orientation.angle;
    if (angle === -90 || angle === 270) {
      safeLeft = 0;
      document.documentElement.dataset.notch = "right";
    } else if (angle === 90) {
      document.documentElement.dataset.notch = "left";
    } else {
      document.documentElement.dataset.notch = "none";
    }
  }

  return { canvas, ctx, w, h, dpr, safeLeft, safeTop };
}

// ---------- Global default-engine facade ----------
// The whole engine is reached as `Minimotor.*` namespaces backed by ONE default
// game built by `Stage.init()`. Game code reads these instead of importing a
// game instance. `createGame()` above stays for isolated instances (tests).

let defaultGame: Game | null = null;

function requireDefault(): Game {
  if (!defaultGame) {
    throw new Error(
      "Minimotor: call Minimotor.Stage.init(canvas) before using Stage / Loop / Keys / Pointer / Draw",
    );
  }
  return defaultGame;
}

export interface StageOptions {
  /** Lifecycle plugins (e.g. `Perf.plugin()`). */
  plugins?: EnginePlugin[];
  /** Auto-pause while a coarse-pointer device is held in portrait. */
  pauseOnPortrait?: boolean;
}

/** Canvas / viewport / screen. `init` builds the default engine and returns
 *  its viewport so setup code can read `vp.w` / `vp.h` / `vp.dpr`. */
export const Stage = {
  init(canvas: string | HTMLCanvasElement, opts: StageOptions = {}): Viewport {
    let builder = createGame({ canvas });
    if (opts.pauseOnPortrait) builder = builder.pauseOnPortrait();
    for (const p of opts.plugins ?? []) builder = builder.use(p);
    defaultGame = builder.build();
    return defaultGame.viewport;
  },
  get viewport(): Viewport {
    return requireDefault().viewport;
  },
  get canvas(): HTMLCanvasElement {
    return requireDefault().canvas;
  },
  onResize(handler: (vp: Viewport) => void): () => void {
    return requireDefault().onResize(handler);
  },
};

/** The game loop. */
export const Loop = {
  run(callbacks: GameCallbacks): void {
    requireDefault().run(callbacks);
  },
  pause(): void {
    requireDefault().pause();
  },
  resume(): void {
    requireDefault().resume();
  },
  stop(): void {
    requireDefault().stop();
  },
  use(plugin: EnginePlugin): void {
    requireDefault().use(plugin);
  },
  /** Subscribe to each fixed update step; returns unsubscribe. */
  onStep(handler: () => void): () => void {
    return requireDefault().onStep(handler);
  },
  /** Fixed update timestep in milliseconds (1000 / 60). */
  get step(): number {
    return STEP_MS;
  },
};

/** Rendering handle — read inside `draw`. */
export const Draw = {
  get ctx(): CanvasRenderingContext2D {
    return requireDefault().ctx;
  },
  get frameScale(): number {
    return requireDefault().frameScale;
  },
};

/** Polled keyboard — read inside `update`. */
export const Keys: Keys = {
  down: (code) => requireDefault().keys.down(code),
  pressed: (code) => requireDefault().keys.pressed(code),
  released: (code) => requireDefault().keys.released(code),
};

/** Polled pointer — read inside `update`. */
export const Pointer: Pointer = {
  get x() {
    return requireDefault().pointer.x;
  },
  get y() {
    return requireDefault().pointer.y;
  },
  get down() {
    return requireDefault().pointer.down;
  },
  get pressed() {
    return requireDefault().pointer.pressed;
  },
  get released() {
    return requireDefault().pointer.released;
  },
};
